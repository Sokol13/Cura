import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetSchema } from '@cura/shared';
import { i18n } from '../i18n';
import { AssetTray } from './AssetTray';
import './i18n';

const id = '00000000-0000-4000-8000-000000000001';
const oldId = '00000000-0000-4000-8000-000000000002';
const stamp = '2026-10-04T00:00:00.000Z';
const asset = AssetSchema.parse({
  id,
  libraryId: id,
  rootId: id,
  name: 'Character.png',
  relativePath: 'Character.png',
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

beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path.endsWith('/versions'))
        return new Response(
          JSON.stringify([
            { ...asset, id: oldId, assetId: id, ordinal: 1 },
            { ...asset, id, assetId: id, ordinal: 2 },
          ]),
        );
      return new Response(JSON.stringify({ items: [asset], total: 1 }));
    }),
  );
});
describe('board asset tray', () => {
  it('pins the chosen historical version in both picker and browser drag payloads', async () => {
    const pick = vi.fn();
    render(<AssetTray libraryId={id} onPick={pick} />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Choose version for Character.png',
      }),
    );
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'Character.png version' }),
      { target: { value: oldId } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Add Character.png to board' }),
    );
    expect(pick).toHaveBeenCalledWith({ assetId: id, versionId: oldId });
    const transfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(
      screen.getByRole('button', { name: 'Drag Character.png' }),
      { dataTransfer: transfer },
    );
    expect(transfer.setData).toHaveBeenCalledWith(
      'application/x-cura-asset-pin',
      JSON.stringify({ assetId: id, versionId: oldId }),
    );
  });
  it('refetches search results and explains an empty search', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        requested.push(path);
        return new Response(JSON.stringify({ items: [], total: 0 }));
      }),
    );
    render(<AssetTray libraryId={id} onPick={vi.fn()} />);
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search library assets' }),
      { target: { value: 'coat' } },
    );
    await waitFor(() =>
      expect(requested.some((path) => path.includes('q=coat'))).toBe(true),
    );
    expect(await screen.findByText('No matching assets')).toBeVisible();
  });
});
