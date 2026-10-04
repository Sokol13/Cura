import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssetSchema } from '@cura/shared';
import { i18n } from '../i18n';
import { AssetPicker, type AssetChoice } from './AssetPicker';

const id = '00000000-0000-4000-8000-000000000001';
const oldId = '00000000-0000-4000-8000-000000000002';
const stamp = '2026-10-04T00:00:00.000Z';
const asset = AssetSchema.parse({
  id,
  libraryId: id,
  rootId: id,
  name: 'Hero.png',
  relativePath: 'Hero.png',
  hash: 'abc',
  type: 'image/png',
  size: 128,
  width: 400,
  height: 400,
  colors: [],
  phash: 'abc',
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
const json = (data: unknown) => new Response(JSON.stringify(data));
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

function Picker() {
  const [value, onChange] = useState<AssetChoice[]>([]);
  return (
    <>
      <AssetPicker libraryId={id} value={value} onChange={onChange} history />
      <output data-testid="selection">{JSON.stringify(value)}</output>
    </>
  );
}

it('retains a selected historical version when paginating and filtering assets', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/versions')
        ? json([
            { ...asset, id: oldId, assetId: id, ordinal: 1 },
            { ...asset, assetId: id, ordinal: 2 },
          ])
        : json({ items: url.includes('q=empty') ? [] : [asset], total: 1 }),
    ),
  );
  render(<Picker />);
  fireEvent.click(
    await screen.findByRole('checkbox', { name: 'Select Hero.png' }),
  );
  fireEvent.change(
    await screen.findByRole('combobox', { name: 'Hero.png version' }),
    { target: { value: oldId } },
  );
  expect(screen.getByTestId('selection')).toHaveTextContent(oldId);
  fireEvent.change(
    screen.getByRole('searchbox', { name: 'Search library assets' }),
    { target: { value: 'empty' } },
  );
  expect(await screen.findByText('No matching assets')).toBeVisible();
  expect(screen.getByTestId('selection')).toHaveTextContent(oldId);
  expect(screen.getByRole('button', { name: 'Remove Hero.png' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Hero.png' }));
  expect(screen.getByTestId('selection')).toHaveTextContent('[]');
});

it('ignores a completed asset lookup after switching libraries', async () => {
  let resolveOld: ((response: Response) => void) | undefined;
  const pending = new Promise<Response>((resolve) => {
    resolveOld = resolve;
  });
  const fetcher = vi.fn(async (url: string) =>
    url.includes(`/libraries/${id}/`) ? pending : json({ items: [], total: 0 }),
  );
  vi.stubGlobal('fetch', fetcher);
  const view = render(
    <AssetPicker libraryId={id} value={[]} onChange={vi.fn()} />,
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  view.rerender(
    <AssetPicker libraryId={oldId} value={[]} onChange={vi.fn()} />,
  );
  expect(await screen.findByText('No matching assets')).toBeVisible();
  await act(async () => resolveOld?.(json({ items: [asset], total: 1 })));
  expect(
    screen.queryByRole('checkbox', { name: 'Select Hero.png' }),
  ).not.toBeInTheDocument();
});
