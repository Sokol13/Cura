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
import { scanRootId, scanSummary } from './catalog/scan-test-fixtures';

vi.mock('./media/RichPreviewQueue', () => ({ RichPreviewQueue: () => null }));
vi.mock('./boards/BoardsWorkspace', () => ({
  BoardsWorkspace: ({ onBack }: { onBack: () => void }) => (
    <section aria-label="Board editor" tabIndex={0}>
      <button onClick={onBack}>Back to library</button>
    </section>
  ),
}));
vi.mock('./brands/BrandWorkspace', () => ({
  BrandWorkspace: ({ onBack }: { onBack: () => void }) => (
    <section aria-label="Brand editor">
      <button onClick={onBack}>Back to library</button>
    </section>
  ),
}));

const libraryId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';
const timestamp = '2026-10-04T00:00:00.000Z';
const initialAsset: Asset = {
  displayName: null,
  archivedAt: null,
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
let cacheFiles = 3;

beforeEach(async () => {
  window.history.replaceState({}, '', '/');
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
  cacheFiles = 3;
  await i18n.changeLanguage('en');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      queries.push(url);
      let body: unknown;
      if (url.pathname === '/api/cache')
        body = { files: cacheFiles, bytes: cacheFiles ? 4096 : 0 };
      else if (url.pathname === '/api/cache/clear') {
        cacheFiles = 0;
        body = { ok: true };
      } else if (url.pathname === '/api/settings') {
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
  it('loads directory scan outcomes, finishes empty scans and refreshes after socket reconnection', async () => {
    const channels: {
      onopen?: (() => void) | undefined;
      onclose?: (() => void) | undefined;
      onmessage?: ((event: { data: string }) => void) | undefined;
    }[] = [];
    class LiveChannel {
      onopen?: () => void;
      onclose?: () => void;
      onmessage?: (event: { data: string }) => void;
      constructor() {
        channels.push(this);
      }
      close() {
        /* This test never opens a network socket. */
      }
    }
    vi.stubGlobal('WebSocket', LiveChannel);
    let persisted = scanSummary();
    let scanRequests = 0;
    const originalFetch = fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        if (path.endsWith('/roots'))
          return new Response(
            JSON.stringify([
              {
                id: scanRootId,
                libraryId,
                kind: 'reference',
                path: '/Pictures',
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            ]),
          );
        if (path.endsWith('/scans')) {
          scanRequests += 1;
          return new Response(JSON.stringify([persisted]));
        }
        return originalFetch(path, options);
      }),
    );
    render(<App />);
    await waitFor(() =>
      expect(screen.getAllByText('Scan completed')).toHaveLength(2),
    );
    expect(
      screen.getByText('0 supported · 0 skipped · 0 read errors'),
    ).toBeVisible();
    expect(screen.queryByText('Scanning 0 / 0')).not.toBeInTheDocument();
    const running = scanSummary({
      scanId: '00000000-0000-4000-8000-000000000004',
      status: 'running',
      phase: 'enumerating',
      startedAt: '2026-10-05T00:00:02.000Z',
      updatedAt: '2026-10-05T00:00:02.000Z',
      finishedAt: null,
    });
    const emit = (summary: typeof persisted) =>
      channels.at(-1)?.onmessage?.({
        data: JSON.stringify({
          type: 'scan',
          libraryId,
          rootId: scanRootId,
          completed: summary.processed,
          total: summary.supportedFound,
          scanSummary: summary,
        }),
      });
    act(() => emit(running));
    expect(screen.getAllByText('Scanning folders…')).toHaveLength(2);
    persisted = {
      ...running,
      status: 'completed',
      phase: 'finished',
      updatedAt: '2026-10-05T00:00:03.000Z',
      finishedAt: '2026-10-05T00:00:03.000Z',
    };
    act(() => emit(persisted));
    expect(screen.getAllByText('Scan completed')).toHaveLength(2);
    persisted = scanSummary({
      scanId: '00000000-0000-4000-8000-000000000005',
      status: 'failed',
      readErrors: 1,
      errors: [{ relativePath: null, stage: 'enumerate', code: 'EACCES' }],
      startedAt: '2026-10-05T00:00:04.000Z',
      updatedAt: '2026-10-05T00:00:05.000Z',
      finishedAt: '2026-10-05T00:00:05.000Z',
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      act(() => channels.at(-1)?.onclose?.());
      expect(screen.getByText('Reconnecting to local service…')).toBeVisible();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      const requestsBeforeOpen = scanRequests;
      await act(async () => channels.at(-1)?.onopen?.());
      expect(scanRequests).toBeGreaterThan(requestsBeforeOpen);
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() =>
      expect(screen.getAllByText('Scan failed')).toHaveLength(2),
    );
    expect(
      screen.queryByText('Reconnecting to local service…'),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['missing', 'true'],
    ['available', 'false'],
  ])(
    'combines %s-source filtering with search and clears it from requests',
    async (selection, queryValue) => {
      // Control the query debounce, including cold startup, independently of
      // CPU contention between browser and server unit-test workers.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const flushQuery = async () => {
        await act(async () => {});
        await act(async () => {
          await vi.advanceTimersByTimeAsync(60);
        });
      };
      try {
        render(<App />);
        await flushQuery();
        expect(
          screen.getByRole('button', { name: 'Select Forest.png' }),
        ).toBeVisible();
        fireEvent.change(screen.getByRole('searchbox'), {
          target: { value: 'Forest' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
        fireEvent.change(
          screen.getByRole('combobox', { name: 'Source availability' }),
          { target: { value: selection } },
        );
        await flushQuery();
        expect(
          queries.some(
            (url) =>
              url.searchParams.get('missing') === queryValue &&
              url.searchParams.get('q') === 'Forest',
          ),
        ).toBe(true);
        queries = [];
        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
        expect(
          screen.getByRole('combobox', { name: 'Source availability' }),
        ).toHaveValue('');
        await flushQuery();
        expect(
          queries.some(
            (url) =>
              url.pathname.endsWith('/assets') &&
              !url.searchParams.has('missing') &&
              !url.searchParams.has('q'),
          ),
        ).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    },
  );

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

  it('continues importing valid files after an individual failure and retains the failed filename', async () => {
    const originalFetch = fetch;
    const uploaded: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        const url = new URL(path, 'http://localhost');
        if (!url.pathname.endsWith('/upload'))
          return originalFetch(path, options);
        const name = url.searchParams.get('name') ?? '';
        uploaded.push(name);
        return name === 'invalid.png'
          ? new Response(
              JSON.stringify({
                error: 'Invalid image',
                code: 'INVALID_UPLOAD',
              }),
              { status: 400 },
            )
          : new Response('{}');
      }),
    );
    render(<App />);
    await screen.findByRole('button', { name: 'Select Forest.png' });
    fireEvent.change(
      screen.getByLabelText('Import files', { selector: 'input' }),
      {
        target: {
          files: [
            new File(['broken'], 'invalid.png'),
            new File(['valid'], 'valid.png'),
          ],
        },
      },
    );
    await waitFor(() => expect(uploaded).toEqual(['invalid.png', 'valid.png']));
    expect(screen.getByRole('alert')).toHaveTextContent('invalid.png');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('invalid.png');
  });

  it('retains an operation error when an unrelated search refresh succeeds', async () => {
    const originalFetch = fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        if (path === `/api/assets/${assetId}`)
          return new Response(
            JSON.stringify({ error: 'File unavailable', code: 'EACCES' }),
            { status: 403 },
          );
        return originalFetch(path, options);
      }),
    );
    render(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Select Forest.png' }),
    );
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: 'Unsaved' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Full Disk Access',
    );
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'forest' },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Full Disk Access');
  });

  it('disables similarity for assets without a perceptual hash', async () => {
    asset.phash = '';
    render(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Select Forest.png' }),
    );
    expect(
      screen.getByRole('button', { name: 'Find similar images' }),
    ).toBeDisabled();
    expect(
      screen.getByText('Similarity is unavailable for this file format.'),
    ).toBeVisible();
  });

  it('shows cache usage and refreshes it after clearing thumbnails', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Select Forest.png' });
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('3 files · 4.0 KB')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear thumbnails' }));
    expect(await screen.findByText('0 files · 0 B')).toBeVisible();
  });

  it('reloads version history when a watched asset changes while preview stays open', async () => {
    const channels: {
      onmessage?: ((event: { data: string }) => void) | undefined;
    }[] = [];
    class LiveChannel {
      onmessage?: (event: { data: string }) => void;
      constructor() {
        channels.push(this);
      }
      close() {
        /* No real socket is opened by this browser unit test. */
      }
    }
    vi.stubGlobal('WebSocket', LiveChannel);
    const originalFetch = fetch;
    const nextVersionId = '00000000-0000-4000-8000-000000000009';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        if (path.endsWith('/versions')) {
          const first = { ...initialAsset, id: libraryId, assetId, ordinal: 1 };
          return new Response(
            JSON.stringify(
              asset.currentVersionId === nextVersionId
                ? [first, { ...first, id: nextVersionId, ordinal: 2 }]
                : [first],
            ),
          );
        }
        return originalFetch(path, options);
      }),
    );
    render(<App />);
    fireEvent.doubleClick(
      await screen.findByRole('button', { name: 'Select Forest.png' }),
    );
    await screen.findByRole('button', { name: 'View V1: Forest.png' });
    asset.currentVersionId = nextVersionId;
    // Exercise both application delays deterministically. A busy CI worker
    // should not spend the query's one-second wait budget on real timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      act(() =>
        channels.at(-1)?.onmessage?.({
          data: JSON.stringify({ type: 'asset', libraryId, assetId }),
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(
      await screen.findByRole('button', { name: 'View V2: Forest.png' }),
    ).toBeVisible();
  });

  it('navigates between adjacent assets inside the preview', async () => {
    const second = {
      ...initialAsset,
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Coast.png',
      currentVersionId: '00000000-0000-4000-8000-000000000004',
    };
    const originalFetch = fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        const url = new URL(path, 'http://localhost');
        if (url.pathname.endsWith('/assets'))
          return new Response(
            JSON.stringify({ items: [asset, second], total: 2 }),
          );
        if (url.pathname.endsWith('/versions')) {
          const item = path.includes(second.id) ? second : asset;
          return new Response(
            JSON.stringify([
              {
                ...item,
                id: item.currentVersionId,
                assetId: item.id,
                ordinal: 1,
              },
            ]),
          );
        }
        if (url.pathname === `/api/assets/${second.id}`)
          return new Response(JSON.stringify(second));
        return originalFetch(path, options);
      }),
    );
    render(<App />);
    fireEvent.doubleClick(
      await screen.findByRole('button', { name: 'Select Forest.png' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Next asset' }));
    expect(
      await within(screen.getByRole('dialog')).findByRole('heading', {
        name: 'Coast.png',
      }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Previous asset' }));
    expect(
      await within(screen.getByRole('dialog')).findByRole('heading', {
        name: 'Forest.png',
      }),
    ).toBeVisible();
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

it('keeps catalog deletion shortcuts inactive while editing a board', async () => {
  render(<App />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Select Forest.png' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Boards' }));
  const editor = await screen.findByRole('region', { name: 'Board editor' });
  editor.focus();
  fireEvent.keyDown(editor, { key: 'Delete' });
  fireEvent.keyDown(editor, { key: 'Backspace' });
  fireEvent.keyDown(editor, { key: ' ', code: 'Space' });
  expect(queries.some((query) => query.pathname.endsWith('/batch'))).toBe(
    false,
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to library' }));
  expect(
    await screen.findByRole('button', { name: 'Select Forest.png' }),
  ).toBeVisible();
  expect(window.location.search).toBe('');
});

it('restores a workspace URL and follows browser navigation back to the library', async () => {
  window.history.replaceState({}, '', '/?workspace=brands');
  render(<App />);
  expect(
    await screen.findByRole('region', { name: 'Brand editor' }),
  ).toBeVisible();
  window.history.replaceState({}, '', '/');
  fireEvent.popState(window);
  expect(
    await screen.findByRole('button', { name: 'Select Forest.png' }),
  ).toBeVisible();
});

it.each(['same library', 'another library'])(
  'keeps a reopened registration dialog in %s when an earlier request finishes',
  async (destination) => {
    const secondLibraryId = '00000000-0000-4000-8000-000000000003';
    const originalFetch = fetch;
    const writes: {
      path: string;
      body: unknown;
      resolve: (response: Response) => void;
    }[] = [];
    const rootReads: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        const url = new URL(path, 'http://localhost');
        if (url.pathname === '/api/libraries')
          return Response.json(
            [libraryId, secondLibraryId].map((id) => ({
              id,
              name: id === libraryId ? 'Studio library' : 'Second library',
              createdAt: timestamp,
              updatedAt: timestamp,
            })),
          );
        if (url.pathname.endsWith('/assets'))
          return Response.json({ items: [], total: 0 });
        if (url.pathname === '/api/directories')
          return Response.json({
            path: '/Pictures',
            parent: '/',
            directories: [],
          });
        if (url.pathname.endsWith('/roots')) {
          if (options?.method === 'POST')
            return new Promise<Response>((resolve) => {
              writes.push({
                path: url.pathname,
                body: JSON.parse(String(options.body)),
                resolve,
              });
            });
          rootReads.push(url.pathname);
          return Response.json([]);
        }
        return originalFetch(path, options);
      }),
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const flush = async () => {
      await act(async () => {});
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60);
      });
    };
    try {
      render(<App />);
      await flush();
      fireEvent.click(
        screen.getByRole('button', { name: 'Register local folder' }),
      );
      await flush();
      fireEvent.change(
        screen.getByRole('textbox', { name: 'Directory path' }),
        { target: { value: '/Pictures/First' } },
      );
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Register directory',
        }),
      );
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({
        path: `/api/libraries/${libraryId}/roots`,
        body: { path: '/Pictures/First' },
      });

      window.history.replaceState({}, '', '/?workspace=boards');
      fireEvent.popState(window);
      await flush();
      expect(
        screen.getByRole('region', { name: 'Board editor' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      window.history.replaceState({}, '', '/');
      fireEvent.popState(window);
      await flush();
      const currentLibraryId =
        destination === 'another library' ? secondLibraryId : libraryId;
      if (destination === 'another library') {
        fireEvent.change(screen.getByRole('combobox', { name: 'Library' }), {
          target: { value: currentLibraryId },
        });
        await flush();
      }
      fireEvent.click(
        screen.getByRole('button', { name: 'Register local folder' }),
      );
      await flush();
      const reopened = screen.getByRole('dialog', {
        name: 'Register directory',
      });
      fireEvent.change(
        within(reopened).getByRole('textbox', { name: 'Directory path' }),
        { target: { value: '/Pictures/Second' } },
      );
      const readsBeforeCompletion = rootReads.filter(
        (path) => path === `/api/libraries/${currentLibraryId}/roots`,
      ).length;
      await act(async () => {
        writes[0]!.resolve(Response.json({ ok: true }));
      });
      await flush();
      expect(screen.getByRole('dialog', { name: 'Register directory' })).toBe(
        reopened,
      );
      expect(
        within(reopened).getByRole('textbox', { name: 'Directory path' }),
      ).toHaveValue('/Pictures/Second');
      expect(
        rootReads.filter(
          (path) => path === `/api/libraries/${currentLibraryId}/roots`,
        ).length,
      ).toBeGreaterThan(readsBeforeCompletion);
      expect(writes).toHaveLength(1);

      fireEvent.click(
        within(reopened).getByRole('button', {
          name: 'Register directory',
        }),
      );
      expect(writes).toHaveLength(2);
      expect(writes[1]).toMatchObject({
        path: `/api/libraries/${currentLibraryId}/roots`,
        body: { path: '/Pictures/Second' },
      });
      await act(async () => {
        writes[1]!.resolve(Response.json({ ok: true }));
      });
      await flush();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  },
);
