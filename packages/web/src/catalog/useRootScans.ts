import { ScanSummariesSchema, type ScanSummary } from '@cura/shared';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { request } from './api';

function newerSummary(current: ScanSummary | undefined, next: ScanSummary) {
  if (!current) return next;
  if (current.scanId !== next.scanId) {
    if (next.startedAt < current.startedAt) return current;
    if (next.startedAt > current.startedAt) return next;
  } else {
    if (current.status !== 'running' && next.status === 'running')
      return current;
    if (
      next.processed < current.processed ||
      next.filesFound < current.filesFound
    )
      return current;
  }
  if (next.updatedAt < current.updatedAt) return current;
  return next;
}

export function useRootScans(
  libraryId: string,
  revision: number,
  onError: (error: unknown) => void,
) {
  const [state, setState] = useState<{
    libraryId: string;
    byRoot: Record<string, ScanSummary>;
  }>({ libraryId, byRoot: {} });
  const activeLibrary = useRef(libraryId);
  const liveSequence = useRef(0);
  const liveRoots = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    activeLibrary.current = libraryId;
    liveRoots.current.clear();
  }, [libraryId]);

  const receiveScanSummary = useCallback((summary: ScanSummary) => {
    if (summary.libraryId !== activeLibrary.current) return;
    liveSequence.current += 1;
    liveRoots.current.set(summary.rootId, liveSequence.current);
    setState((current) => {
      const byRoot =
        current.libraryId === summary.libraryId ? current.byRoot : {};
      const next = newerSummary(byRoot[summary.rootId], summary);
      if (byRoot[summary.rootId] === next) return current;
      return {
        libraryId: summary.libraryId,
        byRoot: { ...byRoot, [summary.rootId]: next },
      };
    });
  }, []);

  useEffect(() => {
    if (!libraryId) return;
    const controller = new AbortController();
    const startedSequence = liveSequence.current;
    void request(`/api/libraries/${encodeURIComponent(libraryId)}/scans`, {
      signal: controller.signal,
    })
      .then((value) => ScanSummariesSchema.parse(value))
      .then((summaries) => {
        if (controller.signal.aborted || activeLibrary.current !== libraryId)
          return;
        setState((current) => {
          const byRoot = {
            ...(current.libraryId === libraryId ? current.byRoot : {}),
          };
          for (const summary of summaries) {
            if (summary.libraryId !== libraryId) continue;
            // A response started before a live update cannot undo that update.
            if (
              (liveRoots.current.get(summary.rootId) ?? 0) > startedSequence &&
              byRoot[summary.rootId]
            )
              continue;
            byRoot[summary.rootId] = newerSummary(
              byRoot[summary.rootId],
              summary,
            );
          }
          return { libraryId, byRoot };
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && activeLibrary.current === libraryId)
          onError(error);
      });
    return () => controller.abort();
  }, [libraryId, revision, onError]);

  return {
    scans: state.libraryId === libraryId ? Object.values(state.byRoot) : [],
    receiveScanSummary,
  };
}
