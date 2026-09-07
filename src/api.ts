import type { Annotation, Exam, ItemData } from './types';

// ---- Basic Auth 凭据：保存于 localStorage，写请求自动附带 Authorization 头 ----
const AUTH_KEY = 'classbuddy-auth';
/** 服务器返回 401 时通知（用于弹出登录表单）；参数为请求时是否已携带凭据：true 表示填错了/服务端不认，应提示错误 */
const authRequiredListeners = new Set<(hadCredentials: boolean) => void>();
/** 凭据保存/清除后通知（用于重试之前因 401 失败的写操作） */
const authChangedListeners = new Set<() => void>();
/** base64(user:pass)，空字符串表示未设置 */
let credentials = localStorage.getItem(AUTH_KEY) || '';

const encodeBasic = (user: string, pass: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${pass}`)));

export const hasCredentials = () => !!credentials;

/** 已保存的用户名（登录表单预填用），未设置时为空 */
export function currentUsername(): string {
  if (!credentials) return '';
  try {
    const raw = new TextDecoder().decode(Uint8Array.from(atob(credentials), (c) => c.charCodeAt(0)));
    return raw.slice(0, raw.indexOf(':'));
  } catch { return ''; }
}

export function setCredentials(user: string, pass: string) {
  credentials = encodeBasic(user, pass);
  localStorage.setItem(AUTH_KEY, credentials);
  authChangedListeners.forEach((fn) => fn());
}

/** 校验一组用户名/密码是否正确（不改动已保存凭据）。服务端未启用鉴权或无法连接时视为通过 */
export async function verifyAuth(user: string, pass: string): Promise<boolean> {
  const token = encodeBasic(user, pass);
  try {
    const res = await fetch('/api/auth/check', { headers: { Authorization: `Basic ${token}` } });
    if (res.status === 401) return false;
    return res.ok;
  } catch { return true; }
}

export function clearCredentials() {
  credentials = '';
  localStorage.removeItem(AUTH_KEY);
  authChangedListeners.forEach((fn) => fn());
}

export function onAuthRequired(fn: (hadCredentials: boolean) => void) { authRequiredListeners.add(fn); return () => { authRequiredListeners.delete(fn); }; }
export function onAuthChanged(fn: () => void) { authChangedListeners.add(fn); return () => { authChangedListeners.delete(fn); }; }

/** 统一处理失败响应：解析错误信息、401 时广播登录事件，抛出带 status 的错误。hadCredentials 记录本次请求是否已携带凭据 */
const fail = async (res: Response, fallback: string, hadCredentials = false): Promise<never> => {
  const body = await res.json().catch(() => null);
  if (res.status === 401) authRequiredListeners.forEach((fn) => fn(hadCredentials));
  const error = new Error(body?.error || fallback) as Error & { status?: number };
  error.status = res.status;
  throw error;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(credentials ? { Authorization: `Basic ${credentials}` } : {}), ...init?.headers } });
  if (!res.ok) await fail(res, '请求失败', !!credentials);
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
  if (!res.ok) await fail(res, '导出失败');
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
    headers: { 'Content-Type': 'application/zip', ...(credentials ? { Authorization: `Basic ${credentials}` } : {}) },
    body: file,
  });
  if (!res.ok) await fail(res, '导入失败', !!credentials);
  return res.json();
}

export function putAnnotations(exam: string, item: string, annotations: Annotation[]): Promise<unknown> {
  return request(`/api/items/${encodeURIComponent(exam)}/${encodeURIComponent(item)}/annotations`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ annotations }),
  });
}
