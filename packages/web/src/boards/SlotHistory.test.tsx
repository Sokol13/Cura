import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { BoardSlot, SlotActor, SlotHistoryEntry } from '@cura/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import { SlotHistory } from './SlotHistory';
import { i18n } from '../i18n';
import './i18n';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stamp = '2026-10-05T08:00:00.000Z';
const slot: BoardSlot = {
  id: id(1),
  libraryId: id(2),
  boardId: id(3),
  createdAt: stamp,
  updatedAt: stamp,
  label: 'Reference',
  x: 0,
  y: 0,
  width: 240,
  height: 180,
  rowId: null,
  columnId: null,
  templateKey: null,
  revision: 3,
  currentPin: null,
  deletedAt: null,
};
function entry(
  ordinal: number,
  overrides: Partial<SlotHistoryEntry> = {},
): SlotHistoryEntry {
  const pin = { assetId: id(10 + ordinal), versionId: id(20 + ordinal) };
  return {
    id: id(30 + ordinal),
    libraryId: slot.libraryId,
    slotId: slot.id,
    ordinal,
    pin,
    createdAt: `2026-10-05T08:0${ordinal}:00.000Z`,
    updatedAt: stamp,
    actor: { kind: 'local' },
    source: {
      ...pin,
      name: `Source ${ordinal}.png`,
      type: 'image/png',
      versionOrdinal: ordinal + 4,
    },
    ...overrides,
  };
}
function serve(history: SlotHistoryEntry[]) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(history),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const pane = (side: 'Left' | 'Right') =>
  within(screen.getByRole('region', { name: `${side} comparison` }));
beforeEach(async () => {
  await i18n.changeLanguage('en');
});

it('compares two immutable revision IDs with exact source versions, attribution and dates without writing', async () => {
  const first = entry(1),
    second = entry(2),
    third = entry(3, { pin: first.pin, source: first.source });
  const fetch = serve([first, third, second]);
  render(<SlotHistory slot={slot} onClose={vi.fn()} />);
  const left = await screen.findByRole('combobox', {
    name: 'Left slot version',
  });
  const right = screen.getByRole('combobox', { name: 'Right slot version' });
  expect(left).toHaveValue(second.id);
  expect(right).toHaveValue(third.id);
  expect(pane('Left').getByText('Source 2.png')).toBeVisible();
  expect(pane('Left').getByText('Asset version V6')).toBeVisible();
  expect(pane('Right').getByText('Asset version V5')).toBeVisible();
  expect(pane('Left').getByText('Local user')).toBeVisible();
  expect(pane('Left').getByRole('img')).toHaveAttribute(
    'src',
    `/api/versions/${second.pin!.versionId}/thumbnail`,
  );
  expect(
    pane('Left').getByRole('link', { name: 'Download pinned original' }),
  ).toHaveAttribute('href', `/api/versions/${second.pin!.versionId}/file`);
  expect(
    pane('Left').getByText(new Date(second.createdAt).toLocaleString('en')),
  ).toHaveAttribute('datetime', second.createdAt);
  fireEvent.change(left, { target: { value: first.id } });
  expect(left).toHaveValue(first.id);
  expect(right).toHaveValue(third.id);
  expect(pane('Left').getByRole('img')).toHaveAttribute(
    'src',
    pane('Right').getByRole('img').getAttribute('src'),
  );
  fireEvent.change(left, { target: { value: third.id } });
  expect(left).toHaveValue(first.id);
  for (const number of [1, 2, 3])
    expect(
      screen.getByText(`Slot version V${number}`, { exact: true }),
    ).toBeVisible();
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
});

it.each([
  [{ kind: 'local' }, 'Local user', '本机用户'],
  [
    { kind: 'account', id: id(50), email: 'designer@example.com' },
    'designer@example.com',
    'designer@example.com',
  ],
  [{ kind: 'account', id: id(51), email: null }, id(51), id(51)],
  [
    { kind: 'system', reason: 'sync-resolution' },
    'Sync resolution',
    '同步合并',
  ],
  [undefined, 'Not recorded', '未记录'],
] as [SlotActor | undefined, string, string][])(
  'renders persisted actor %j honestly and changes presentation language without refetching',
  async (actor, english, chinese) => {
    const value = entry(1);
    if (actor) value.actor = actor;
    else delete value.actor;
    const fetch = serve([value]);
    render(<SlotHistory slot={slot} onClose={vi.fn()} />);
    expect(await screen.findByText(english)).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.getByText('Assign another version to compare.'),
    ).toBeVisible();
    await act(async () => {
      await i18n.changeLanguage('zh-CN');
    });
    expect(screen.getByText(chinese)).toBeVisible();
    expect(screen.getByText('资产版本 V5')).toBeVisible();
    expect(
      screen.getByRole('link', { name: '下载固定版本原文件 · V1' }),
    ).toBeVisible();
    expect(
      screen.getByText(new Date(value.createdAt).toLocaleString('zh-CN')),
    ).toHaveAttribute('datetime', value.createdAt);
    expect(fetch).toHaveBeenCalledOnce();
  },
);

it.each([
  ['Design.psd', 'image/vnd.adobe.photoshop'],
  ['Brief.pdf', 'application/pdf'],
  ['Take.mov', 'video/quicktime'],
  ['Model.glb', 'model/gltf-binary'],
])('retains historical rich thumbnails for %s', async (name, type) => {
  const value = entry(1);
  value.source = { ...value.source!, name, type };
  serve([value]);
  render(<SlotHistory slot={slot} onClose={vi.fn()} />);
  const image = await screen.findByRole('img');
  expect(image).toHaveAttribute(
    'src',
    `/api/versions/${value.pin!.versionId}/thumbnail`,
  );
  fireEvent.error(image);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(
    screen.getByText('Preview is unavailable. Download the pinned original.'),
  ).toBeVisible();
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    `/api/versions/${value.pin!.versionId}/file`,
  );
});

it('shows cleared and generic records without thumbnail requests while retaining generic downloads', async () => {
  const generic = entry(1);
  generic.source = {
    ...generic.source!,
    name: 'Read me.txt',
    type: 'text/plain',
  };
  const cleared = entry(2, { pin: null, source: null });
  serve([generic, cleared]);
  render(<SlotHistory slot={slot} onClose={vi.fn()} />);
  await screen.findByRole('combobox', { name: 'Left slot version' });
  expect(pane('Left').queryByRole('img')).not.toBeInTheDocument();
  expect(pane('Left').getByText('Read me.txt')).toBeVisible();
  expect(pane('Left').getByRole('link')).toHaveAttribute(
    'href',
    `/api/versions/${generic.pin!.versionId}/file`,
  );
  expect(pane('Right').getByText('Cleared')).toBeVisible();
  expect(pane('Right').queryByRole('img')).not.toBeInTheDocument();
  expect(pane('Right').queryByRole('link')).not.toBeInTheDocument();
  expect(screen.queryAllByRole('img')).toHaveLength(0);
});

it('explains missing source details and empty history without enabling a meaningless comparison', async () => {
  serve([entry(1, { source: null })]);
  const view = render(<SlotHistory slot={slot} onClose={vi.fn()} />);
  expect(await screen.findByText('Source details unavailable')).toBeVisible();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    `/api/versions/${id(21)}/file`,
  );
  serve([]);
  view.rerender(
    <SlotHistory slot={{ ...slot, id: id(80) }} onClose={vi.fn()} />,
  );
  expect(await screen.findByText('No assignments yet.')).toBeVisible();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it.each(['resolve', 'reject'] as const)(
  'ignores a stale request that later %ss after switching slots',
  async (completion) => {
    let resolve!: (value: Response) => void, reject!: (error: Error) => void;
    const pending = new Promise<Response>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const other = { ...slot, id: id(81), label: 'Wide shot' };
    const next = entry(2, { slotId: other.id });
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockResolvedValue(Response.json([next]));
    vi.stubGlobal('fetch', fetch);
    const view = render(<SlotHistory slot={slot} onClose={vi.fn()} />);
    view.rerender(<SlotHistory slot={other} onClose={vi.fn()} />);
    expect(await screen.findByText('Source 2.png')).toBeVisible();
    await act(async () => {
      if (completion === 'resolve') resolve(Response.json([entry(1)]));
      else reject(new Error('Old request failed'));
      await pending.catch(() => undefined);
    });
    expect(screen.getByText('Source 2.png')).toBeVisible();
    expect(screen.queryByText('Source 1.png')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  },
);

it('rejects wrong-slot data and retries a failed load', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json([entry(1, { slotId: id(99) })]))
    .mockResolvedValueOnce(Response.json([entry(2)]));
  vi.stubGlobal('fetch', fetch);
  render(<SlotHistory slot={slot} onClose={vi.fn()} />);
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.queryByText('Source 1.png')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Source 2.png')).toBeVisible();
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
  );
});
