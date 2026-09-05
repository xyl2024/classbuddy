import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, TriangleAlert } from 'lucide-react';
import type { Exam, Item, Selected } from '../types';

interface SidebarProps {
  exams: Exam[];
  selected: Selected | undefined;
  open: boolean;
  onSelect: (target: Selected) => void;
}

export function Sidebar({ exams, selected, open, onSelect }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const isActive = (exam: Exam, item: Item) => selected?.exam === exam.id && selected.item === item.id;
  const toggleExam = (id: string) => setCollapsed((m) => ({ ...m, [id]: !m[id] }));

  return (
    <aside className={open ? 'sidebar' : 'sidebar collapsed'}>
      {open && (
        <>
          <h1 className="brand">ClassBuddy</h1>
          {exams.map((exam) => (
            <div key={exam.id} className="exam">
              <strong
                className={collapsed[exam.id] ? 'exam-toggle collapsed' : 'exam-toggle'}
                onClick={() => toggleExam(exam.id)}
              >
                {collapsed[exam.id] ? <ChevronRight size={14} /> : <ChevronDown size={14} />} {exam.name}
              </strong>
              {!collapsed[exam.id] && exam.items.map((item) => (
                <button
                  key={item.id}
                  className={isActive(exam, item) ? 'item active' : 'item'}
                  onClick={() => onSelect({ exam: exam.id, item: item.id })}
                >
                  <FileText size={14} className="item-icon" />
                  {item.name}
                  {!item.valid && <span className="warning"><TriangleAlert size={12} /></span>}
                </button>
              ))}
            </div>
          ))}
        </>
      )}
    </aside>
  );
}
