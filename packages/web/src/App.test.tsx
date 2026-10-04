import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset } from '@cura/shared';
import { App } from './App';
import { i18n } from './i18n';

const libraryId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';
const timestamp = '2026-10-04T00:00:00.000Z';
const initialAsset: Asset = {
  id: assetId,
  libraryId,
  rootId: libraryId,
  name: 'Forest.png',
  relativePath: 'Forest.png',
  hash: 'abc',
  type: 'image/png',
  size: 12400,
  width: 800,
  height: 600,
  colors: ['#446633'],
  phash: 'abc',
  exif: {},
  prompt: 'A quiet forest',
  negativePrompt: '',
  model: 'Flux',
  seed: '42',
  source: 'ComfyUI',
  params: {},
  currentVersionId: libraryId,
  rating: 0,
  note: '',
  folderId: null,
  deletedAt: null,
  finalized: false,
  tags: [],
  createdAt: timestamp,
  updatedAt: timestamp,
};
let asset = { ...initialAsset };
let settings = {
  language: 'en',
  theme: 'dark',
  layout: 'grid',
  sidebarWidth: 240,
  inspectorWidth: 320,
  activeLibraryId: libraryId,
};
let queries: URL[] = [];

beforeEach(async () => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(720);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  vi.stubGlobal('WebSocket', undefined);
  asset = { ...initialAsset };
  settings = {
    language: 'en',
    theme: 'dark',
    layout: 'grid',
    sidebarWidth: 240,
    inspectorWidth: 320,
    activeLibraryId: libraryId,
  };
  queries = [];
  await i18n.changeLanguage('en');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      queries.push(url);
      let body: unknown;
      if (url.pathname === '/api/settings') {
        if (options?.method === 'PATCH')
          settings = { ...settings, ...JSON.parse(String(options.body)) };
        body = settings;
      } else if (url.pathname === '/api/libraries')
        body = [
          {
            id: libraryId,
            name: 'Studio library',
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ];
      else if (url.pathname.endsWith('/assets/batch')) {
        const mutation = JSON.parse(String(options?.body)) as {
          action?: string;
          patch?: Partial<typeof asset>;
        };
        asset = {
          ...asset,
          ...mutation.patch,
          deletedAt: mutation.action === 'trash' ? timestamp : null,
        };
        body = { items: [asset] };
      } else if (url.pathname === `/api/assets/${assetId}`) {
        asset = { ...asset, ...JSON.parse(String(options?.body ?? '{}')) };
        body = asset;
      } else if (url.pathname.endsWith('/assets'))
        body = {
          items: url.searchParams.get('q') === 'missing' ? [] : [asset],
          total: 1,
        };
      else if (url.pathname.endsWith('/folders'))
        body = [
          {
            id: libraryId,
            libraryId,
            name: 'Campaign',
            parentId: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ];
      else if (url.pathname.endsWith('/tags'))
        body = [
          {
            id: libraryId,
            libraryId,
            name: 'Warm',
            color: '#ff8800',
            groupId: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ];
      else body = [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

describe('Cura catalog', () => {
  it('restores the server-selected library, selects an asset and saves metadata', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Cura' })).toBeVisible();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Select Forest.png' }),
    );
    const note = screen.getByLabelText('Notes');
    fireEvent.change(note, { target: { value: 'Use for opening scene' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(asset.note).toBe('Use for opening scene'));
    expect(screen.getByLabelText('Prompt')).toHaveValue('A quiet forest');
  });

  it('combines text and format filters and displays an actionable empty state', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Select Forest.png' });
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'missing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.change(screen.getByLabelText('Format'), {
      target: { value: 'image/png' },
    });
    await waitFor(() =>
      expect(
        queries.some(
          (url) =>
            url.searchParams.get('q') === 'missing' &&
            url.searchParams.get('type') === 'image/png',
        ),
      ).toBe(true),
    );
    expect(await screen.findByText('No matching assets')).toBeVisible();
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Clear filters' })[0]!,
    );
    expect(
      await screen.findByRole('button', { name: 'Select Forest.png' }),
    ).toBeVisible();
  });

  it('persists light theme and list layout to the server', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Select Forest.png' });
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    await waitFor(() => expect(settings.layout).toBe('list'));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.change(screen.getByLabelText('Theme'), {
      target: { value: 'light' },
    });
    await waitFor(() => expect(settings.theme).toBe('light'));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('ignores deletion shortcuts in editable metadata but trashes selected assets otherwise', async () => {
    render(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Select Forest.png' }),
    );
    const note = screen.getByLabelText('Notes');
    note.focus();
    fireEvent.keyDown(note, { key: 'Delete' });
    await act(async () => {});
    expect(asset.deletedAt).toBeNull();
    note.blur();
    fireEvent.keyDown(document.body, { key: 'Delete' });
    await waitFor(() => expect(asset.deletedAt).toBe(timestamp));
  });

  it('keeps folder, tag and text filters combined when navigating the sidebar', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Select Forest.png' });
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'forest' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Campaign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Warm' }));
    await waitFor(() =>
      expect(
        queries.some(
          (url) =>
            url.searchParams.get('q') === 'forest' &&
            url.searchParams.get('folderId') === libraryId &&
            url.searchParams.get('tagId') === libraryId,
        ),
      ).toBe(true),
    );
  });

  it('keeps batch metadata when a subsequent inspector save edits only notes', async () => {
    render(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Select Forest.png' }),
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Rating' }), {
      target: { value: '5' },
    });
    await waitFor(() => expect(asset.rating).toBe(5));
    const inspector = within(
      screen.getByRole('complementary', { name: 'Asset details' }),
    );
    await waitFor(() =>
      expect(
        inspector.getByRole('button', { name: '5 stars' }),
      ).toHaveAttribute('aria-pressed', 'true'),
    );
    fireEvent.change(inspector.getByLabelText('Notes'), {
      target: { value: 'Batch rating stays' },
    });
    fireEvent.click(inspector.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(asset.note).toBe('Batch rating stays'));
    expect(asset.rating).toBe(5);
  });

  it('keeps native action-button keys and lets Escape close settings from a control', async () => {
    render(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Select Forest.png' }),
    );
    const newFolder = screen.getByRole('button', { name: 'New folder' });
    newFolder.focus();
    fireEvent.keyDown(newFolder, { key: ' ', code: 'Space' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.keyDown(screen.getByLabelText('Theme'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('retains already loaded pages when metadata updates refresh the catalog', async () => {
    const originalFetch = fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        const url = new URL(path, 'http://localhost');
        if (!url.pathname.endsWith('/assets'))
          return originalFetch(path, options);
        const items = [
          asset,
          ...Array.from({ length: 149 }, (_, index) => ({
            ...initialAsset,
            id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
            name: `Study-${index}.png`,
          })),
        ];
        const offset = Number(url.searchParams.get('offset'));
        const limit = Number(url.searchParams.get('limit'));
        return new Response(
          JSON.stringify({
            items: items.slice(offset, offset + limit),
            total: items.length,
          }),
        );
      }),
    );
    render(<App />);
    await screen.findByRole('button', { name: 'Select Forest.png' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more assets' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Load more assets' }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select Forest.png' }));
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: 'Keep all loaded pages' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(asset.note).toBe('Keep all loaded pages'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(
      screen.queryByRole('button', { name: 'Load more assets' }),
    ).not.toBeInTheDocument();
  });

  it('explains an unavailable server and retries without reloading the browser', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not connect to Cura',
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});
