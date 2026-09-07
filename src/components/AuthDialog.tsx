import { FormEvent, useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { clearCredentials, currentUsername, hasCredentials, setCredentials, verifyAuth } from '../api';

interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
  /** 本次弹出时的错误提示（如：填写了错误的凭据被 401 拒绝） */
  error?: string | null;
}

/**
 * 接口鉴权表单：填入服务端 --auth 配置的用户名/密码。
 * 凭据保存在浏览器 localStorage，之后所有写操作（POST/PUT/DELETE）自动附带 Basic Auth 头。
 * 首页可手动打开；未设置凭据时写操作被 401 拒绝，也会自动弹出本表单。
 */
export function AuthDialog({ open, onClose, error }: AuthDialogProps) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [saved, setSaved] = useState(false);
  /** 本地校验错误：保存前先用 /api/auth/check 验证，失败则留在表单内提示，不覆盖原凭据 */
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (open) {
      setUser(currentUsername());
      setPass('');
      setSaved(false);
      setVerifyError(null);
    }
  }, [open]);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user.trim()) {
      alert('请填写用户名');
      return;
    }
    setVerifying(true);
    setVerifyError(null);
    const ok = await verifyAuth(user.trim(), pass);
    setVerifying(false);
    if (!ok) {
      setVerifyError('用户名或密码错误');
      return;
    }
    setCredentials(user.trim(), pass);
    setSaved(true);
    onClose();
  };

  return (
    <div className="dialog-mask" onClick={onClose}>
      <form className="dialog auth-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header className="dialog-head">
          <KeyRound size={18} />
          <h3>接口鉴权</h3>
          {hasCredentials() && <span className="auth-status">已设置</span>}
        </header>
        {error && <p className="dialog-error">{error}</p>}
        {verifyError && <p className="dialog-error">{verifyError}</p>}
        <label className="dialog-field">
          用户名
          <input value={user} onChange={(e) => setUser(e.target.value)} autoFocus autoComplete="username" placeholder="服务端 --auth 配置的用户名" />
        </label>
        <label className="dialog-field">
          密码
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" placeholder="服务端 --auth 配置的密码" />
        </label>
        <p className="dialog-hint">凭据仅保存在本浏览器，用于写操作（保存批注、导入等）的 HTTP Basic Auth 鉴权。</p>
        <footer className="dialog-foot">
          {hasCredentials() && (
            <button type="button" className="dialog-btn" onClick={() => { clearCredentials(); onClose(); }}>
              清除已保存
            </button>
          )}
          <button type="button" className="dialog-btn" onClick={onClose}>取消</button>
          <button type="submit" className="dialog-btn primary" disabled={verifying}>{verifying ? '验证中…' : '保存'}</button>
        </footer>
      </form>
    </div>
  );
}
