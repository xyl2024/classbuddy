import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { Question } from '../types';

interface QuestionsPaneProps {
  questions: Question[];
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
  question: Question;
  index: number;
  revealed: boolean;
  picked?: string;
  onToggle: () => void;
  onPick: (key: string) => void;
}) {
  return (
    <div className="question" id={`question-${index + 1}`}>
      <div className="q-title">
        <b>{question.question}</b>
        <button onClick={onToggle} title={revealed ? '隐藏答案' : '预览答案'} aria-label={revealed ? '隐藏答案' : '预览答案'}>
          {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
      <div className="options">
        {question.options.map((o) => {
          const classes = ['option'];
          if (revealed && o.key === question.answer) classes.push('correct');
          if (picked && picked === o.key && o.key !== question.answer) classes.push('wrong');
          return (
            <div
              className={classes.join(' ')}
              key={o.key}
              onClick={() => onPick(o.key)}
            >
              <b>{o.key}</b>
              {o.text}
            </div>
          );
        })}
      </div>
      {revealed && (
        <div className="explanation">
          <strong>答案：{question.answer}</strong>
          {question.explanation && <p>{question.explanation}</p>}
        </div>
      )}
    </div>
  );
}

export function QuestionsPane({ questions }: QuestionsPaneProps) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});

  /** 切换试题组时收起全部答案 */
  useEffect(() => {
    setRevealed({});
    setPicked({});
  }, [questions]);

  const keyOf = (question: Question, index: number) => question.id ?? String(index);
  const allRevealed = questions.length > 0 && questions.every((q, i) => revealed[keyOf(q, i)]);

  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    questions.forEach((q, i) => {
      next[keyOf(q, i)] = !allRevealed;
    });
    setRevealed(next);
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
          <h2>题目讲解</h2>
        </div>
        <button className="answer-toggle" onClick={toggleAll} title={allRevealed ? '隐藏全部答案' : '预览全部答案'} aria-label={allRevealed ? '隐藏全部答案' : '预览全部答案'}>
          {allRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <div className="questions">
        {questions.map((q, i) => {
          const key = keyOf(q, i);
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
