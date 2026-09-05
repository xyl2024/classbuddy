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

  /** 重绘画布上已有的笔迹批注 */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const host = materialRef.current;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const a of annotations) {
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

  /** 用 CSS Custom Highlight API 渲染文本高亮与划线 */
  useEffect(() => {
    // CSS Custom Highlight API 目前 TS 标准库未内置类型，用 any 过渡
    const HighlightCtor = (window as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const article = articleRef.current;
    if (!article || !HighlightCtor || !highlights) return;
    const nodes = collectTextNodes(article);
    const rangesFor = (type: 'highlight' | 'underline') => {
      const ranges: Range[] = [];
      for (const a of annotations) {
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
  }, [annotations, material]);

  const toCanvasPoint = (e: ReactPointerEvent<HTMLElement>): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const eraseAt = (p: [number, number]) => {
    const hit = annotations.find((a) => a.points?.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < ERASER_HIT_RADIUS));
    if (hit) onCommit(annotations.filter((a) => a.id !== hit.id));
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
      eraseAt(p);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (tool !== 'freehand' || !drawingPoints.current.length) return;
    drawingPoints.current.push(toCanvasPoint(e));
    drawPreview();
  };

  const onPointerUp = () => {
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
        <span className="tool-hint">
          {tool === 'select' ? '选中文本可高亮或划线' : tool === 'eraser' ? '点击批注删除' : '拖拽进行标注'}
        </span>
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
