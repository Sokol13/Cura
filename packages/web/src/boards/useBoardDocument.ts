import { useCallback, useEffect, useRef, useState } from 'react';
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
  const identity = useRef({ id, libraryId });
  const writing = useRef(false);
  current.current = document;
  identity.current = { id, libraryId };
  useEffect(() => {
    const abort = new AbortController();
    setDocument(null);
    setError('');
    setLoading(Boolean(id));
    if (id)
      void request(`/api/boards/${id}`, { signal: abort.signal })
        .then((raw) => {
          const next = BoardDocumentSchema.parse(raw);
          if (next.board.libraryId !== libraryId)
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
    async (
      path: string,
      method: string,
      body: (document: BoardDocument) => unknown,
    ): Promise<boolean> => {
      const snapshot = current.current;
      if (
        !snapshot ||
        writing.current ||
        snapshot.board.id !== identity.current.id ||
        snapshot.board.libraryId !== identity.current.libraryId
      )
        return false;
      writing.current = true;
      setBusy(true);
      const isCurrent = () =>
        identity.current.id === snapshot.board.id &&
        identity.current.libraryId === snapshot.board.libraryId;
      try {
        const next = BoardDocumentSchema.parse(
          await request(path, { method, body: body(snapshot) }),
        );
        if (isCurrent()) {
          current.current = next;
          setDocument(next);
          setError('');
        }
        return true;
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 409) {
          try {
            const next = BoardDocumentSchema.parse(
              await request(`/api/boards/${snapshot.board.id}`),
            );
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
        writing.current = false;
        setBusy(false);
      }
    },
    [t],
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
