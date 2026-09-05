import { ChevronDown, FileText, PanelLeftClose, PanelLeftOpen, RefreshCw, TriangleAlert } from 'lucide-react';
import type { Exam, Item, Selected } from '../types';

interface SidebarProps {
  exams: Exam[];
  selected: Selected | undefined;
  open: boolean;
  onSelect: (target: Selected) => void;
  onToggle: () => void;
  onRefresh: () => void;
}

export function Sidebar({ exams, selected, open, onSelect, onToggle, onRefresh }: SidebarProps) {
  const isActive = (exam: Exam, item: Item) => selected?.exam === exam.id && selected.item === item.id;

  return (
    <aside className={open ? 'sidebar' : 'sidebar collapsed'}>
      {open && (
        <>
          <div className="side-title">
            内容目录
            <button className="icon-btn" onClick={onRefresh} title="刷新目录"><RefreshCw size={15} /></button>
          </div>
          {exams.map((exam) => (
            <div key={exam.id} className="exam">
              <strong><ChevronDown size={14} /> {exam.name}</strong>
              {exam.items.map((item) => (
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
      <button className="side-toggle" onClick={onToggle} title={open ? '收起目录' : '展开目录'}>
        {open ? (<><PanelLeftClose size={14} /> 收起</>) : <PanelLeftOpen size={14} />}
      </button>
    </aside>
  );
}
