import { useCallback, useState } from 'react';
import { putAnnotations } from '../api';
import type { Annotation, Selected } from '../types';

/**
 * 批注状态管理：批注列表、撤销/重做历史，以及自动保存。
 * 保存目标由当前选中的试题组（selected）决定。
 */
export function useAnnotations(selected: Selected | undefined) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [history, setHistory] = useState<Annotation[][]>([]);
  const [future, setFuture] = useState<Annotation[][]>([]);

  /** 载入新试题组时重置批注与历史 */
  const reset = useCallback((list: Annotation[]) => {
    setAnnotations(list);
    setHistory([]);
    setFuture([]);
  }, []);

  /** 覆盖当前批注并自动保存（用于清空批注） */
  const save = useCallback(
    (next: Annotation[]) => {
      setAnnotations(next);
      if (!selected) return;
      putAnnotations(selected.exam, selected.item, next).catch(() => alert('批注保存失败'));
    },
    [selected],
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
