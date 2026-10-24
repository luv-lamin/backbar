import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';

// A tiny change counter: any write calls `changed()`, and screens re-run their queries.
const Ctx = createContext<{ version: number; changed: () => void }>({ version: 0, changed: () => {} });

export function DataProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion(v => v + 1), []);
  return <Ctx.Provider value={{ version, changed }}>{children}</Ctx.Provider>;
}

export function useChanged() {
  return useContext(Ctx).changed;
}

/** Runs `load` on mount and after every write anywhere in the app. */
export function useQuery<T>(load: (db: SQLiteDatabase) => Promise<T>, initial: T): T {
  const db = useSQLiteContext();
  const { version } = useContext(Ctx);
  const [data, setData] = useState<T>(initial);
  useEffect(() => {
    let live = true;
    load(db).then(d => live && setData(d));
    return () => { live = false; };
    // `load` is usually an inline arrow; re-running on version is what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version]);
  return data;
}
