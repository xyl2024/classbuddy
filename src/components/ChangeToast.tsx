interface ChangeToastProps {
  onReload: () => void;
  onDismiss: () => void;
}

export function ChangeToast({ onReload, onDismiss }: ChangeToastProps) {
  return (
    <div className="change-toast">
      检测到数据文件变化
      <button onClick={onReload}>重新加载</button>
      <button onClick={onDismiss}>稍后</button>
    </div>
  );
}
