import { useCallback, useEffect, useRef, useState } from 'react';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Form state that survives a page refresh (e.g. iOS Safari reloading a tab).
 * Storage failures (private mode, quota) are ignored — the form still works.
 */
export function useDraft<T extends object>(key: string, initial: T) {
  const storageKey = `thiran:draft:${key}`;
  const [value, setValue] = useState<T>(() => read(storageKey, initial));
  const initialJson = useRef(JSON.stringify(initial));

  useEffect(() => {
    try {
      const json = JSON.stringify(value);
      // An untouched/cleared form leaves nothing behind in storage.
      if (json === initialJson.current) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, json);
    } catch {
      /* ignore */
    }
  }, [storageKey, value]);

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    setValue(initial);
    // `initial` is a fresh literal each render; key identity is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  return [value, setValue, clear] as const;
}
