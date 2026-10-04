import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import { useBoardDocument } from './useBoardDocument';
const id = '00000000-0000-4000-8000-000000000001';
const libraryId = '00000000-0000-4000-8000-000000000002';
const stamp = '2026-10-04T00:00:00.000Z';
const document = (revision: number, boardId = id) => ({
  board: {
    id: boardId,
    libraryId,
    name: 'Ideas',
    kind: 'canvas',
    revision,
    viewport: { x: 0, y: 0, zoom: 1 },
    rows: [],
    columns: [],
    templateId: null,
    deletedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  },
  items: [],
  edges: [],
  slots: [],
});
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
it('reloads a conflicting revision and explains that the edit was not applied without retrying it', async () => {
  let reads = 0;
  const fetch = vi.fn(async (_path: string, init?: RequestInit) =>
    init?.method === 'PATCH'
      ? new Response(
          JSON.stringify({ code: 'REVISION_CONFLICT', error: 'Conflict' }),
          { status: 409 },
        )
      : new Response(JSON.stringify(document(reads++ === 0 ? 1 : 2))),
  );
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() => useBoardDocument(id, libraryId));
  await waitFor(() => expect(result.current.document?.board.revision).toBe(1));
  await act(async () => {
    await result.current.mutate(`/api/boards/${id}`, 'PATCH', (current) => ({
      name: 'Edit',
      expectedRevision: current.board.revision,
    }));
  });
  expect(result.current.document?.board.revision).toBe(2);
  expect(result.current.error).toMatch(/unconfirmed change was not applied/);
  expect(
    fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH'),
  ).toHaveLength(1);
});
it('rejects a board from another library', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(document(1)))),
  );
  const { result } = renderHook(() =>
    useBoardDocument(id, '00000000-0000-4000-8000-000000000003'),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.document).toBeNull();
  expect(result.current.error).toBeTruthy();
});
