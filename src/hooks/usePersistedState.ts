import { useCallback, useState } from "react";

/**
 * Like useState, but persists the value in localStorage under `flint_pref_<key>`.
 * Used to remember per-tool settings (format, quality, …) across sessions so
 * repeated chores don't need re-configuring every time.
 */
export function usePersistedState<T>(key: string, initial: T): [T, (value: T) => void] {
  const storageKey = `flint_pref_${key}`;

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // localStorage may be unavailable
      }
    },
    [storageKey],
  );

  return [value, set];
}
