import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardDocumentSchema, type BoardDocument } from '@cura/shared';
import { useTranslation } from 'react-i18next';
import { ApiError, request } from '../catalog/api';
import './i18n';

export function useBoardDocument(id: string | null, libraryId: string) {
  const { t } = useTranslation('boards');
  const [document, setDocument] = useState<BoardDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const current = useRef(document);
  const origin = useMemo(() => ({ id, libraryId }), [id, libraryId]);
  const identity = useRef(origin);
  const active = useRef(true);
  const queue = useRef({ origin, tail: Promise.resolve() });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  current.current = document;
  identity.current = origin;
  useEffect(() => {
    const abort = new AbortController();
    setDocument(null);
    setBusy(false);
    setError('');
    setLoading(Boolean(id));
    if (id)
      void request(`/api/boards/${id}`, { signal: abort.signal })
        .then((raw) => {
          const next = BoardDocumentSchema.parse(raw);
          if (next.board.id !== id || next.board.libraryId !== libraryId)
            throw new Error('Library mismatch');
          if (!abort.signal.aborted) setDocument(next);
        })
        .catch(() => {
          if (!abort.signal.aborted) setError(t('loadError'));
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    return () => abort.abort();
  }, [id, libraryId, retry, t]);
  const mutate = useCallback(
    (
      path: string,
      method: string,
      body: (document: BoardDocument) => unknown,
    ): Promise<boolean> => {
      if (!active.current || identity.current !== origin)
        return Promise.resolve(false);
      if (queue.current.origin !== origin)
        queue.current = { origin, tail: Promise.resolve() };
      const execute = async () => {
        const snapshot = current.current;
        if (
          !snapshot ||
          !active.current ||
          identity.current !== origin ||
          snapshot.board.id !== identity.current.id ||
          snapshot.board.libraryId !== identity.current.libraryId
        )
          return false;
        setBusy(true);
        const isCurrent = () =>
          active.current &&
          identity.current === origin &&
          identity.current.id === snapshot.board.id &&
          identity.current.libraryId === snapshot.board.libraryId;
        try {
          const next = BoardDocumentSchema.parse(
            await request(path, { method, body: body(snapshot) }),
          );
          if (
            next.board.id !== snapshot.board.id ||
            next.board.libraryId !== snapshot.board.libraryId
          )
            throw new Error('Board response mismatch');
          if (isCurrent()) {
            current.current = next;
            setDocument(next);
            setError('');
          }
          return isCurrent();
        } catch (failure) {
          if (failure instanceof ApiError && failure.status === 409) {
            try {
              const next = BoardDocumentSchema.parse(
                await request(`/api/boards/${snapshot.board.id}`),
              );
              if (
                next.board.id !== snapshot.board.id ||
                next.board.libraryId !== snapshot.board.libraryId
              )
                throw new Error('Board response mismatch');
              if (isCurrent()) {
                current.current = next;
                setDocument(next);
                setError(t('conflict'));
              }
            } catch {
              if (isCurrent()) setError(t('loadError'));
            }
          } else if (isCurrent()) {
            setDocument({ ...snapshot });
            setError(t('saveError'));
          }
          return false;
        } finally {
          if (isCurrent()) setBusy(false);
        }
      };
      const pending = queue.current.tail.then(execute);
      queue.current.tail = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
    [origin, t],
  );
  return {
    document,
    loading,
    busy,
    error,
    mutate,
    dismissError: () => setError(''),
    refresh: () => setRetry((value) => value + 1),
  };
}
