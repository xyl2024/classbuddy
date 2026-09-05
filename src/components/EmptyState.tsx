import { BookOpenText } from 'lucide-react';

export function EmptyState() {
  return (
    <div className="empty">
      <div className="empty-icon"><BookOpenText size={36} strokeWidth={1.5} /></div>
      <h2>选择一个试题组开始讲解</h2>
      <p>从左侧目录选择材料与题目</p>
    </div>
  );
}
