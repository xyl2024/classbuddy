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

export function putAnnotations(exam: string, item: string, annotations: Annotation[]): Promise<unknown> {
  return request(`/api/items/${encodeURIComponent(exam)}/${encodeURIComponent(item)}/annotations`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ annotations }),
  });
}
