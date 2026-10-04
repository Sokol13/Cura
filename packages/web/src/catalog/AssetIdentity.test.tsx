import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssetSchema } from '@cura/shared';
import { i18n } from '../i18n';
import { Inspector } from './Inspector';
import { AssetGrid } from './AssetGrid';
import { BatchBar } from './BatchBar';

const uuid = '00000000-0000-4000-8000-000000000001';
const asset = AssetSchema.parse({
  id: uuid,
  libraryId: uuid,
  rootId: uuid,
  currentVersionId: uuid,
  name: 'source.png',
  displayName: 'Film hero.jpg',
  archivedAt: null,
  relativePath: 'references/source.png',
  hash: 'abc',
  type: 'image/png',
  size: 12,
  width: 100,
  height: 100,
  colors: [],
  phash: '',
  exif: {},
  prompt: '',
  negativePrompt: '',
  model: '',
  seed: '',
  source: '',
  params: {},
  rating: 0,
  note: '',
  folderId: null,
  deletedAt: null,
  tags: [],
  finalized: false,
  createdAt: '2026-10-04T00:00:00.000Z',
  updatedAt: '2026-10-04T00:00:00.000Z',
});
beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(720);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});
afterEach(() => vi.restoreAllMocks());

it('renders display names while retaining original inspector path and exact extension for downloads', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <Inspector
      asset={asset}
      tags={[]}
      folders={[]}
      onSave={save}
      onPreview={() => {}}
      onSimilar={() => {}}
      onColor={() => {}}
    />,
  );
  expect(screen.getByRole('heading', { name: 'Film hero.jpg' })).toBeVisible();
  expect(screen.getByText('references/source.png')).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Download original' }),
  ).toHaveAttribute('download', 'Film hero.png');
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: 'Revised hero' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({ displayName: 'Revised hero' }),
  );
});

it('rejects nonportable display names and can clear the override without editing source names', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <Inspector
      asset={asset}
      tags={[]}
      folders={[]}
      onSave={save}
      onPreview={() => {}}
      onSimilar={() => {}}
      onColor={() => {}}
    />,
  );
  const input = screen.getByLabelText('Display name') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'folder/file.png' } });
  expect(input.checkValidity()).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '' } });
  expect(input.checkValidity()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ displayName: null }));
});

it('uses the display name for grid selection and keeps the original name in its tooltip', () => {
  const select = vi.fn();
  render(
    <AssetGrid
      assets={[asset]}
      layout="grid"
      selected={new Set()}
      onSelect={select}
      onPreview={() => {}}
      onLoadMore={() => {}}
      hasMore={false}
      loading={false}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Select Film hero.jpg' }));
  expect(select).toHaveBeenCalledWith(asset, false, false);
  expect(screen.getByText('Film hero.jpg')).toHaveAttribute(
    'title',
    'source.png',
  );
});

it.each([false, true])(
  'archives or restores selected assets according to archive view=%s',
  (archived) => {
    const batch = vi.fn();
    render(
      <BatchBar
        count={1}
        folders={[]}
        tags={[]}
        trash={false}
        archived={archived}
        onBatch={batch}
        onClear={() => {}}
        onSelectAll={() => {}}
        onExport={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: archived ? 'Restore from archive' : 'Archive selected assets',
      }),
    );
    expect(batch).toHaveBeenCalledWith({
      action: archived ? 'unarchive' : 'archive',
    });
  },
);
