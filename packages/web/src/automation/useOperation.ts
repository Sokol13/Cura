import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../catalog/api';

export function useOperation(identity: string) {
  const origin = useMemo(
    () => ({
      identity,
      active: true,
      busy: false,
      controller: null as AbortController | null,
    }),
    [identity],
  );
  const current = useRef(origin);
  current.current = origin;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    origin.active = true;
    setBusy(false);
    setError('');
    return () => {
      origin.active = false;
      origin.controller?.abort();
    };
  }, [origin]);
  const run = useCallback(
    async <T>(
      task: (signal: AbortSignal) => Promise<T>,
      accept: (value: T) => void,
    ) => {
      if (origin.busy || !origin.active || current.current !== origin) return;
      origin.busy = true;
      const controller = new AbortController();
      origin.controller = controller;
      setBusy(true);
      setError('');
      const owned = () =>
        origin.active &&
        current.current === origin &&
        !controller.signal.aborted;
      try {
        const result = await task(controller.signal);
        if (owned()) accept(result);
      } catch (failure) {
        if (owned())
          setError(
            failure instanceof ApiError && failure.status === 409
              ? 'conflict'
              : (failure instanceof ApiError && failure.status === 400) ||
                  (failure instanceof Error && failure.name === 'ZodError')
                ? 'invalid'
                : 'saveError',
          );
      } finally {
        origin.busy = false;
        if (owned()) setBusy(false);
      }
    },
    [origin],
  );
  return {
    busy,
    error,
    conflict: error === 'conflict',
    run,
    dismiss: () => setError(''),
  };
}
