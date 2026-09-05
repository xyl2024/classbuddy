import { FileText, TriangleAlert } from 'lucide-react';
import type { Exam, Selected } from '../types';

interface SidebarProps {
  /** 当前打开的考试集（侧边栏只展示这一份试卷的试题组） */
  exam: Exam | undefined;
  selected: Selected | undefined;
  onSelect: (target: Selected) => void;
  onHome: () => void;
}

/** 工作台侧边栏：仅展示当前试卷的试题组列表 */
export function Sidebar({ exam, selected, onSelect, onHome }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand" onClick={onHome}>ClassBuddy</div>
      {exam && (
        <>
          <div className="exam-name">{exam.name}</div>
          <nav className="item-list">
            {exam.items.map((item) => {
              const active = selected?.exam === exam.id && selected.item === item.id;
              return (
                <button
                  key={item.id}
                  className={active ? 'item active' : 'item'}
                  onClick={() => onSelect({ exam: exam.id, item: item.id })}
                >
                  <FileText size={14} className="item-icon" />
                  {item.name}
                  {!item.valid && (
                    <span className="warning" title="该试题组文件异常"><TriangleAlert size={12} /></span>
                  )}
                </button>
              );
            })}
          </nav>
        </>
      )}
    </aside>
  );
}
