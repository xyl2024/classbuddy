import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Eraser, Highlighter, House, MousePointer2, PenLine, Redo2, Trash2, Underline, Undo2 } from 'lucide-react';
import type { Annotation, AnnotationTarget, Exam, Tool } from '../types';
import { ItemDropdown } from './ItemDropdown';

const ERASER_HIT_RADIUS = 14;

/** 画笔可选颜色与粗细 */
const PEN_COLORS = ['#2e6fdf', '#d05a4e', '#ef8c47', '#267b49', '#7a4fd0', '#233247'];

/** 文本批注（高亮/划线）可选颜色：与画笔同色系，base 为划线颜色，bg 为高亮背景浅色 */
export const TEXT_COLORS = [
  { base: '#2e6fdf', bg: '#dbe9ff' },
  { base: '#d05a4e', bg: '#ffd9d6' },
  { base: '#ef8c47', bg: '#ffe4cc' },
  { base: '#267b49', bg: '#d9f2e0' },
  { base: '#7a4fd0', bg: '#e9ddfa' },
  { base: '#233247', bg: '#dde5ee' },
] as const;

/** 按批注存储的 color 找到颜色下标；旧数据（如 'blue'）或缺失时回退到首色 */
const textColorIndex = (color?: string) => {
  const i = TEXT_COLORS.findIndex((c) => c.base === color);
  return i >= 0 ? i : 0;
};

/** 将点列绘制为平滑笔触：先抽稀过近的点，再用中点二次贝塞尔连线 */
function strokePath(ctx: CanvasRenderingContext2D, points: [number, number][]) {
  const pts: [number, number][] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1.5) pts.push(p);
  }
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 2) {
    ctx.lineTo(pts[1][0], pts[1][1]);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i][0] + pts[i + 1][0]) / 2;
      const midY = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], midX, midY);
    }
    ctx.lineTo(...pts[pts.length - 1]);
  }
  ctx.stroke();
}

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

export interface AnnotationSurfaceProps {
  /** 滚动容器基础 class（如 material-scroll / questions-scroll），工具态 class 会附加其上 */
  scrollClass: string;
  /** 本面板的区域标识，新建批注时写入 target 字段 */
  target: AnnotationTarget;
  /** 本面板的批注列表（已按 target 过滤） */
  annotations: Annotation[];
  /** 提交本面板批注列表的完整新值（由上层记录历史并自动保存） */
  onCommit: (next: Annotation[]) => void;
  /** 收集文本偏移时排除的动态内容选择器（答案预览等会随交互出现/消失的节点），保证偏移量稳定 */
  excludeSelector?: string;
  /** 高亮命名后缀：两个面板各自注册独立的 CSS Custom Highlight 名称，互不覆盖 */
  highlightId: string;
  /** 当前批注工具（与画笔设置均由上层共享，材料区/题目区共用一套） */
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  penColor: string;
  onPenColorChange: (color: string) => void;
  penWidth: number;
  onPenWidthChange: (width: number) => void;
  children: ReactNode;
}

/** 按文档顺序收集 content 内所有非空文本节点及其全文偏移区间；可排除动态内容节点 */
function collectTextNodes(root: HTMLElement, excludeSelector?: string) {
  const nodes: { node: Text; start: number; end: number }[] = [];
  const skip = excludeSelector ? (n: Node) => !!n.parentElement?.closest(excludeSelector) : () => false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (!(node as Text).data.length || skip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let pos = 0;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const text = current as Text;
    nodes.push({ node: text, start: pos, end: pos + text.data.length });
    pos += text.data.length;
  }
  return nodes;
}

const uid = () => crypto.randomUUID();

/**
 * 可批注滚动面板：画布笔迹、文本高亮/划线（CSS Custom Highlight API）、
 * 选择/画笔/橡皮擦工具栏、笔记弹窗与撤销/重做入口。
 * 材料区与题目区共用，内容通过 children 提供。
 */
export function AnnotationSurface({
  scrollClass,
  target,
  annotations,
  onCommit,
  excludeSelector,
  highlightId,
  tool,
  onToolChange,
  penColor,
  onPenColorChange,
  penWidth,
  onPenWidthChange,
  children,
}: AnnotationSurfaceProps) {
  const highlightName = `cb-highlight-${highlightId}`;
  const underlineName = `cb-underline-${highlightId}`;  const hostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingPoints = useRef<[number, number][]>([]);
  const [selPopup, setSelPopup] = useState<SelectionPopup | null>(null);
  /** 选中文本后浮动工具栏中当前选中的高亮/划线颜色（下标，与画笔色系一致） */
  const [selColor, setSelColor] = useState(0);
  const [noteEditor, setNoteEditor] = useState<NoteEditor | null>(null);
  /** 选择工具下鼠标是否悬停在文本批注上，用于切换可点击光标 */
  const [hoverAnnotated, setHoverAnnotated] = useState(false);
  /** 单击命中批注或完成拖选后置位，在随后的 click 捕获阶段拦截面板内的点击（如选项预览） */
  const suppressClick = useRef(false);

  /** 重绘画布上已有的笔迹批注；可传入临时列表用于擦除预览 */
  const draw = useCallback((list: Annotation[] = annotations) => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const a of list) {
      if (a.type === 'highlight' || !a.points?.length) continue;
      ctx.lineWidth = a.width ?? 3;
      ctx.strokeStyle = a.type === 'line' ? '#ef6c47' : (a.color ?? '#2e6fdf');
      strokePath(ctx, a.points);
    }
  }, [annotations]);

  /** 在画布上预览正在绘制的笔迹 */
  const drawPreview = useCallback(() => {
    draw();
    const canvas = canvasRef.current;
    const points = drawingPoints.current;
    if (!canvas || !points.length) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = penColor;
    ctx.lineWidth = penWidth;
    strokePath(ctx, points);
  }, [draw, penColor, penWidth]);

  /** 画布尺寸跟随面板尺寸（隐藏画布后再测量，避免画布自身撑大 scrollHeight 的反馈） */
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    // 画布物理像素乘以 dpr，避免高分屏/缩放下笔迹模糊
    const dpr = window.devicePixelRatio || 1;
    canvas.style.display = 'none';
    const scrollHeight = host.scrollHeight;
    const clientWidth = host.clientWidth;
    canvas.style.display = '';
    canvas.width = clientWidth * dpr;
    canvas.height = scrollHeight * dpr;
    canvas.style.width = `${clientWidth}px`;
    canvas.style.height = `${scrollHeight}px`;
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(host);
    return () => observer.disconnect();
  }, [resizeCanvas]);

  useEffect(() => {
    draw();
  }, [draw]);

  /** 用 CSS Custom Highlight API 渲染文本高亮与划线；可传入临时列表用于擦除预览 */
  const applyHighlights = useCallback((list: Annotation[] = annotations) => {
    // CSS Custom Highlight API 目前 TS 标准库未内置类型，用 any 过渡
    const HighlightCtor = (window as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const content = contentRef.current;
    if (!content || !HighlightCtor || !highlights) return;
    const nodes = collectTextNodes(content, excludeSelector);
    /** 按颜色分组注册：每种颜色各占一个 highlight 名，样式在 styles.css 按下标预定义 */
    const applyFor = (type: 'highlight' | 'underline', prefix: string) => {
      for (let i = 0; i < TEXT_COLORS.length; i++) {
        const ranges: Range[] = [];
        for (const a of list) {
          if (a.type !== type || a.start == null || a.end == null || textColorIndex(a.color) !== i) continue;
          for (const n of nodes) {
            if (a.end <= n.start || a.start >= n.end) continue;
            const range = document.createRange();
            range.setStart(n.node, Math.max(0, a.start - n.start));
            range.setEnd(n.node, Math.min(n.node.data.length, a.end - n.start));
            ranges.push(range);
          }
        }
        highlights.set(`${prefix}-${i}`, new HighlightCtor(...ranges));
      }
    };
    applyFor('highlight', highlightName);
    applyFor('underline', underlineName);
  }, [annotations, excludeSelector, highlightName, underlineName]);

  useEffect(() => {
    applyHighlights();
  }, [applyHighlights]);

  /** 内容 DOM 变化（如答案预览出现/消失）后重绘笔迹并重算高亮范围 */
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const rerender = () => {
      resizeCanvas();
      applyHighlights();
    };
    const observer = new MutationObserver(rerender);
    observer.observe(content, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [resizeCanvas, applyHighlights]);

  /** 检测指针是否落在某个文本批注（高亮/划线）的渲染区域内，返回其 id */
  const hitTextAnnotation = (p: [number, number], list: Annotation[]): string | null => {
    const content = contentRef.current;
    if (!content) return null;
    const [x, y] = p;
    const nodes = collectTextNodes(content, excludeSelector);
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
          a.points?.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < ERASER_HIT_RADIUS + (a.width ?? 3) / 2),
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
    onCommit([...annotations, { id: uid(), type: 'freehand', target, points, color: penColor, width: penWidth }]);
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
    const content = contentRef.current;
    if (!content) return null;
    const a = list.find((x) => x.id === id);
    if (!a || a.start == null || a.end == null) return null;
    const nodes = collectTextNodes(content, excludeSelector);
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
    const content = contentRef.current;
    if (!content || tool !== 'select') {
      setSelPopup(null);
      return;
    }
    const selection = window.getSelection();
    const hasSelection = !!selection && !selection.isCollapsed && selection.rangeCount > 0
      && content.contains(selection.anchorNode) && content.contains(selection.focusNode);
    // 拖选或点击命中批注时，拦截随后的 click，避免触发选项预览等面板内点击行为
    suppressClick.current = true;
    if (!selection || !hasSelection) {
      setSelPopup(null);
      // 单击（非拖选）：若点在高亮/划线内容上，弹出笔记编辑器，定位在内容上方
      const hitId = hitTextAnnotation([e.clientX, e.clientY], annotations);
      if (hitId) {
        const a = annotations.find((x) => x.id === hitId);
        const rect = a && annotationRect(hitId, annotations);
        if (a && rect) setNoteEditor({ id: hitId, x: rect.left + rect.width / 2, y: rect.top, value: a.note ?? '' });
      } else {
        setNoteEditor(null);
        suppressClick.current = false;
      }
      return;
    }
    const nodes = collectTextNodes(content, excludeSelector);
    const offsetOf = (node: Node, offset: number) => {
      const hit = nodes.find((n) => n.node === node);
      return hit ? hit.start + offset : null;
    };
    const range = selection.getRangeAt(0);
    const start = offsetOf(range.startContainer, range.startOffset);
    const end = offsetOf(range.endContainer, range.endOffset);
    if (start == null || end == null || start === end) {
      setSelPopup(null);
      suppressClick.current = false;
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

  /** click 捕获阶段：刚刚完成拖选或点击批注时，拦截本次 click（阻止选项预览等默认点击行为） */
  const onClickCapture = (e: ReactMouseEvent<HTMLElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const annotateText = (type: 'highlight' | 'underline') => {
    if (!selPopup) return;
    onCommit([...annotations, {
      id: uid(),
      type,
      target,
      start: selPopup.start,
      end: selPopup.end,
      text: selPopup.text,
      color: TEXT_COLORS[selColor].base,
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

  return (
    <>
      <div
        className={`${scrollClass}${tool !== 'select' ? ` drawing tool-${tool}` : ''}${hoverAnnotated ? ' hover-annotated' : ''}`}
        ref={hostRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
        onClickCapture={onClickCapture}
        onScroll={() => { setSelPopup(null); setNoteEditor(null); }}
      >
        <div ref={contentRef} className="surface-content">
          {children}
        </div>
        <canvas ref={canvasRef} className="annotation-canvas" />
      </div>
      {selPopup && (
        <div className="sel-popup" style={{ left: selPopup.x, top: selPopup.y }}>
          {TEXT_COLORS.map((c, i) => (
            <button
              key={c.base}
              className={`sel-color${selColor === i ? ' selected' : ''}`}
             
              onClick={() => setSelColor(i)}
            >
              <i style={{ background: c.base }} />
            </button>
          ))}
          <span className="sel-sep" />
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
    </>
  );
}

export { uid as annotationId };

export interface AnnotationToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  penColor: string;
  onPenColorChange: (color: string) => void;
  penWidth: number;
  onPenWidthChange: (width: number) => void;
  /** 撤销/重做（整份批注历史） */
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** 清空全部批注（材料区 + 题目区） */
  onClear: () => void;
  /** 当前考试集与试题组：用于底部工具栏的试题组切换与返回首页 */
  exam?: Exam;
  selected?: { exam: string; item: string };
  onSelectItem: (itemId: string) => void;
  onHome: () => void;
}

/** 共享批注工具栏：材料区与题目区共用一套，置于工作台底部 */
export function AnnotationToolbar({
  tool,
  onToolChange,
  penColor,
  onPenColorChange,
  penWidth,
  onPenWidthChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  exam,
  selected,
  onSelectItem,
  onHome,
}: AnnotationToolbarProps) {
  const items = exam?.items ?? [];
  const currentIndex = selected ? items.findIndex((i) => i.id === selected.item) : -1;
  return (
    <div className="pane-foot workbench-foot">
      <button className="foot-home" onClick={onHome}><House size={14} /></button>
      <span className="pen-sep" />
      <span className="item-switch">
        <button disabled={currentIndex <= 0} onClick={() => currentIndex > 0 && onSelectItem(items[currentIndex - 1].id)}><ChevronLeft size={14} /></button>
        <ItemDropdown items={items} value={currentIndex >= 0 ? selected?.item : undefined} onSelect={onSelectItem} />
        <button disabled={currentIndex < 0 || currentIndex >= items.length - 1} onClick={() => currentIndex < items.length - 1 && onSelectItem(items[currentIndex + 1].id)}><ChevronRight size={14} /></button>
      </span>
      <span className="pen-sep" />
      <button className={tool === 'select' ? 'selected' : ''} onClick={() => onToolChange('select')}><MousePointer2 size={14} /></button>
      <button className={tool === 'freehand' ? 'selected' : ''} onClick={() => onToolChange('freehand')}><PenLine size={14} /></button>
      {tool === 'freehand' && (
        <span className="pen-options">
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              className={`pen-color${penColor === c ? ' selected' : ''}`}
             
              onClick={() => onPenColorChange(c)}
            >
              <i style={{ background: c }} />
            </button>
          ))}
          <span className="pen-sep" />
          <span className="pen-width-ctl">
            <input
              type="range"
              min={1}
              max={12}
              value={penWidth}
              onChange={(e) => onPenWidthChange(Number(e.target.value))}
            />
          </span>
        </span>
      )}
      <button className={tool === 'eraser' ? 'selected' : ''} onClick={() => onToolChange('eraser')}><Eraser size={14} /></button>
      <div className="foot-actions">
        <button onClick={onUndo} disabled={!canUndo}><Undo2 size={14} /></button>
        <button onClick={onRedo} disabled={!canRedo}><Redo2 size={14} /></button>
        <button className="danger" onClick={onClear}><Trash2 size={14} /></button>
      </div>
    </div>
  );
}
