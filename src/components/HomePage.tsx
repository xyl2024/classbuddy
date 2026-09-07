import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, GraduationCap, KeyRound, TriangleAlert, Upload } from 'lucide-react';
import type { Exam } from '../types';
import { exportExam, hasCredentials, importExam, onAuthChanged } from '../api';
import { AuthDialog } from './AuthDialog';

interface HomePageProps {
  exams: Exam[];
  onOpen: (examId: string) => void;
  /** 导入完成后刷新考试集列表 */
  onImported: () => void;
}

/** 首页：展示已加载的考试集，支持试卷上传/下载，点击进入工作台 */
export function HomePage({ exams, onOpen, onImported }: HomePageProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  /** 因 401 暂存的上传任务（等凭据保存后自动重试） */
  const pending = useRef<{ file: File; overwrite: boolean } | null>(null);

  /** 执行导入；401 时保留任务，等鉴权就绪后重试 */
  const runImport = useCallback(
    async (file: File, overwrite: boolean) => {
      const name = file.name.replace(/\.zip$/i, '');
      setImporting(true);
      pending.current = { file, overwrite };
      try {
        await importExam(file, name, overwrite);
        pending.current = null;
        onImported();
      } catch (err: any) {
        if (err?.status === 401) return; // 凭据保存后自动重试
        pending.current = null;
        if (err?.status !== 409) throw err;
        if (!confirm(`考试集“${err.message.match(/“(.+?)”/)?.[1] || name}”已存在，是否覆盖？`)) return;
        await runImport(file, true);
      } finally {
        setImporting(false);
      }
    },
    [onImported],
  );

  /** 凭据保存后，自动重试之前被 401 拒绝的上传 */
  useEffect(
    () =>
      onAuthChanged(() => {
        const task = pending.current;
        if (!task) return;
        pending.current = null;
        runImport(task.file, task.overwrite);
      }),
    [runImport],
  );

  /** 上传试卷：zip 压缩包；同名考试集需确认后覆盖 */
  const upload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      alert('请上传 zip 压缩包');
      return;
    }
    try {
      await runImport(file, false);
    } catch (err: any) {
      alert(err?.message || '导入失败');
    }
  };

  const download = async (examId: string) => {
    try {
      await exportExam(examId);
    } catch (err: any) {
      alert(err?.message || '下载失败');
    }
  };

  return (
    <main className="home">
      <header className="home-head">
        <div className="home-brand"><GraduationCap size={26} /> ClassBuddy</div>
        <h1>选择一份试卷开始讲课</h1>
        <p className="home-actions">
          <button className="upload-btn" onClick={() => fileInput.current?.click()} disabled={importing}>
            <Upload size={14} /> {importing ? '导入中…' : '上传试卷'}
          </button>
          <button className="upload-btn auth-btn" onClick={() => setAuthOpen(true)} title="设置服务端写接口的 Basic Auth 凭据">
            <KeyRound size={14} /> {hasCredentials() ? '鉴权已设置' : '鉴权设置'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = '';
            }}
          />
        </p>
      </header>
      {exams.length > 0 ? (
        <div className="exam-grid">
          {exams.map((exam) => {
            const invalid = exam.items.some((item) => !item.valid);
            return (
              <div key={exam.id} className="exam-card" role="button" onClick={() => onOpen(exam.id)}>
                <div className="exam-card-icon"><FileText size={22} strokeWidth={1.6} /></div>
                <h2>{exam.name}</h2>
                <p>
                  {exam.items.length} 个试题组
                  {invalid && (
                    <span className="exam-card-warning"><TriangleAlert size={12} /> 部分异常</span>
                  )}
                  <button
                    className="exam-card-download"
                    title="下载试卷"
                    onClick={(e) => { e.stopPropagation(); download(exam.id); }}
                  >
                    <Download size={14} />
                  </button>
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <div><Upload size={34} /></div>
          <h2>暂无已加载的试卷</h2>
          <p>点击“上传试卷”导入 zip 压缩包，即可开始使用</p>
        </div>
      )}
      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
    </main>
  );
}
