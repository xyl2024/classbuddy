import { useCallback, useEffect, useRef, useState } from 'react';
import { putAnnotations, onAuthChanged } from '../api';
import type { Annotation, Selected } from '../types';

/**
 * 批注状态管理：批注列表、撤销/重做历史，以及自动保存。
 * 保存目标由当前选中的试题组（selected）决定。
 * 保存被 401 拒绝时暂存待保存内容，凭据设置完成后自动重试。
 */
export function useAnnotations(selected: Selected | undefined) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [history, setHistory] = useState<Annotation[][]>([]);
  const [future, setFuture] = useState<Annotation[][]>([]);
  /** 最近一次尚未保存成功的批注列表（401 时暂存，凭据就绪后重试） */
  const pending = useRef<Annotation[] | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  /** 载入新试题组时重置批注与历史 */
  const reset = useCallback((list: Annotation[]) => {
    setAnnotations(list);
    setHistory([]);
    setFuture([]);
  }, []);

  /** 覆盖当前批注并自动保存（用于清空批注） */
  const save = useCallback((next: Annotation[]) => {
    setAnnotations(next);
    if (!selectedRef.current) return;
    pending.current = next;
    putAnnotations(selectedRef.current.exam, selectedRef.current.item, next)
      .then(() => { pending.current = null; })
      .catch((err: any) => {
        // 401：等待用户在鉴权表单填好凭据后自动重试；其余失败直接提示
        if (err?.status === 401) return;
        pending.current = null;
        alert('批注保存失败');
      });
  }, []);

  /** 凭据保存后，自动重试之前未成功的保存 */
  useEffect(
    () =>
      onAuthChanged(() => {
        const next = pending.current;
        if (!next || !selectedRef.current) return;
        pending.current = null;
        save(next);
      }),
    [save],
  );

  /** 提交一次批注修改：记录历史并自动保存 */
  const commit = useCallback(
    (next: Annotation[]) => {
      setHistory((h) => [...h, annotations]);
      setFuture([]);
      save(next);
    },
    [annotations, save],
  );

  const undo = useCallback(() => {
    const prev = history.at(-1);
    if (!prev) return;
    setFuture((f) => [annotations, ...f]);
    setHistory(history.slice(0, -1));
    save(prev);
  }, [annotations, history, save]);

  const redo = useCallback(() => {
    const next = future.at(-1);
    if (!next) return;
    setHistory((h) => [...h, annotations]);
    setFuture(future.slice(0, -1));
    save(next);
  }, [annotations, future, save]);

  return {
    annotations,
    reset,
    commit,
    save,
    undo,
    redo,
    canUndo: history.length > 0,
    canRedo: future.length > 0,
  };
}
