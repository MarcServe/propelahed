import { useCallback, useMemo, useState } from "react";

function key(clientId: string, scope: string) {
  return `propelhed:mark:${clientId}:${scope}`;
}

function readIds(k: string): Set<string> {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((x) => String(x)));
  } catch {
    return new Set();
  }
}

function writeIds(k: string, ids: Set<string>) {
  localStorage.setItem(k, JSON.stringify([...ids]));
}

/**
 * Persists “marked” row ids in localStorage (per workspace + list).
 */
export function useListMarks(clientId: string, scope: string) {
  const storageKey = useMemo(() => key(clientId, scope), [clientId, scope]);
  const [ids, setIds] = useState(() => readIds(storageKey));

  const isMarked = useCallback((id: string | number) => ids.has(String(id)), [ids]);

  const toggleMark = useCallback(
    (id: string | number) => {
      const sid = String(id);
      setIds((prev) => {
        const next = new Set(prev);
        if (next.has(sid)) next.delete(sid);
        else next.add(sid);
        writeIds(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const rowClass = useCallback((id: string | number) => (isMarked(id) ? "list-row--marked" : ""), [isMarked]);

  return { isMarked, toggleMark, rowClass };
}
