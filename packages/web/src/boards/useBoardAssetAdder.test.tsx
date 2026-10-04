import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  AssetSchema,
  BoardDocumentSchema,
  SaveBoardLayoutSchema,
  type BoardDocument,
} from '@cura/shared';
import { i18n } from '../i18n';
import { useBoardDocument } from './useBoardDocument';
import { useBoardAssetAdder } from './useBoardAssetAdder';
const boardId = '00000000-0000-4000-8000-000000000001';
const libraryId = '00000000-0000-4000-8000-000000000002';
const firstId = '00000000-0000-4000-8000-000000000003';
const secondId = '00000000-0000-4000-8000-000000000004';
const otherBoard = '00000000-0000-4000-8000-000000000005';
const stamp = '2026-10-04T00:00:00.000Z';
const document = (id = boardId): BoardDocument =>
  BoardDocumentSchema.parse({
    board: {
      id,
      libraryId,
      name: 'Ideas',
      kind: 'canvas',
      revision: 0,
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
const asset = (id: string) =>
  AssetSchema.parse({
    id,
    libraryId,
    rootId: libraryId,
    name: `${id}.png`,
    relativePath: 'image.png',
    hash: id,
    type: 'image/png',
    size: 128,
    width: 20,
    height: 20,
    colors: [],
    phash: '',
    exif: {},
    prompt: '',
    negativePrompt: '',
    model: '',
    seed: '',
    source: '',
    params: {},
    currentVersionId: id,
    rating: 0,
    note: '',
    folderId: null,
    deletedAt: null,
    finalized: false,
    tags: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function useEditor(id: string) {
  const state = useBoardDocument(id, libraryId);
  return { ...state, add: useBoardAssetAdder(id, state.mutate) };
}
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
it('retains both async additions and serializes writes using the latest committed revision', async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  let stored = document();
  const writes: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path === `/api/assets/${firstId}`) return first.promise;
      if (path === `/api/assets/${secondId}`) return second.promise;
      if (init?.method === 'PUT') {
        const layout = SaveBoardLayoutSchema.parse(
          JSON.parse(String(init.body)),
        );
        expect(layout.expectedRevision).toBe(stored.board.revision);
        writes.push(layout.expectedRevision);
        stored = {
          ...stored,
          board: { ...stored.board, revision: stored.board.revision + 1 },
          items: layout.items.map((item) => ({
            ...item,
            libraryId,
            boardId,
            createdAt: stamp,
            updatedAt: stamp,
          })),
          edges: [],
        };
      }
      return Response.json(stored);
    }),
  );
  const { result } = renderHook(() => useEditor(boardId));
  await waitFor(() => expect(result.current.document?.board.id).toBe(boardId));
  let a!: Promise<boolean>;
  let b!: Promise<boolean>;
  act(() => {
    a = result.current.add(
      { assetId: firstId, versionId: firstId },
      { x: 10, y: 20 },
    );
    b = result.current.add(
      { assetId: secondId, versionId: secondId },
      { x: 100, y: 200 },
    );
  });
  await act(async () => {
    second.resolve(Response.json(asset(secondId)));
    first.resolve(Response.json(asset(firstId)));
    await Promise.all([a, b]);
  });
  expect(writes).toEqual([0, 1]);
  expect(
    result.current.document?.items.map((item) => item.assetId).sort(),
  ).toEqual([firstId, secondId]);
  expect(stored.items.find((item) => item.assetId === firstId)).toMatchObject({
    x: 10,
    y: 20,
  });
  expect(stored.items.find((item) => item.assetId === secondId)).toMatchObject({
    x: 100,
    y: 200,
  });
});
it('drops an old board addition when its asset fetch resolves after navigation', async () => {
  const read = deferred<Response>();
  const fetch = vi.fn(async (path: string) =>
    path.startsWith('/api/assets/')
      ? read.promise
      : Response.json(
          document(path.endsWith(otherBoard) ? otherBoard : boardId),
        ),
  );
  vi.stubGlobal('fetch', fetch);
  const { result, rerender } = renderHook(({ id }) => useEditor(id), {
    initialProps: { id: boardId },
  });
  await waitFor(() => expect(result.current.document?.board.id).toBe(boardId));
  let pending!: Promise<boolean>;
  act(() => {
    pending = result.current.add(
      { assetId: firstId, versionId: firstId },
      { x: 10, y: 20 },
    );
  });
  rerender({ id: otherBoard });
  await waitFor(() =>
    expect(result.current.document?.board.id).toBe(otherBoard),
  );
  await act(async () => {
    read.resolve(Response.json(asset(firstId)));
    expect(await pending).toBe(false);
  });
  expect(
    fetch.mock.calls.filter(([path]) => path.endsWith('/layout')),
  ).toHaveLength(0);
  expect(result.current.document?.board.id).toBe(otherBoard);
});
it('ignores a previous board mutation response that arrives after navigation', async () => {
  const write = deferred<Response>();
  const fetch = vi.fn(async (path: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? write.promise
      : path.startsWith('/api/assets/')
        ? Response.json(asset(firstId))
        : Response.json(
            document(path.endsWith(otherBoard) ? otherBoard : boardId),
          ),
  );
  vi.stubGlobal('fetch', fetch);
  const { result, rerender } = renderHook(({ id }) => useEditor(id), {
    initialProps: { id: boardId },
  });
  await waitFor(() => expect(result.current.document?.board.id).toBe(boardId));
  let pending!: Promise<boolean>;
  act(() => {
    pending = result.current.add(
      { assetId: firstId, versionId: firstId },
      { x: 10, y: 20 },
    );
  });
  await waitFor(() =>
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(
      true,
    ),
  );
  rerender({ id: otherBoard });
  await waitFor(() =>
    expect(result.current.document?.board.id).toBe(otherBoard),
  );
  await act(async () => {
    write.resolve(
      Response.json({
        ...document(),
        board: { ...document().board, revision: 1 },
      }),
    );
    expect(await pending).toBe(false);
  });
  expect(result.current.document?.board.id).toBe(otherBoard);
  expect(result.current.busy).toBe(false);
});
it('does not save a pending asset read after the workspace unmounts', async () => {
  const read = deferred<Response>();
  const fetch = vi.fn(async (path: string) =>
    path.startsWith('/api/assets/') ? read.promise : Response.json(document()),
  );
  vi.stubGlobal('fetch', fetch);
  const { result, unmount } = renderHook(() => useEditor(boardId));
  await waitFor(() => expect(result.current.document?.board.id).toBe(boardId));
  const pending = result.current.add(
    { assetId: firstId, versionId: firstId },
    { x: 0, y: 0 },
  );
  unmount();
  read.resolve(Response.json(asset(firstId)));
  expect(await pending).toBe(false);
  expect(
    fetch.mock.calls.filter(([path]) => path.endsWith('/layout')),
  ).toHaveLength(0);
});

it('does not revive an old addition after navigating away and back to the same board', async () => {
  const read = deferred<Response>();
  const fetch = vi.fn(async (path: string) =>
    path.startsWith('/api/assets/')
      ? read.promise
      : Response.json(
          document(path.endsWith(otherBoard) ? otherBoard : boardId),
        ),
  );
  vi.stubGlobal('fetch', fetch);
  const { result, rerender } = renderHook(({ id }) => useEditor(id), {
    initialProps: { id: boardId },
  });
  await waitFor(() => expect(result.current.document?.board.id).toBe(boardId));
  const pending = result.current.add(
    { assetId: firstId, versionId: firstId },
    { x: 10, y: 20 },
  );
  rerender({ id: otherBoard });
  await waitFor(() =>
    expect(result.current.document?.board.id).toBe(otherBoard),
  );
  rerender({ id: boardId });
  await waitFor(() => expect(result.current.document?.board.id).toBe(boardId));
  await act(async () => {
    read.resolve(Response.json(asset(firstId)));
    expect(await pending).toBe(false);
  });
  expect(
    fetch.mock.calls.filter(([path]) => path.endsWith('/layout')),
  ).toHaveLength(0);
});
