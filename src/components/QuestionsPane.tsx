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
  onToggle,
}: {
  question: Question;
  index: number;
  revealed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="question" id={`question-${index + 1}`}>
      <div className="q-title">
        <span>{index + 1}</span>
        <b>{question.question}</b>
        <button onClick={onToggle}>
          {revealed ? (<><EyeOff size={13} /> 隐藏答案</>) : (<><Eye size={13} /> 预览答案</>)}
        </button>
      </div>
      <div className="options">
        {question.options.map((o) => (
          <div className={revealed && o.key === question.answer ? 'option correct' : 'option'} key={o.key}>
            <b>{o.key}</b>
            {o.text}
          </div>
        ))}
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

  /** 切换试题组时收起全部答案 */
  useEffect(() => {
    setRevealed({});
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

  return (
    <section className="questions-pane">
      <div className="pane-head">
        <div>
          <span className="eyebrow">QUESTIONS</span>
          <h2>题目讲解</h2>
        </div>
        <button className="answer-toggle" onClick={toggleAll}>
          {allRevealed ? (<><EyeOff size={14} /> 隐藏全部答案</>) : (<><Eye size={14} /> 预览全部答案</>)}
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
              onToggle={() => toggleOne(key)}
            />
          );
        })}
      </div>
    </section>
  );
}
