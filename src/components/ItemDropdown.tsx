import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, TriangleAlert } from 'lucide-react';
import type { Exam } from '../types';

interface ItemDropdownProps {
  /** 当前考试集的试题组列表 */
  items: Exam['items'];
  /** 当前选中的试题组 id */
  value?: string;
  onSelect: (itemId: string) => void;
}

/** 底部工具栏的试题组下拉框：自绘弹层，风格与工具栏一致 */
export function ItemDropdown({ items, value, onSelect }: ItemDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = items.find((i) => i.id === value);
  const widest = 150;

  /** 点击组件外部时收起弹层 */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div className="item-dropdown" ref={rootRef} style={{ width: widest }}>
      <button
        className={`item-dropdown-btn${open ? ' open' : ''}`}
        style={{ width: '100%' }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="item-dropdown-label">{current?.name ?? '选择试题组'}</span>
        {current && !current.valid && <TriangleAlert size={12} className="item-dropdown-warn" />}
        <ChevronDown size={13} className={`item-dropdown-caret${open ? ' up' : ''}`} />
      </button>
      {open && (
        <div className="item-dropdown-menu">
          {items.map((item) => {
            const active = item.id === value;
            return (
              <button
                className={`item-dropdown-item${active ? ' active' : ''}`}
                onClick={() => {
                  onSelect(item.id);
                  setOpen(false);
                }}
              >
                <Check size={13} className="item-dropdown-check" />
                <span className="item-dropdown-label">{item.name}</span>
                {!item.valid && <span className="item-dropdown-warn-wrap"><TriangleAlert size={12} className="item-dropdown-warn" /></span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
