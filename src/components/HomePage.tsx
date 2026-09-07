import { useRef, useState } from 'react';
import { Download, FileText, GraduationCap, TriangleAlert, Upload } from 'lucide-react';
import type { Exam } from '../types';
import { exportExam, importExam } from '../api';

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

  /** 上传试卷：zip 压缩包；同名考试集需确认后覆盖 */
  const upload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      alert('请上传 zip 压缩包');
      return;
    }
    const name = file.name.replace(/\.zip$/i, '');
    try {
      setImporting(true);
      try {
        await importExam(file, name);
      } catch (err: any) {
        if (err?.status !== 409) throw err;
        if (!confirm(`考试集“${err.message.match(/“(.+?)”/)?.[1] || name}”已存在，是否覆盖？`)) return;
        await importExam(file, name, true);
      }
      onImported();
    } catch (err: any) {
      alert(err?.message || '导入失败');
    } finally {
      setImporting(false);
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
        <p>
          <button className="upload-btn" onClick={() => fileInput.current?.click()} disabled={importing}>
            <Upload size={14} /> {importing ? '导入中…' : '上传试卷'}
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
    </main>
  );
}
