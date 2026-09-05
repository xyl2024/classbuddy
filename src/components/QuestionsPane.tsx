import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, RotateCcw } from 'lucide-react';
import type { DialogueChoiceQuestion, GapFillQuestion, Question, QuestionOption } from '../types';
import { optionColor } from '../optionColors';

interface QuestionsPaneProps {
  questions: Question[];
  meta?: {
    name?: string;
    instruction?: string;
    scorePerQuestion?: number;
    totalScore?: number;
    description?: string;
  };
  /** 选句填空：跨面板共享的逐空预览状态（App 持有，材料区空槽同步显示答案） */
  gap?: {
    revealed: Record<string, boolean>;
    onToggleBlank: (label: string) => void;
    onSetAll: (value: boolean) => void;
  };
}

/** 计算空白宽度：足以容纳最长的选项文本 */
function useBlankWidth(options: QuestionOption[]) {
  return useMemo(() => {
    if (typeof document === 'undefined') return 108;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return 108;
    context.font = '15px Georgia, serif';
    const longestOption = Math.max(...options.map((option) => context.measureText(option.text).width), 0);
    return Math.max(108, Math.ceil(longestOption + 16));
  }, [options]);
}

/** 将文本中的 {{blank}} 渲染为待补全空白，预览答案时填入正确选项 */
function BlankText({ text, options, revealed, answer }: { text: string; options: QuestionOption[]; revealed: boolean; answer: string }) {
  const blankWidth = useBlankWidth(options);
  const parts = text.split('{{blank}}');
  return (
    <>
      {parts.map((part, partIndex) => (
        <span key={partIndex}>
          {part}
          {partIndex < parts.length - 1 && (
            <span className={`blank-slot ${revealed ? 'filled' : ''}`} style={{ width: `${blankWidth}px` }}>
              {revealed ? answer : ''}
            </span>
          )}
        </span>
      ))}
    </>
  );
}

/** 对话内容：保持试卷原文排版，仅将 {{blank}} 渲染为待补全位置 */
function DialogueView({ dialogue, options, revealed, answer }: Pick<DialogueChoiceQuestion, 'dialogue' | 'options'> & { revealed: boolean; answer: string }) {
  const blankWidth = useBlankWidth(options);
  return (
    <div className="dialogue" aria-label="情景对话">
      {dialogue.map((line, index) => {
        const parts = line.text.split('{{blank}}');
        return (
          <div className="dialogue-line" key={`${line.speaker}-${index}`}>
            <span className="dialogue-mark">—</span>
            <span className="dialogue-text">
              {parts.map((part, partIndex) => (
                <span key={partIndex}>
                  {part}
                  {partIndex < parts.length - 1 && (
                    <span
                      className={`blank-slot ${revealed ? 'filled' : ''}`}
                      style={{ width: `${blankWidth}px` }}
                    >
                      {revealed ? answer : ''}
                    </span>
                  )}
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function QuestionOptions({
  question,
  revealed,
  picked,
  onPick,
}: {
  question: { options: QuestionOption[]; answer: string };
  revealed: boolean;
  picked?: string;
  onPick: (key: string) => void;
}) {
  return (
    <div className="options">
      {question.options.map((o) => {
        const classes = ['option'];
        if (revealed && o.key === question.answer) classes.push('correct');
        if (picked && picked === o.key && o.key !== question.answer) classes.push('wrong');
        return (
          <div className={classes.join(' ')} key={o.key} onClick={() => onPick(o.key)}>
            <b>{o.key}</b>
            {o.text}
          </div>
        );
      })}
    </div>
  );
}

/** 选句填空卡片：备选句子纯展示 + 逐空答案预览（短文在左侧材料区，预览状态由 App 同步到空槽） */
function GapFillCard({
  question,
  index,
  revealed,
  onToggleBlank,
  onSetAll,
}: {
  question: GapFillQuestion;
  index: number;
  /** 题号 label -> 是否已预览 */
  revealed: Record<string, boolean>;
  onToggleBlank: (label: string) => void;
  onSetAll: (value: boolean) => void;
}) {
  const groupRevealed = question.blanks.length > 0 && question.blanks.every((b) => revealed[b.label]);

  /** 某个选项对应的空是否已预览（预览后按选项配色高亮） */
  const optionRevealed = (key: string) =>
    question.blanks.some((b) => b.answer === key && revealed[b.label]);

  const firstLabel = question.blanks[0]?.label ?? String(index + 1);
  const lastLabel = question.blanks[question.blanks.length - 1]?.label ?? firstLabel;

  return (
    <div className="question gap-fill-question" id={`question-${index + 1}`}>
      <div className="q-title">
        <b>
          第{firstLabel}
          {firstLabel !== lastLabel ? `–${lastLabel}` : ''}题 · 选句填空
        </b>
        <span className="gap-actions">
          <button
            className="gap-reset"
            onClick={() => onSetAll(false)}
            title="收起全部答案"
            aria-label="收起全部答案"
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={() => onSetAll(!groupRevealed)}
            title={groupRevealed ? '隐藏全部答案' : '预览全部答案'}
            aria-label={groupRevealed ? '隐藏全部答案' : '预览全部答案'}
          >
            {groupRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </span>
      </div>
      {question.blanks.length === 0 && <p className="dialogue-fallback">请在数据中配置 blanks（每个空对应题号、答案与解析）。</p>}
      <div className="options gap-options">
        {question.options.map((o) => {
          const color = optionRevealed(o.key) ? optionColor(o.key) : undefined;
          return (
            <div
              className="option"
              key={o.key}
              style={color ? { background: color.bg, color: color.fg } : undefined}
            >
              <b style={color ? { color: color.fg } : undefined}>{o.key}</b>
              {o.text}
            </div>
          );
        })}
      </div>
      <div className="gap-blanks">
        {question.blanks.map((blank) => {
          const isRevealed = !!revealed[blank.label];
          const color = optionColor(blank.answer);
          return (
            <div className="gap-blank-row" key={blank.label}>
              <div className="gap-blank-head">
                <b>第{blank.label}题</b>
                <button
                  onClick={() => onToggleBlank(blank.label)}
                  title={isRevealed ? '隐藏答案' : '预览答案'}
                  aria-label={isRevealed ? '隐藏答案' : '预览答案'}
                >
                  {isRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              {isRevealed && (
                <div className="explanation">
                  <strong style={{ color: color.fg }}>答案：{blank.answer}</strong>
                  {blank.explanation && <p>{blank.explanation}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 单题的选项列表 + 答案解析展示 */
function QuestionCard({
  question,
  index,
  revealed,
  picked,
  onToggle,
  onPick,
}: {
  question: Exclude<Question, GapFillQuestion>;
  index: number;
  revealed: boolean;
  picked?: string;
  onToggle: () => void;
  onPick: (key: string) => void;
}) {
  const isDialogue = question.type === 'dialogue-choice';
  return (
    <div className={`question ${isDialogue ? 'dialogue-question' : ''}`} id={`question-${index + 1}`}>
      <div className="q-title">
        <b>
          {isDialogue
            ? `第${index + 1}题`
            : question.question.includes('{{blank}}')
              ? <BlankText text={question.question} options={question.options} revealed={revealed} answer={question.options.find((o) => o.key === question.answer)?.text ?? question.answer} />
              : question.question}
        </b>
        <button onClick={onToggle} title={revealed ? '隐藏答案' : '预览答案'} aria-label={revealed ? '隐藏答案' : '预览答案'}>
          {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
      {isDialogue && <DialogueView dialogue={question.dialogue} options={question.options} revealed={revealed} answer={question.options.find((o) => o.key === question.answer)?.text ?? question.answer} />}
      {isDialogue && question.dialogue.some((line) => line.text.includes('{{blank}}')) === false && <p className="dialogue-fallback">请在对话数据中使用 {'{{blank}}'} 标记待补全位置。</p>}
      <QuestionOptions question={question} revealed={revealed} picked={picked} onPick={onPick} />
      {revealed && (
        <div className="explanation">
          <strong>答案：{question.answer}</strong>
          {question.explanation && <p>{question.explanation}</p>}
        </div>
      )}
    </div>
  );
}

export function QuestionsPane({ questions, meta, gap }: QuestionsPaneProps) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});

  /** 切换试题组时收起全部答案 */
  useEffect(() => {
    setRevealed({});
    setPicked({});
  }, [questions]);

  const keyOf = (question: Question, index: number) => question.id ?? String(index);
  const allRevealed =
    questions.length > 0 &&
    questions.every((q, i) =>
      q.type === 'gap-fill'
        ? q.blanks.every((b) => !!gap?.revealed[b.label])
        : !!revealed[keyOf(q, i)],
    );

  const toggleAll = () => {
    if (allRevealed) {
      setRevealed({});
      gap?.onSetAll(false);
      return;
    }
    const next: Record<string, boolean> = {};
    questions.forEach((q, i) => {
      if (q.type !== 'gap-fill') next[keyOf(q, i)] = true;
    });
    setRevealed(next);
    gap?.onSetAll(true);
  };

  const toggleOne = (key: string) => {
    setRevealed((s) => ({ ...s, [key]: !s[key] }));
  };

  /** 点击选项：选错则标红并展示答案解析，选对则视为预览答案 */
  const pickOne = (key: string, optionKey: string) => {
    setPicked((s) => ({ ...s, [key]: optionKey }));
    setRevealed((s) => ({ ...s, [key]: true }));
  };

  return (
    <section className="questions-pane">
      <div className="pane-head">
        <div>
          <span className="eyebrow">QUESTIONS</span>
          <h2>{meta?.name || '题目讲解'}</h2>
          {meta?.instruction && <p className="section-instruction">{meta.instruction}</p>}
          {(meta?.scorePerQuestion != null || meta?.totalScore != null || meta?.description) && (
            <div className="section-meta">
              {meta.description && <span>{meta.description}</span>}
              {meta.scorePerQuestion != null && <span>每小题 {meta.scorePerQuestion} 分</span>}
              {meta.totalScore != null && <span>满分 {meta.totalScore} 分</span>}
            </div>
          )}
        </div>
        <button className="answer-toggle" onClick={toggleAll} title={allRevealed ? '隐藏全部答案' : '预览全部答案'} aria-label={allRevealed ? '隐藏全部答案' : '预览全部答案'}>
          {allRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <div className="questions">
        {questions.map((q, i) => {
          const key = keyOf(q, i);
          if (q.type === 'gap-fill') {
            return (
              <GapFillCard
                key={key}
                question={q}
                index={i}
                revealed={gap?.revealed ?? {}}
                onToggleBlank={(label) => gap?.onToggleBlank(label)}
                onSetAll={(value) => gap?.onSetAll(value)}
              />
            );
          }
          return (
            <QuestionCard
              key={key}
              question={q}
              index={i}
              revealed={!!revealed[key]}
              picked={picked[key]}
              onToggle={() => toggleOne(key)}
              onPick={(optionKey) => pickOne(key, optionKey)}
            />
          );
        })}
      </div>
    </section>
  );
}
