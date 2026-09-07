import type { Annotation, Exam, ItemData } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || '请求失败');
  }
  return res.json() as Promise<T>;
}

export function fetchExaminations(): Promise<Exam[]> {
  return request<Exam[]>('/api/examinations');
}

export function fetchItem(exam: string, item: string): Promise<ItemData> {
  return request<ItemData>(`/api/items/${encodeURIComponent(exam)}/${encodeURIComponent(item)}`);
}

/** 导出考试集：下载 zip 压缩包 */
export async function exportExam(exam: string): Promise<void> {
  const res = await fetch(`/api/examinations/${encodeURIComponent(exam)}/export`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || '导出失败');
  }
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `${exam}.zip`;
  link.click();
  URL.revokeObjectURL(url);
}

/** 导入考试集：上传 zip 压缩包，exam 为期望的考试集目录名（从文件名去除 .zip） */
export async function importExam(file: File, exam: string, overwrite = false): Promise<{ ok: boolean; exam: string }> {
  const query = overwrite ? '?overwrite=1' : '';
  const res = await fetch(`/api/examinations/${encodeURIComponent(exam)}${query}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/zip' },
    body: file,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const error = new Error(body?.error || '导入失败') as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export function putAnnotations(exam: string, item: string, annotations: Annotation[]): Promise<unknown> {
  return request(`/api/items/${encodeURIComponent(exam)}/${encodeURIComponent(item)}/annotations`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ annotations }),
  });
}
