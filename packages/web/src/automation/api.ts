import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import { request } from '../catalog/api';
export const automationUrl = (libraryId: string, resource = '') =>
  `/api/libraries/${encodeURIComponent(libraryId)}/automation${resource ? `/${resource}` : ''}`;
export type PageData<T> = { items: T[]; total: number };
export function useAutomationPage<T>(
  url: string,
  schema: { parse: (raw: unknown) => PageData<T> },
) {
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const key = `${url}|${offset}|${revision}`;
  const [settled, setSettled] = useState<{
    key: string;
    data: PageData<T>;
    error: boolean;
  }>({ key: '', data: { items: [], total: 0 }, error: false });
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const setData = useCallback(
    (next: SetStateAction<PageData<T>>) =>
      setSettled((current) => ({
        ...current,
        data: typeof next === 'function' ? next(current.data) : next,
      })),
    [],
  );
  useEffect(() => {
    const abort = new AbortController();
    void request(
      `${url}${url.includes('?') ? '&' : '?'}offset=${offset}&limit=30`,
      { signal: abort.signal },
    )
      .then((raw) => {
        const data = schema.parse(raw);
        if (!abort.signal.aborted) setSettled({ key, data, error: false });
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setSettled((previous) => ({ ...previous, key, error: true }));
      });
    return () => abort.abort();
  }, [url, schema, offset, key]);
  const loading = settled.key !== key;
  return {
    data: settled.data,
    setData,
    offset,
    setOffset,
    loading,
    error: !loading && settled.error,
    refresh,
  };
}
