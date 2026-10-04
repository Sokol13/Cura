import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import { BoardsWorkspace } from './BoardsWorkspace';
const id = '00000000-0000-4000-8000-000000000001';
const libraryId = '00000000-0000-4000-8000-000000000002';
const stamp = '2026-10-04T00:00:00.000Z';
const board = {
  id,
  libraryId,
  name: 'Character matrix',
  kind: 'matrix',
  revision: 0,
  viewport: { x: 0, y: 0, zoom: 1 },
  rows: [{ id, label: 'Character 1' }],
  columns: [{ id: libraryId, label: 'Reference' }],
  templateId: null,
  deletedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
};
const document = {
  board,
  items: [],
  edges: [],
  slots: [
    {
      id,
      libraryId,
      boardId: id,
      label: 'Character 1 · Reference',
      x: 0,
      y: 0,
      width: 240,
      height: 180,
      rowId: id,
      columnId: libraryId,
      templateKey: null,
      revision: 0,
      currentPin: null,
      deletedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ],
};
beforeEach(async () => {
  window.history.replaceState({}, '', '/?workspace=boards');
  await i18n.changeLanguage('en');
});
it('opens a valid library board instead of an unrelated board URL', async () => {
  window.history.replaceState({}, '', '/?workspace=boards&board=foreign');
  const fetch = vi.fn(
    async (path: string) =>
      new Response(
        JSON.stringify(
          path.endsWith('/slot-templates')
            ? []
            : path.endsWith('/boards')
              ? [board]
              : path.includes('/assets?')
                ? { items: [], total: 0 }
                : document,
        ),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  render(<BoardsWorkspace libraryId={libraryId} onBack={vi.fn()} />);
  expect(
    await screen.findByRole('region', {
      name: 'Drop asset into Character 1 · Reference',
    }),
  ).toBeVisible();
  expect(new URLSearchParams(window.location.search).get('board')).toBe(id);
  expect(
    fetch.mock.calls.some(([path]) => path === '/api/boards/foreign'),
  ).toBe(false);
});
it('renames a matrix row using its stable ID and the current board revision', async () => {
  const fetch = vi.fn(
    async (path: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          path.endsWith('/slot-templates')
            ? []
            : path.endsWith('/boards')
              ? [board]
              : path.includes('/assets?')
                ? { items: [], total: 0 }
                : init?.method === 'PATCH'
                  ? {
                      ...document,
                      board: {
                        ...board,
                        revision: 1,
                        rows: [{ id, label: 'Maya' }],
                      },
                    }
                  : document,
        ),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  render(<BoardsWorkspace libraryId={libraryId} onBack={vi.fn()} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Rename Character 1' }),
  );
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Row name' }), {
    target: { value: 'Maya' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(
      true,
    ),
  );
  const call = fetch.mock.calls.find(([, init]) => init?.method === 'PATCH');
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({
    expectedRevision: 0,
    rows: [{ id, label: 'Maya' }],
  });
  expect(
    await screen.findByRole('button', { name: 'Rename Maya' }),
  ).toBeVisible();
});
