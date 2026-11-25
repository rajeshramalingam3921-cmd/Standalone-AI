import { useCallback, useEffect, useRef, useState } from 'react';
import type { Result } from './api';

export type Resource<T> =
  { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: T };

const LOADING = { state: 'loading' } as const;

/**
 * Loads data for `key`, reloads when the app becomes visible again (returning to
 * Safari on iPhone) and ignores out-of-order responses.
 */
export function useResource<T>(key: string, load: () => Promise<Result<T>>) {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const [res, setRes] = useState<{ key: string; value: Resource<T> }>({ key, value: LOADING });
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    const r = await loadRef.current();
    if (id !== seq.current) return; // superseded by a newer request or unmounted
    setRes({
      key,
      value: r.ok ? { state: 'ready', data: r.data } : { state: 'error', message: r.message },
    });
  }, [key]);

  useEffect(() => {
    const counter = seq;
    void reload();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      counter.current++;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  return [res.key === key ? res.value : LOADING, reload] as const;
}
