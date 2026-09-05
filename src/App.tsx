import { useCallback, useEffect, useState } from 'react';
import { fetchExaminations, fetchItem } from './api';
import { useAnnotations } from './hooks/useAnnotations';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './components/HomePage';
import { MaterialPane } from './components/MaterialPane';
import { QuestionsPane } from './components/QuestionsPane';
import { EmptyState } from './components/EmptyState';
import { ChangeToast } from './components/ChangeToast';
import type { Exam, ItemData, Selected, Tool } from './types';

export default function App() {
  const [exams, setExams] = useState<Exam[]>([]);
  /** 首页选中的考试集；未选中时展示首页 */
  const [activeExam, setActiveExam] = useState<string>();
  const [selected, setSelected] = useState<Selected>();
  const [data, setData] = useState<ItemData>();
  const [tool, setTool] = useState<Tool>('select');
  const [changed, setChanged] = useState(false);

  const { annotations, reset, commit, save, undo, redo, canUndo, canRedo } = useAnnotations(selected);

  const loadExams = useCallback(() => {
    fetchExaminations().then(setExams).catch(() => setExams([]));
  }, []);

  useEffect(() => {
    loadExams();
    const events = new EventSource('/api/events');
    events.onmessage = () => setChanged(true);
    return () => events.close();
  }, [loadExams]);

  /** 首页选中试卷：进入工作台并默认打开第一个试题组 */
  const openExam = useCallback(
    (examId: string) => {
      const exam = exams.find((e) => e.id === examId);
      if (!exam) return;
      setActiveExam(examId);
      const first = exam.items.find((item) => item.valid) ?? exam.items[0];
      if (first) setSelected({ exam: examId, item: first.id });
    },
    [exams],
  );

  /** 返回首页 */
  const goHome = useCallback(() => {
    setActiveExam(undefined);
    setSelected(undefined);
    setData(undefined);
  }, []);

  /** 选中试题组后加载数据，并重置批注历史 */
  useEffect(() => {
    if (!selected) return;
    fetchItem(selected.exam, selected.item)
      .then((d) => {
        setData(d);
        reset(d.annotations?.annotations ?? []);
      })
      .catch((err) => alert(err.message));
  }, [selected, reset]);

  const toast = changed && (
    <ChangeToast onReload={() => location.reload()} onDismiss={() => setChanged(false)} />
  );

  if (!activeExam) {
    return (
      <div className="app">
        <HomePage exams={exams} onOpen={openExam} />
        {toast}
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        exam={exams.find((e) => e.id === activeExam)}
        selected={selected}
        onSelect={setSelected}
        onHome={goHome}
      />
      <main className="main">
        {data && selected ? (
          <div className="panes">
            <MaterialPane
              material={data.material}
              title={data.meta.name || selected.item}
              tool={tool}
              onToolChange={setTool}
              annotations={annotations}
              onCommit={commit}
              onClear={() => save([])}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={undo}
              onRedo={redo}
            />
            <QuestionsPane questions={data.questions} />
          </div>
        ) : (
          <EmptyState />
        )}
      </main>
      {toast}
    </div>
  );
}
