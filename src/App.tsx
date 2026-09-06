import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchExaminations, fetchItem } from './api';
import { useAnnotations } from './hooks/useAnnotations';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './components/HomePage';
import { MaterialPane } from './components/MaterialPane';
import { QuestionsPane } from './components/QuestionsPane';
import { EmptyState } from './components/EmptyState';
import { ChangeToast } from './components/ChangeToast';
import type { ClozeQuestion, Exam, GapFillQuestion, GrammarFillQuestion, ItemData, Question, Selected, Tool } from './types';

/** 从路径解析路由：/ -> 首页；/:examId -> 工作台；/:examId/:itemId -> 指定试题组 */
function parsePath(pathname: string): { exam?: string; item?: string } {
  const seg = pathname.split('/').filter(Boolean);
  if (seg.length >= 2) return { exam: decodeURIComponent(seg[0]), item: decodeURIComponent(seg[1]) };
  if (seg.length === 1) return { exam: decodeURIComponent(seg[0]) };
  return {};
}

/** 内嵌短文的题型：选句填空 / 完形填空 / 语法填空 */
const isPassageQuestion = (q: Question): q is GapFillQuestion | ClozeQuestion | GrammarFillQuestion =>
  (q.type === 'gap-fill' || q.type === 'cloze' || q.type === 'grammar-fill') && !!q.passage;

/** 内嵌短文的题：短文本质就是材料，左侧材料区直接展示短文 */
const materialOf = (data: ItemData) =>
  data.questions.find(isPassageQuestion)?.passage ?? data.material;

export default function App() {
  const [exams, setExams] = useState<Exam[]>([]);
  /** 首页选中的考试集；未选中时展示首页 */
  const [activeExam, setActiveExam] = useState<string>();
  const [selected, setSelected] = useState<Selected>();
  const [data, setData] = useState<ItemData>();
  const [tool, setTool] = useState<Tool>('select');
  const [changed, setChanged] = useState(false);
  /** 选句填空：逐空预览状态（题号 -> 是否预览），由材料区空槽与题目区共享 */
  const [gapRevealed, setGapRevealed] = useState<Record<string, boolean>>({});

  const { annotations, reset, commit, save, undo, redo, canUndo, canRedo } = useAnnotations(selected);

  /** 当前试题组中内嵌短文的题（选句填空/完形填空，若有） */
  const passageQuestion = data?.questions.find(isPassageQuestion);

  /** 已预览空的答案文本，同步到材料区空槽 */
  const blankReveals = useMemo(() => {
    const map: Record<string, string> = {};
    if (passageQuestion) {
      for (const b of passageQuestion.blanks) {
        if (gapRevealed[b.label]) map[b.label] = b.answer;
      }
    }
    return map;
  }, [passageQuestion, gapRevealed]);

  /** 语法填空：空槽内的括号提示词 */
  const blankHints = useMemo(() => {
    const map: Record<string, string> = {};
    if (passageQuestion?.type === 'grammar-fill') {
      for (const b of passageQuestion.blanks) {
        if (b.hint) map[b.label] = b.hint;
      }
    }
    return map;
  }, [passageQuestion]);

  /** 语法填空答案为单词而非选项 key，空槽用固定色而非选项配色 */
  const blankColorKeys = passageQuestion?.type !== 'grammar-fill';

  /** 切换试题组时收起选句填空/完形填空答案 */
  useEffect(() => {
    setGapRevealed({});
  }, [selected]);

  const loadExams = useCallback(() => {
    fetchExaminations().then(setExams).catch(() => setExams([]));
  }, []);

  /** 根据路径应用路由状态；考试集不存在时回首页 */
  const applyPath = useCallback(
    (exams: Exam[]) => {
      const { exam: examId, item: itemId } = parsePath(location.pathname);
      if (!examId) {
        setActiveExam(undefined);
        setSelected(undefined);
        setData(undefined);
        return;
      }
      const exam = exams.find((e) => e.id === examId);
      if (!exam) {
        // 考试集列表尚未加载完成时暂不处理，避免误判回首页
        if (exams.length === 0) return;
        history.replaceState(null, '', '/');
        setActiveExam(undefined);
        setSelected(undefined);
        setData(undefined);
        return;
      }
      setActiveExam(examId);
      if (itemId && exam.items.some((i) => i.id === itemId)) {
        setSelected({ exam: examId, item: itemId });
      } else {
        const first = exam.items.find((item) => item.valid) ?? exam.items[0];
        setSelected(first ? { exam: examId, item: first.id } : undefined);
      }
    },
    [],
  );

  useEffect(() => {
    loadExams();
    const events = new EventSource('/api/events');
    events.onmessage = () => setChanged(true);
    return () => events.close();
  }, [loadExams]);

  /** 首次加载与浏览器前进/后退时按路径恢复状态 */
  useEffect(() => {
    applyPath(exams);
  }, [exams, applyPath]);

  useEffect(() => {
    const onPop = () => applyPath(exams);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [exams, applyPath]);

  /** 导航到指定路径并同步状态 */
  const navigate = useCallback(
    (examId?: string, itemId?: string) => {
      const seg = [examId, itemId].filter((v): v is string => !!v).map(encodeURIComponent).join('/');
      const path = seg ? `/${seg}` : '/';
      if (location.pathname !== path) history.pushState(null, '', path);
      applyPath(exams);
    },
    [exams, applyPath],
  );

  /** 首页选中试卷：进入工作台并默认打开第一个试题组 */
  const openExam = useCallback(
    (examId: string) => {
      const exam = exams.find((e) => e.id === examId);
      if (!exam) return;
      const first = exam.items.find((item) => item.valid) ?? exam.items[0];
      navigate(examId, first?.id);
    },
    [exams, navigate],
  );

  /** 返回首页 */
  const goHome = useCallback(() => {
    navigate();
  }, [navigate]);

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
        onSelect={(s) => navigate(s.exam, s.item)}
        onHome={goHome}
      />
      <main className="main">
        {data && selected ? (
          <div className={`panes ${data.meta.sectionType === 'situational-communication' || data.meta.sectionType === 'writing' ? 'single-pane' : ''}`}>
            {data.meta.sectionType !== 'situational-communication' && data.meta.sectionType !== 'writing' && (
              <MaterialPane
                material={materialOf(data)}
                blankSlots={data.meta.sectionType === 'gap-fill' || data.meta.sectionType === 'cloze' || data.meta.sectionType === 'grammar-fill'}
                blankReveals={blankReveals}
                blankHints={blankHints}
                blankColorKeys={blankColorKeys}
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
            )}
            <QuestionsPane
              questions={data.questions}
              meta={data.meta}
              blank={{
                revealed: gapRevealed,
                onToggleBlank: (label) => setGapRevealed((s) => ({ ...s, [label]: !s[label] })),
                onSetBlank: (label, value) => setGapRevealed((s) => ({ ...s, [label]: value })),
                onSetAll: (value) => {
                  const next: Record<string, boolean> = {};
                  passageQuestion?.blanks.forEach((b) => { next[b.label] = value; });
                  setGapRevealed(next);
                },
              }}
            />
          </div>
        ) : (
          <EmptyState />
        )}
      </main>
      {toast}
    </div>
  );
}
