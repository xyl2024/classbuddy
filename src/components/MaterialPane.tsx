import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { marked } from 'marked';
import { Eraser, Highlighter, MousePointer2, PenLine, Redo2, Trash2, Underline, Undo2 } from 'lucide-react';
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

/** 点击高亮/划线内容后弹出的笔记编辑器 */
interface NoteEditor {
  id: string;
  x: number;
  y: number;
  value: string;
}

interface MaterialPaneProps {
  material: string;
  title: string;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  annotations: Annotation[];
  onCommit: (next: Annotation[]) => void;
  onClear: () => void;
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
  const [noteEditor, setNoteEditor] = useState<NoteEditor | null>(null);
  /** 选择工具下鼠标是否悬停在文本批注上，用于切换可点击光标 */
  const [hoverAnnotated, setHoverAnnotated] = useState(false);

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

  /** 选择工具下鼠标悬停在文本批注上时，光标变为可点击态 */
  const onMouseMove = (e: ReactMouseEvent<HTMLElement>) => {
    if (tool !== 'select') {
      if (hoverAnnotated) setHoverAnnotated(false);
      return;
    }
    setHoverAnnotated(!!hitTextAnnotation([e.clientX, e.clientY], annotations));
  };

  /** 计算文本批注所有渲染矩形的合集包围盒（视口坐标） */
  const annotationRect = (id: string, list: Annotation[]): DOMRect | null => {
    const article = articleRef.current;
    if (!article) return null;
    const a = list.find((x) => x.id === id);
    if (!a || a.start == null || a.end == null) return null;
    const nodes = collectTextNodes(article);
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const n of nodes) {
      if (a.end <= n.start || a.start >= n.end) continue;
      const range = document.createRange();
      range.setStart(n.node, Math.max(0, a.start - n.start));
      range.setEnd(n.node, Math.min(n.node.data.length, a.end - n.start));
      for (const rect of range.getClientRects()) {
        l = Math.min(l, rect.left); t = Math.min(t, rect.top);
        r = Math.max(r, rect.right); b = Math.max(b, rect.bottom);
      }
    }
    if (l === Infinity) return null;
    // 合成与 DOMRect 形状一致的对象，便于复用
    return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t } as DOMRect;
  };

  /** 松开鼠标后：拖选则弹出高亮/划线工具栏；单击在文本批注上则弹出笔记编辑器 */
  const onMouseUp = (e: ReactMouseEvent<HTMLElement>) => {
    const article = articleRef.current;
    if (!article || tool !== 'select') {
      setSelPopup(null);
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount
      || !article.contains(selection.anchorNode) || !article.contains(selection.focusNode)) {
      setSelPopup(null);
      // 单击（非拖选）：若点在高亮/划线内容上，弹出笔记编辑器，定位在内容上方
      const hitId = hitTextAnnotation([e.clientX, e.clientY], annotations);
      if (hitId) {
        const a = annotations.find((x) => x.id === hitId);
        const rect = a && annotationRect(hitId, annotations);
        if (a && rect) setNoteEditor({ id: hitId, x: rect.left + rect.width / 2, y: rect.top, value: a.note ?? '' });
      } else {
        setNoteEditor(null);
      }
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

  /** 保存笔记到对应文本批注；留空则清除笔记 */
  const saveNote = () => {
    if (!noteEditor) return;
    const note = noteEditor.value.trim();
    onCommit(annotations.map((a) => (a.id === noteEditor.id ? { ...a, note: note || undefined } : a)));
    setNoteEditor(null);
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
        className={`material-scroll${tool !== 'select' ? ` drawing tool-${tool}` : ''}${hoverAnnotated ? ' hover-annotated' : ''}`}
        ref={materialRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
        onScroll={() => { setSelPopup(null); setNoteEditor(null); }}
      >
        <article className="markdown" ref={articleRef} dangerouslySetInnerHTML={html} />
        <canvas ref={canvasRef} className="annotation-canvas" />
      </div>
      <div className="pane-foot">
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
      {noteEditor && (
        <div className="note-popup" style={{ left: noteEditor.x, top: noteEditor.y }}>
          <textarea
            autoFocus
            placeholder="填写笔记…"
            value={noteEditor.value}
            onChange={(e) => setNoteEditor({ ...noteEditor, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNoteEditor(null);
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveNote();
            }}
          />
          <div className="note-actions">
            <button onClick={() => setNoteEditor(null)}>取消</button>
            <button className="primary" onClick={saveNote}>保存</button>
          </div>
        </div>
      )}
    </section>
  );
}
