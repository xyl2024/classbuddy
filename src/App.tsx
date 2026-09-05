import { useCallback, useEffect, useState } from 'react';
import { fetchExaminations, fetchItem } from './api';
import { useAnnotations } from './hooks/useAnnotations';
import { Sidebar } from './components/Sidebar';
import { MaterialPane } from './components/MaterialPane';
import { QuestionsPane } from './components/QuestionsPane';
import { EmptyState } from './components/EmptyState';
import { ChangeToast } from './components/ChangeToast';
import type { Exam, ItemData, Selected, Tool } from './types';

export default function App() {
  const [exams, setExams] = useState<Exam[]>([]);
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

  if (!data || !selected) {
    return (
      <div className="app">
        <Sidebar exams={exams} selected={selected} onSelect={setSelected} />
        <main className="main">
          <EmptyState />
        </main>
        {changed && <ChangeToast onReload={() => location.reload()} onDismiss={() => setChanged(false)} />}
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar exams={exams} selected={selected} onSelect={setSelected} />
      <main className="main">
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
      </main>
      {changed && <ChangeToast onReload={() => location.reload()} onDismiss={() => setChanged(false)} />}
    </div>
  );
}
