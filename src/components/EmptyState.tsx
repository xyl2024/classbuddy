import { BookOpenText } from 'lucide-react';

export function EmptyState() {
  return (
    <div className="empty">
      <div className="empty-icon"><BookOpenText size={36} strokeWidth={1.5} /></div>
      <h2>正在加载试题组</h2>
      <p>请稍候，或从左侧选择其他试题组</p>
    </div>
  );
}
