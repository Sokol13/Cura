import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scanLibraryId, scanSummary } from './scan-test-fixtures';
import { useRootScans } from './useRootScans';

const fetchMock = vi.fn<typeof fetch>();
const reportError = vi.fn();
const ok = (value: unknown) => new Response(JSON.stringify(value));
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('persisted and live directory scans', () => {
  it('loads persisted completion initially and refreshes after reconnect invalidation', async () => {
    fetchMock.mockResolvedValueOnce(ok([scanSummary()]));
    const { result, rerender } = renderHook(
      ({ revision }) => useRootScans(scanLibraryId, revision, reportError),
      { initialProps: { revision: 0 } },
    );
    await waitFor(() =>
      expect(result.current.scans[0]?.status).toBe('completed'),
    );
    fetchMock.mockResolvedValueOnce(
      ok([
        scanSummary({
          status: 'partial',
          updatedAt: '2026-10-05T00:00:02.000Z',
        }),
      ]),
    );
    rerender({ revision: 1 });
    await waitFor(() =>
      expect(result.current.scans[0]?.status).toBe('partial'),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/libraries/${scanLibraryId}/scans`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('does not let an older API response replace a terminal live event', async () => {
    let resolve: ((value: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result } = renderHook(() =>
      useRootScans(scanLibraryId, 0, reportError),
    );
    act(() => result.current.receiveScanSummary(scanSummary()));
    await act(async () =>
      resolve?.(
        ok([
          scanSummary({
            status: 'running',
            phase: 'enumerating',
            finishedAt: null,
          }),
        ]),
      ),
    );
    expect(result.current.scans[0]?.status).toBe('completed');
    act(() =>
      result.current.receiveScanSummary(
        scanSummary({
          status: 'running',
          phase: 'processing',
          finishedAt: null,
        }),
      ),
    );
    expect(result.current.scans[0]?.status).toBe('completed');
  });

  it('rejects delayed requests and events from a previous library', async () => {
    let resolve: ((value: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fetchMock.mockResolvedValueOnce(ok([]));
    const { result, rerender } = renderHook(
      ({ libraryId }) => useRootScans(libraryId, 0, reportError),
      { initialProps: { libraryId: scanLibraryId } },
    );
    const previousReceiver = result.current.receiveScanSummary;
    const otherLibrary = '00000000-0000-4000-8000-000000000009';
    rerender({ libraryId: otherLibrary });
    await act(async () => resolve?.(ok([scanSummary()])));
    act(() => previousReceiver(scanSummary()));
    expect(result.current.scans).toEqual([]);
  });

  it('keeps a newer scan when an older run arrives after it', async () => {
    fetchMock.mockResolvedValueOnce(ok([]));
    const { result } = renderHook(() =>
      useRootScans(scanLibraryId, 0, reportError),
    );
    const current = scanSummary({
      scanId: '00000000-0000-4000-8000-000000000004',
      status: 'running',
      phase: 'enumerating',
      startedAt: '2026-10-05T00:01:00.000Z',
      updatedAt: '2026-10-05T00:01:00.000Z',
      finishedAt: null,
    });
    act(() => result.current.receiveScanSummary(current));
    act(() => result.current.receiveScanSummary(scanSummary()));
    expect(result.current.scans[0]?.scanId).toBe(current.scanId);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  });
});
