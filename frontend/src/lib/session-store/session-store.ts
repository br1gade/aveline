/**
 * One value kept in this tab's `sessionStorage` under one name, read back only when it still has
 * the shape it was written in. Storage the browser refuses (a private window, blocked site data,
 * a full quota) or a value of another shape reads as nothing, so the page carries on as if none had
 * been kept. Never put a capability token in the name (frontend/CLAUDE.md §4).
 */
export interface SessionValue<T> {
  read: () => T | null;
  write: (value: T) => void;
  clear: () => void;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function sessionValue<T>(
  name: string,
  isValue: (value: unknown) => value is T,
): SessionValue<T> {
  return {
    read: () => {
      try {
        const raw = storage()?.getItem(name);
        if (!raw) return null;
        const value: unknown = JSON.parse(raw);
        return isValue(value) ? value : null;
      } catch {
        return null;
      }
    },
    write: (value) => {
      try {
        storage()?.setItem(name, JSON.stringify(value));
      } catch {
        // Refused or full: the value lives in memory alone, as if no store were here.
      }
    },
    clear: () => {
      try {
        storage()?.removeItem(name);
      } catch {
        // Nothing was stored.
      }
    },
  };
}
