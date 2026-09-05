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
            <button onClick={onRefresh} title="刷新目录">↻</button>
          </div>
          {exams.map((exam) => (
            <div key={exam.id} className="exam">
              <strong>⌄ {exam.name}</strong>
              {exam.items.map((item) => (
                <button
                  key={item.id}
                  className={isActive(exam, item) ? 'item active' : 'item'}
                  onClick={() => onSelect({ exam: exam.id, item: item.id })}
                >
                  📄 {item.name}
                  {!item.valid && <span className="warning">!</span>}
                </button>
              ))}
            </div>
          ))}
        </>
      )}
      <button className="side-toggle" onClick={onToggle} title={open ? '收起目录' : '展开目录'}>
        {open ? '« 收起' : '»'}
      </button>
    </aside>
  );
}
