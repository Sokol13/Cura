import { useCallback, useEffect, useRef, useState } from 'react';
import { SyncStatusSchema, type SyncStatus } from '@cura/shared';
import { ApiError, request as catalogRequest } from '../catalog/api';

export function syncRequest<T>(
  path: string,
  options: Parameters<typeof catalogRequest>[1] = {},
): Promise<T> {
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(30_000),
  ]);
  return catalogRequest<T>(path, { ...options, signal });
}

export type SyncMutation = (
  operation: (signal: AbortSignal) => Promise<SyncStatus | void>,
) => Promise<boolean>;
export const syncError = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;
export const isActiveSync = (state: string) =>
  state === 'initializing' || state === 'syncing';

export function useSyncClient(libraryId: string, fallbackError: string) {
  const [snapshot, setSnapshot] = useState<{
    libraryId: string;
    value: SyncStatus;
  }>();
  const [error, setError] = useState('');
  const [busyLibraryId, setBusyLibraryId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0),
    generation = useRef(0),
    pending = useRef(false);
  const action = useRef<AbortController | null>(null);
  const status = snapshot?.libraryId === libraryId ? snapshot.value : undefined;
  const busy = busyLibraryId === libraryId;
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const ticket = ++sequence.current;
      const value = SyncStatusSchema.parse(
        await syncRequest('/api/sync/status', signal ? { signal } : {}),
      );
      if (!signal?.aborted && ticket === sequence.current)
        setSnapshot({ libraryId, value });
    },
    [libraryId],
  );
  const report = useCallback(
    (reason: unknown) => setError(syncError(reason, fallbackError)),
    [fallbackError],
  );
  const invalidate = useCallback(() => {
    action.current?.abort();
    sequence.current++;
    generation.current++;
    pending.current = false;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) report(reason);
    });
    return () => {
      controller.abort();
      invalidate();
    };
  }, [refresh, report, invalidate]);
  useEffect(() => {
    if (busy || !status?.links.some((link) => isActiveSync(link.state))) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void refresh(controller.signal).catch((reason: unknown) => {
        if (!controller.signal.aborted) report(reason);
      });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [status, busy, refresh, report]);
  const mutate: SyncMutation = async (operation) => {
    if (pending.current) return false;
    pending.current = true;
    const controller = new AbortController(),
      ticket = generation.current;
    action.current = controller;
    setBusyLibraryId(libraryId);
    setError('');
    try {
      const value = await operation(controller.signal);
      if (controller.signal.aborted || ticket !== generation.current)
        return false;
      if (value) {
        sequence.current++;
        setSnapshot({ libraryId, value });
      }
      await refresh(controller.signal);
      if (controller.signal.aborted || ticket !== generation.current)
        return false;
      setRevision((value) => value + 1);
      return true;
    } catch (reason) {
      if (!controller.signal.aborted && ticket === generation.current)
        report(reason);
      return false;
    } finally {
      if (ticket === generation.current) {
        pending.current = false;
        action.current = null;
        setBusyLibraryId(null);
      }
    }
  };
  return { status, error, busy, revision, mutate, refresh };
}
