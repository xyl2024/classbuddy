import { FileText, GraduationCap, TriangleAlert } from 'lucide-react';
import type { Exam } from '../types';

interface HomePageProps {
  exams: Exam[];
  onOpen: (examId: string) => void;
}

/** 首页：展示已加载的考试集，点击进入工作台 */
export function HomePage({ exams, onOpen }: HomePageProps) {
  return (
    <main className="home">
      <header className="home-head">
        <div className="home-brand"><GraduationCap size={26} /> ClassBuddy</div>
        <h1>选择一份试卷开始讲课</h1>
      </header>
      {exams.length > 0 ? (
        <div className="exam-grid">
          {exams.map((exam) => {
            const invalid = exam.items.some((item) => !item.valid);
            return (
              <button key={exam.id} className="exam-card" onClick={() => onOpen(exam.id)}>
                <div className="exam-card-icon"><FileText size={22} strokeWidth={1.6} /></div>
                <h2>{exam.name}</h2>
                <p>
                  {exam.items.length} 个试题组
                  {invalid && (
                    <span className="exam-card-warning"><TriangleAlert size={12} /> 部分异常</span>
                  )}
                </p>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <h2>暂无已加载的试卷</h2>
          <p>请将试卷放入数据目录后刷新页面</p>
        </div>
      )}
    </main>
  );
}
