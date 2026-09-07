import { useMemo } from 'react';
import { marked } from 'marked';
import { AnnotationSurface } from './AnnotationSurface';
import type { Annotation, Tool } from '../types';

interface MaterialPaneProps {
  material: string;
  /** 材料中的 {{blank:题号}} 标记是否渲染为空槽（选句填空/完形填空/语法填空短文） */
  blankSlots?: boolean;
  /** 题号 -> 已预览的答案文本（选项 key 或单词，语法填空为单词），空槽预览后同步显示 */
  blankReveals?: Record<string, string>;
  /** 预览答案文本是否为选项 key（选句填空/完形填空），用于选项配色；语法填空为单词，用固定色 */
  blankColorKeys?: boolean;
  /** 点击材料区空槽（切换该空答案预览，与题目区同步） */
  onBlankClick?: (label: string) => void;
  title: string;
  /** 材料区的批注列表（已按 target 过滤） */
  annotations: Annotation[];
  /** 提交材料区批注列表的完整新值 */
  onCommit: (next: Annotation[]) => void;
  /** 当前批注工具与画笔设置（与题目区共享） */
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  penColor: string;
  onPenColorChange: (color: string) => void;
  penWidth: number;
  onPenWidthChange: (width: number) => void;
}

export function MaterialPane({
  material,
  blankSlots,
  blankReveals,
  blankColorKeys = true,
  onBlankClick,
  title,
  annotations,
  onCommit,
  tool,
  onToolChange,
  penColor,
  onPenColorChange,
  penWidth,
  onPenWidthChange,
}: MaterialPaneProps) {
  /** 普通材料走 marked；内嵌短文按纯文本渲染，{{blank:16}} 替换为题号空槽（可附括号提示词），预览后同步显示答案 */
  const html = useMemo(() => {
    if (!blankSlots) return { __html: marked.parse(material) };
    const escaped = material.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const withSlots = escaped.replace(/\{\{blank:(\d+)\}\}/g, (_, label: string) => {
      const answer = blankReveals?.[label];
      if (!answer) return `<span class="material-blank" data-blank="${label}">${label}</span>`;
      if (blankColorKeys) {
        return `<span class="material-blank filled" data-blank="${label}">${label} <b>${answer}</b></span>`;
      }
      return `<span class="material-blank filled word" data-blank="${label}">${label} <b>${answer}</b></span>`;
    });
    return { __html: `<p>${withSlots.trim().replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br/>')}</p>` };
  }, [material, blankSlots, blankReveals, blankColorKeys]);

  /** 事件委托：点击空槽时通知父组件切换答案预览 */
  const onArticleClick = (e: React.MouseEvent) => {
    const slot = (e.target as HTMLElement).closest('.material-blank');
    const label = slot?.getAttribute('data-blank');
    if (label) onBlankClick?.(label);
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
      <AnnotationSurface
        scrollClass="material-scroll"
        target="material"
        highlightId="m"
        annotations={annotations}
        onCommit={onCommit}
        tool={tool}
        onToolChange={onToolChange}
        penColor={penColor}
        onPenColorChange={onPenColorChange}
        penWidth={penWidth}
        onPenWidthChange={onPenWidthChange}
      >
        <article className="markdown" dangerouslySetInnerHTML={html} onClick={onArticleClick} />
      </AnnotationSurface>
    </section>
  );
}
