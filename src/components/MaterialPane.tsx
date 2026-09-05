import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { marked } from 'marked';
import { Eraser, Highlighter, MousePointer2, PanelLeftClose, PanelLeftOpen, PenLine, Redo2, Trash2, Underline, Undo2 } from 'lucide-react';
import type { Annotation, Tool } from '../types';

const HIGHLIGHT_NAME = 'cb-highlight';
const UNDERLINE_NAME = 'cb-underline';
const ERASER_HIT_RADIUS = 14;

interface SelectionPopup {
  x: number;
  y: number;
  start: number;
  end: number;
  text: string;
}

interface MaterialPaneProps {
  material: string;
  title: string;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  annotations: Annotation[];
  onCommit: (next: Annotation[]) => void;
  onClear: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

/** 按文档顺序收集 article 内所有非空文本节点及其全文偏移区间 */
function collectTextNodes(root: HTMLElement) {
  const nodes: { node: Text; start: number; end: number }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const text = current as Text;
    if (text.data.length) {
      nodes.push({ node: text, start: pos, end: pos + text.data.length });
      pos += text.data.length;
    }
  }
  return nodes;
}

const uid = () => crypto.randomUUID();

export function MaterialPane({
  material,
  title,
  tool,
  onToolChange,
  annotations,
  onCommit,
  onClear,
  sidebarOpen,
  onToggleSidebar,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: MaterialPaneProps) {
  const materialRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingPoints = useRef<[number, number][]>([]);
  const [selPopup, setSelPopup] = useState<SelectionPopup | null>(null);

  const html = useMemo(() => ({ __html: marked.parse(material) }), [material]);

  /** 重绘画布上已有的笔迹批注；可传入临时列表用于擦除预览 */
  const draw = useCallback((list: Annotation[] = annotations) => {
    const canvas = canvasRef.current;
    const host = materialRef.current;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const a of list) {
      if (a.type === 'highlight' || !a.points?.length) continue;
      ctx.strokeStyle = a.type === 'line' ? '#ef6c47' : '#2e6fdf';
      ctx.beginPath();
      ctx.moveTo(...a.points[0]);
      a.points.slice(1).forEach((p) => ctx.lineTo(...p));
      ctx.stroke();
    }
  }, [annotations]);

  /** 在画布上预览正在绘制的笔迹 */
  const drawPreview = useCallback(() => {
    draw();
    const canvas = canvasRef.current;
    const points = drawingPoints.current;
    if (!canvas || !points.length) return;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#2e6fdf';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    points.slice(1).forEach((p) => ctx.lineTo(...p));
    ctx.stroke();
  }, [draw]);

  /** 画布尺寸跟随材料区尺寸 */
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = materialRef.current;
    if (!canvas || !host) return;
    const resize = () => {
      canvas.width = host.clientWidth;
      canvas.height = host.scrollHeight;
      draw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => observer.disconnect();
  }, [material, draw]);

  useEffect(() => {
    draw();
  }, [draw]);

  /** 用 CSS Custom Highlight API 渲染文本高亮与划线；可传入临时列表用于擦除预览 */
  const applyHighlights = useCallback((list: Annotation[] = annotations) => {
    // CSS Custom Highlight API 目前 TS 标准库未内置类型，用 any 过渡
    const HighlightCtor = (window as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const article = articleRef.current;
    if (!article || !HighlightCtor || !highlights) return;
    const nodes = collectTextNodes(article);
    const rangesFor = (type: 'highlight' | 'underline') => {
      const ranges: Range[] = [];
      for (const a of list) {
        if (a.type !== type || a.start == null || a.end == null) continue;
        for (const n of nodes) {
          if (a.end <= n.start || a.start >= n.end) continue;
          const range = document.createRange();
          range.setStart(n.node, Math.max(0, a.start - n.start));
          range.setEnd(n.node, Math.min(n.node.data.length, a.end - n.start));
          ranges.push(range);
        }
      }
      return ranges;
    };
    highlights.set(HIGHLIGHT_NAME, new HighlightCtor(...rangesFor('highlight')));
    highlights.set(UNDERLINE_NAME, new HighlightCtor(...rangesFor('underline')));
  }, [annotations]);

  useEffect(() => {
    applyHighlights();
  }, [applyHighlights]);

  /** 检测指针是否落在某个文本批注（高亮/划线）的渲染区域内，返回其 id */
  const hitTextAnnotation = (p: [number, number], list: Annotation[]): string | null => {
    const article = articleRef.current;
    if (!article) return null;
    const [x, y] = p;
    const nodes = collectTextNodes(article);
    const pad = 4;
    for (const a of list) {
      if (a.type !== 'highlight' && a.type !== 'underline') continue;
      if (a.start == null || a.end == null) continue;
      for (const n of nodes) {
        if (a.end <= n.start || a.start >= n.end) continue;
        const range = document.createRange();
        range.setStart(n.node, Math.max(0, a.start - n.start));
        range.setEnd(n.node, Math.min(n.node.data.length, a.end - n.start));
        for (const r of range.getClientRects()) {
          if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return a.id;
        }
      }
    }
    return null;
  };

  const toCanvasPoint = (e: ReactPointerEvent<HTMLElement>): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  /** 橡皮擦拖拽过程中已擦除的批注 id，pointerup 时一次性提交 */
  const erasedIds = useRef<Set<string>>(new Set());
  /** 拖拽过程中的实时预览列表（基于 annotations 过滤） */
  const erasePreview = useRef<Annotation[] | null>(null);
  /** 是否正在拖拽擦除 */
  const erasing = useRef(false);

  const eraseAt = (p: [number, number]) => {
    const list = erasePreview.current ?? annotations;
    // 笔迹类：检查点到点列的距离；文本类：检查指针是否落在渲染矩形内
    const hit =
      list.find(
        (a) =>
          (a.type === 'freehand' || a.type === 'line') &&
          a.points?.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < ERASER_HIT_RADIUS),
      )?.id ??
      hitTextAnnotation(
        [p[0] + (canvasRef.current?.getBoundingClientRect().left ?? 0), p[1] + (canvasRef.current?.getBoundingClientRect().top ?? 0)],
        list,
      );
    if (!hit || erasedIds.current.has(hit)) return;
    erasedIds.current.add(hit);
    erasePreview.current = list.filter((a) => a.id !== hit);
    draw(erasePreview.current);
    applyHighlights(erasePreview.current);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (tool === 'select') return;
    // 画笔/橡皮擦模式下禁用默认文本选择，避免拖拽时误选中文字
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    setSelPopup(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toCanvasPoint(e);
    if (tool === 'freehand') {
      drawingPoints.current = [p];
    } else {
      erasedIds.current = new Set();
      erasePreview.current = null;
      erasing.current = true;
      eraseAt(p);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (tool === 'eraser' && erasing.current) {
      eraseAt(toCanvasPoint(e));
      return;
    }
    if (tool !== 'freehand' || !drawingPoints.current.length) return;
    drawingPoints.current.push(toCanvasPoint(e));
    drawPreview();
  };

  const onPointerUp = () => {
    if (tool === 'eraser') {
      erasing.current = false;
      const removed = erasePreview.current;
      erasePreview.current = null;
      if (removed && erasedIds.current.size) onCommit(removed);
      return;
    }
    const points = drawingPoints.current;
    if (tool !== 'freehand' || !points.length) return;
    onCommit([...annotations, { id: uid(), type: 'freehand', points }]);
    drawingPoints.current = [];
  };

  /** 松开鼠标后检查选区，弹出高亮/划线工具栏 */
  const onMouseUp = () => {
    const article = articleRef.current;
    if (!article || tool !== 'select') {
      setSelPopup(null);
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount
      || !article.contains(selection.anchorNode) || !article.contains(selection.focusNode)) {
      setSelPopup(null);
      return;
    }
    const nodes = collectTextNodes(article);
    const offsetOf = (node: Node, offset: number) => {
      const hit = nodes.find((n) => n.node === node);
      return hit ? hit.start + offset : null;
    };
    const range = selection.getRangeAt(0);
    const start = offsetOf(range.startContainer, range.startOffset);
    const end = offsetOf(range.endContainer, range.endOffset);
    if (start == null || end == null || start === end) {
      setSelPopup(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setSelPopup({
      x: rect.left + rect.width / 2,
      y: rect.bottom,
      start: Math.min(start, end),
      end: Math.max(start, end),
      text: selection.toString(),
    });
  };

  const annotateText = (type: 'highlight' | 'underline') => {
    if (!selPopup) return;
    onCommit([...annotations, {
      id: uid(),
      type,
      start: selPopup.start,
      end: selPopup.end,
      text: selPopup.text,
      color: 'blue',
    }]);
    window.getSelection()?.removeAllRanges();
    setSelPopup(null);
  };

  const wordCount = material.split(/\s+/).filter(Boolean).length;

  return (
    <section className="material-pane">
      <div className="pane-head">
        <div>
          <span className="eyebrow">READING MATERIAL</span>
          <h2>{title}</h2>
        </div>
        <span className="badge">{wordCount} words</span>
      </div>
      <div
        className={`material-scroll${tool !== 'select' ? ` drawing tool-${tool}` : ''}`}
        ref={materialRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onMouseUp={onMouseUp}
        onScroll={() => setSelPopup(null)}
      >
        <article className="markdown" ref={articleRef} dangerouslySetInnerHTML={html} />
        <canvas ref={canvasRef} className="annotation-canvas" />
      </div>
      <div className="pane-foot">
        <button className="side-toggle" onClick={onToggleSidebar} title={sidebarOpen ? '收起目录' : '展开目录'}>
          {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>
        <button className={tool === 'select' ? 'selected' : ''} onClick={() => onToolChange('select')}><MousePointer2 size={14} /> 选择</button>
        <button className={tool === 'freehand' ? 'selected' : ''} onClick={() => onToolChange('freehand')}><PenLine size={14} /> 画笔</button>
        <button className={tool === 'eraser' ? 'selected' : ''} onClick={() => onToolChange('eraser')}><Eraser size={14} /> 橡皮擦</button>
        <div className="foot-actions">
          <button onClick={onUndo} disabled={!canUndo}><Undo2 size={14} /> 撤销</button>
          <button onClick={onRedo} disabled={!canRedo}><Redo2 size={14} /> 重做</button>
          <button className="danger" onClick={onClear}><Trash2 size={14} /> 清空批注</button>
        </div>
      </div>
      {selPopup && (
        <div className="sel-popup" style={{ left: selPopup.x, top: selPopup.y }}>
          <button onClick={() => annotateText('highlight')}><Highlighter size={14} /> 高亮</button>
          <button onClick={() => annotateText('underline')}><Underline size={14} /> 划线</button>
        </div>
      )}
    </section>
  );
}
