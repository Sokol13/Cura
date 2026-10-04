import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  AssetPageSchema,
  AssetSchema,
  CatalogEventSchema,
  CollectionsSchema,
  FoldersSchema,
  LibrariesSchema,
  LibraryRootsSchema,
  SettingsSchema,
  TagGroupsSchema,
  TagsSchema,
  type Asset,
  type BatchAssets,
  type Collection,
  type Folder,
  type Library,
  type LibraryRoot,
  type Tag,
  type TagGroup,
  type UpdateAsset,
} from '@cura/shared';
import { ApiError, request, uploadFile } from './catalog/api';
import { useWorkspace } from './catalog/store';
import type { Filters } from './catalog/types';
import { Sidebar } from './catalog/Sidebar';
import { AssetPreview } from './catalog/AssetPreview';
import { AssetGrid } from './catalog/AssetGrid';
import { Inspector } from './catalog/Inspector';
import { FilterPanel } from './catalog/Filters';
import { BatchBar } from './catalog/BatchBar';
import { SettingsDialog } from './catalog/SettingsDialog';

const BoardsWorkspace = lazy(() =>
  import('./boards/BoardsWorkspace').then((module) => ({
    default: module.BoardsWorkspace,
  })),
);
const BrandWorkspace = lazy(() =>
  import('./brands/BrandWorkspace').then((module) => ({
    default: module.BrandWorkspace,
  })),
);
const ProcessWorkspace = lazy(() =>
  import('./process/ProcessWorkspace').then((module) => ({
    default: module.ProcessWorkspace,
  })),
);
const RichPreviewQueue = lazy(() =>
  import('./media/RichPreviewQueue').then((module) => ({
    default: module.RichPreviewQueue,
  })),
);
type Workspace = 'catalog' | 'boards' | 'brands' | 'process';
const readWorkspace = (): Workspace => {
  const value = new URLSearchParams(window.location.search).get('workspace');
  return value === 'boards' || value === 'brands' || value === 'process'
    ? value
    : 'catalog';
};

export function App() {
  const { t, i18n } = useTranslation();
  const { settings, hydrate, update } = useWorkspace();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [libraryId, setLibraryId] = useState('');
  const [workspace, setWorkspace] = useState<Workspace>(readWorkspace);
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Filters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const [upload, setUpload] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [eventStatus, setEventStatus] = useState('');
  const [preview, setPreview] = useState<Asset | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const queryGeneration = useRef(0);
  const paging = useRef(false);
  const loadedCount = useRef(0);
  loadedCount.current = assets.length;
  const lastQuery = useRef('');
  const selectedAsset = assets.find((asset) => selected.has(asset.id));
  const reportError = useCallback((failure: unknown) => setError(failure), []);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  const navigateWorkspace = useCallback(
    (next: Workspace) => {
      const url = new URL(window.location.href);
      if (next === 'catalog') url.searchParams.delete('workspace');
      else url.searchParams.set('workspace', next);
      if (next !== 'boards') url.searchParams.delete('board');
      window.history.pushState({}, '', url);
      setWorkspace(next);
      setPreview(null);
      setShowSettings(false);
      refresh();
    },
    [refresh],
  );
  useEffect(() => {
    const restore = () => {
      setWorkspace(readWorkspace());
      setPreview(null);
      setShowSettings(false);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const initialize = useCallback(async () => {
    setBooting(true);
    setError(null);
    try {
      const [preferences, catalogs] = await Promise.all([
        request('/api/settings').then((data) => SettingsSchema.parse(data)),
        request('/api/libraries').then((data) => LibrariesSchema.parse(data)),
      ]);
      hydrate(preferences);
      setLibraries(catalogs);
      setLibraryId((current) =>
        catalogs.some((catalog) => catalog.id === current)
          ? current
          : (catalogs.find(
              (catalog) => catalog.id === preferences.activeLibraryId,
            )?.id ??
            catalogs[0]?.id ??
            ''),
      );
    } catch (failure) {
      reportError(failure);
    } finally {
      setBooting(false);
      setLoading(false);
    }
  }, [hydrate, reportError]);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    void i18n.changeLanguage(settings.language);
    const media =
      typeof matchMedia === 'function'
        ? matchMedia('(prefers-color-scheme: light)')
        : null;
    const apply = () => {
      document.documentElement.dataset.theme =
        settings.theme === 'system'
          ? media?.matches
            ? 'light'
            : 'dark'
          : settings.theme;
    };
    apply();
    media?.addEventListener('change', apply);
    return () => media?.removeEventListener('change', apply);
  }, [settings.language, settings.theme, i18n]);
  useEffect(() => {
    if (!libraryId) return;
    let cancelled = false;
    void Promise.all([
      request(`/api/libraries/${libraryId}/roots`).then((data) =>
        LibraryRootsSchema.parse(data),
      ),
      request(`/api/libraries/${libraryId}/folders`).then((data) =>
        FoldersSchema.parse(data),
      ),
      request(`/api/libraries/${libraryId}/tags`).then((data) =>
        TagsSchema.parse(data),
      ),
      request(`/api/libraries/${libraryId}/tag-groups`).then((data) =>
        TagGroupsSchema.parse(data),
      ),
      request(`/api/libraries/${libraryId}/collections`).then((data) =>
        CollectionsSchema.parse(data),
      ),
      request('/api/libraries').then((data) => LibrariesSchema.parse(data)),
    ])
      .then(
        ([
          nextRoots,
          nextFolders,
          nextTags,
          nextGroups,
          nextCollections,
          nextLibraries,
        ]) => {
          if (cancelled) return;
          setRoots(nextRoots);
          setFolders(nextFolders);
          setTags(nextTags);
          setGroups(nextGroups);
          setCollections(nextCollections);
          setLibraries(nextLibraries);
        },
      )
      .catch(reportError);
    return () => {
      cancelled = true;
    };
  }, [libraryId, revision, reportError]);

  const queryString = new URLSearchParams(
    Object.entries(filters)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => [key, String(value)]),
  ).toString();
  useEffect(() => {
    if (!libraryId) return;
    const generation = ++queryGeneration.current;
    const queryKey = `${libraryId}?${queryString}`;
    const pageCount =
      lastQuery.current === queryKey
        ? Math.max(1, Math.ceil(loadedCount.current / 100))
        : 1;
    lastQuery.current = queryKey;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      void Promise.all(
        Array.from({ length: pageCount }, (_, index) =>
          request(
            `/api/libraries/${libraryId}/assets?${queryString}&limit=100&offset=${index * 100}`,
            { signal: controller.signal },
          ).then((data) => AssetPageSchema.parse(data)),
        ),
      )
        .then((pages) => ({
          items: pages.flatMap((page) => page.items),
          total: pages[0]?.total ?? 0,
        }))
        .then((page) => {
          if (generation !== queryGeneration.current) return;
          setAssets(page.items);
          setTotal(page.total);
          setSelected(
            (current) =>
              new Set(
                [...current].filter((id) =>
                  page.items.some((asset) => asset.id === id),
                ),
              ),
          );
        })
        .catch((failure: unknown) => {
          if (!(failure instanceof Error && failure.name === 'AbortError'))
            reportError(failure);
        })
        .finally(() => {
          if (generation === queryGeneration.current) setLoading(false);
        });
    }, 60);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [libraryId, queryString, revision, reportError]);

  useEffect(() => {
    if (!libraryId || typeof WebSocket === 'undefined') return;
    let disposed = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let invalidation: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/events`,
      );
      socket.onopen = () => {
        if (disposed) return;
        setEventStatus('');
        refresh();
      };
      socket.onmessage = (message) => {
        let value: unknown;
        try {
          value = JSON.parse(String(message.data));
        } catch {
          return;
        }
        const parsed = CatalogEventSchema.safeParse(value);
        if (!parsed.success || parsed.data.libraryId !== libraryId) return;
        const event = parsed.data;
        if (event.type === 'scan')
          setEventStatus(
            t('scanProgress', {
              completed: event.completed ?? 0,
              total: event.total ?? 0,
            }),
          );
        if (event.type === 'error')
          reportError(new ApiError('SCAN_ERROR', event.message ?? ''));
        if (!invalidation)
          invalidation = setTimeout(() => {
            invalidation = undefined;
            refresh();
          }, 250);
      };
      socket.onclose = () => {
        if (!disposed) {
          setEventStatus(t('reconnecting'));
          retry = setTimeout(connect, 2000);
        }
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearTimeout(invalidation);
      socket?.close();
    };
  }, [libraryId, refresh, reportError, t]);

  const previewId = preview?.id;
  const currentPreview = preview
    ? (assets.find((asset) => asset.id === preview.id) ?? preview)
    : null;
  useEffect(() => {
    if (!previewId) return;
    const controller = new AbortController();
    void request(`/api/assets/${previewId}`, { signal: controller.signal })
      .then((data) => AssetSchema.parse(data))
      .then((asset) => {
        if (!controller.signal.aborted)
          setPreview((current) => (current?.id === asset.id ? asset : current));
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) reportError(failure);
      });
    return () => controller.abort();
  }, [previewId, revision, reportError]);

  const changeLibrary = (id: string) => {
    setLibraryId(id);
    setAssets([]);
    setTotal(0);
    setRoots([]);
    setFolders([]);
    setTags([]);
    setGroups([]);
    setCollections([]);
    setSelected(new Set());
    setFilters({});
    void update({ activeLibraryId: id }).catch(reportError);
    refresh();
  };
  const changeFilters = (patch: Filters) => {
    setFilters((current) => ({ ...current, ...patch }));
    setSelected(new Set());
  };
  const batch = useCallback(
    async (mutation: Omit<BatchAssets, 'assetIds'>) => {
      if (!selected.size) return;
      try {
        await request(`/api/libraries/${libraryId}/assets/batch`, {
          method: 'POST',
          body: { assetIds: [...selected], ...mutation },
        });
        if (mutation.action) setSelected(new Set());
        refresh();
      } catch (failure) {
        reportError(failure);
      }
    },
    [libraryId, selected, refresh, reportError],
  );
  useEffect(() => {
    if (workspace !== 'catalog') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"]',
        ) ||
          target.isContentEditable)
      )
        return;
      if (event.key.toLowerCase() === 'f' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === 'Escape') {
        setPreview(null);
        setShowSettings(false);
        return;
      }
      if (showSettings || preview) return;
      if (
        target instanceof HTMLElement &&
        target.closest('button, a, summary') &&
        !target.closest('.asset-card')
      )
        return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (!filters.trash) void batch({ action: 'trash' });
      }
      if (event.code === 'Space' || event.key === ' ') {
        if (selectedAsset) {
          event.preventDefault();
          setPreview(selectedAsset);
        }
      }
      if (
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      ) {
        event.preventDefault();
        const index = assets.findIndex(
          (asset) => asset.id === selectedAsset?.id,
        );
        const step =
          event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
        const next =
          assets[Math.max(0, Math.min(assets.length - 1, index + step))];
        if (next) setSelected(new Set([next.id]));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    assets,
    selectedAsset,
    batch,
    filters.trash,
    showSettings,
    preview,
    workspace,
  ]);

  const importFiles = async (files: FileList | File[]) => {
    if (!libraryId || upload) return;
    const list = Array.from(files);
    const failures: string[] = [];
    for (const [index, file] of list.entries()) {
      setUpload({ current: index + 1, total: list.length });
      try {
        await uploadFile(libraryId, file);
      } catch {
        failures.push(file.name);
      }
    }
    setUpload(null);
    refresh();
    if (failures.length)
      reportError(new ApiError('IMPORT_PARTIAL', failures.join(', ')));
  };
  const saveAsset = async (patch: UpdateAsset) => {
    if (!selectedAsset) return;
    try {
      const updated = AssetSchema.parse(
        await request(`/api/assets/${selectedAsset.id}`, {
          method: 'PATCH',
          body: patch,
        }),
      );
      setAssets((current) =>
        current.map((asset) => (asset.id === updated.id ? updated : asset)),
      );
      refresh();
    } catch (failure) {
      reportError(failure);
      throw failure;
    }
  };
  const loadMore = async () => {
    if (paging.current || loading || assets.length >= total) return;
    paging.current = true;
    const generation = queryGeneration.current;
    try {
      const page = AssetPageSchema.parse(
        await request(
          `/api/libraries/${libraryId}/assets?${queryString}&limit=100&offset=${assets.length}`,
        ),
      );
      if (generation === queryGeneration.current) {
        setAssets((current) => [
          ...current,
          ...page.items.filter(
            (item) => !current.some((existing) => existing.id === item.id),
          ),
        ]);
        setTotal(page.total);
        return page.items;
      }
    } catch (failure) {
      reportError(failure);
    } finally {
      paging.current = false;
    }
  };
  const previewIndex = currentPreview
    ? assets.findIndex((asset) => asset.id === currentPreview.id)
    : -1;
  const navigatePreview = async (direction: -1 | 1) => {
    if (previewIndex < 0) return;
    let next = assets[previewIndex + direction];
    if (!next && direction === 1 && assets.length < total)
      next = (await loadMore())?.[0];
    if (next) {
      setPreview(next);
      setSelected(new Set([next.id]));
    }
  };
  const selectAsset = (asset: Asset, additive: boolean, range: boolean) => {
    setSelected((current) => {
      if (range && selectedAsset) {
        const from = assets.findIndex((item) => item.id === selectedAsset.id);
        const to = assets.findIndex((item) => item.id === asset.id);
        return new Set(
          assets
            .slice(Math.min(from, to), Math.max(from, to) + 1)
            .map((item) => item.id),
        );
      }
      if (!additive) return new Set([asset.id]);
      const next = new Set(current);
      if (next.has(asset.id)) next.delete(asset.id);
      else next.add(asset.id);
      return next;
    });
  };
  const hasFilters = Object.entries(filters).some(
    ([key, value]) => key !== 'trash' && value !== undefined && value !== '',
  );
  const errorMessage =
    error instanceof ApiError
      ? error.code === 'NETWORK'
        ? t('networkError')
        : error.code === 'IMPORT_PARTIAL'
          ? `${t('importFailed')} ${error.message}`
          : `${t('requestFailed')} ${error.message}`
      : t('genericError');
  return (
    <>
      {libraryId && (
        <Suspense fallback={null}>
          <RichPreviewQueue libraryId={libraryId} />
        </Suspense>
      )}
      {libraryId && workspace !== 'catalog' ? (
        <Suspense
          fallback={
            <div className="empty-state" role="status">
              {t('loading')}
            </div>
          }
        >
          {workspace === 'boards' ? (
            <BoardsWorkspace
              key={libraryId}
              libraryId={libraryId}
              onBack={() => navigateWorkspace('catalog')}
            />
          ) : workspace === 'brands' ? (
            <BrandWorkspace
              key={libraryId}
              libraryId={libraryId}
              onBack={() => navigateWorkspace('catalog')}
            />
          ) : (
            <ProcessWorkspace
              key={libraryId}
              libraryId={libraryId}
              onBack={() => navigateWorkspace('catalog')}
            />
          )}
        </Suspense>
      ) : (
        <main
          className="workspace"
          style={
            {
              '--sidebar-width': `${settings.sidebarWidth}px`,
              '--inspector-width': `${settings.inspectorWidth}px`,
            } as CSSProperties
          }
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) {
              event.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void importFiles(event.dataTransfer.files);
          }}
        >
          <Sidebar
            libraries={libraries}
            libraryId={libraryId}
            roots={roots}
            folders={folders}
            tags={tags}
            groups={groups}
            collections={collections}
            filters={filters}
            onLibraryChange={changeLibrary}
            onFilterChange={(next) => {
              changeFilters(next);
            }}
            onChanged={refresh}
            onError={reportError}
            onSettings={() => setShowSettings(true)}
          />
          <section className="catalog-main">
            <header className="catalog-header">
              <div>
                <p className="eyebrow">{t('localLibrary')}</p>
                <h2>
                  {filters.trash
                    ? t('trash')
                    : (folders.find((folder) => folder.id === filters.folderId)
                        ?.name ??
                      libraries.find((library) => library.id === libraryId)
                        ?.name ??
                      t('library'))}
                </h2>
              </div>
              <button
                aria-label={t('importFiles')}
                className="button-primary import-button"
                disabled={!libraryId || Boolean(upload)}
                onClick={() => uploadRef.current?.click()}
              >
                ＋ {t('importFiles')}
              </button>
              <input
                ref={uploadRef}
                className="sr-only"
                type="file"
                multiple
                aria-label={t('importFiles')}
                onChange={(event) => {
                  if (event.target.files) void importFiles(event.target.files);
                  event.target.value = '';
                }}
              />
            </header>
            <nav className="workspace-navigation" aria-label={t('workspaces')}>
              {(['boards', 'brands', 'process'] as const).map((destination) => (
                <button
                  key={destination}
                  disabled={!libraryId}
                  onClick={() => navigateWorkspace(destination)}
                >
                  {t(`workspace_${destination}`)}
                </button>
              ))}
            </nav>
            <div className="catalog-toolbar">
              <div className="search-field">
                <span aria-hidden="true">⌕</span>
                <input
                  ref={searchRef}
                  type="search"
                  aria-label={t('search')}
                  placeholder={t('searchPlaceholder')}
                  value={filters.q ?? ''}
                  onChange={(e) =>
                    changeFilters({ q: e.target.value || undefined })
                  }
                />
                <kbd>⌘ F</kbd>
              </div>
              <button
                aria-label={t('filters')}
                className={showFilters || hasFilters ? 'active' : ''}
                onClick={() => setShowFilters(!showFilters)}
                aria-expanded={showFilters}
              >
                ☷ <span>{t('filters')}</span>
              </button>
              <div className="view-toggle">
                <button
                  aria-label={t('gridView')}
                  aria-pressed={settings.layout === 'grid'}
                  onClick={() => {
                    void update({ layout: 'grid' }).catch(reportError);
                  }}
                >
                  ▦
                </button>
                <button
                  aria-label={t('listView')}
                  aria-pressed={settings.layout === 'list'}
                  onClick={() => {
                    void update({ layout: 'list' }).catch(reportError);
                  }}
                >
                  ☰
                </button>
              </div>
            </div>
            {showFilters && (
              <FilterPanel
                filters={filters}
                onChange={changeFilters}
                onClear={() => setFilters({ trash: filters.trash })}
              />
            )}
            {error !== null && (
              <div role="alert" className="error-banner">
                <div>
                  {errorMessage}
                  {error instanceof ApiError &&
                    (error.status === 403 ||
                      ['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) && (
                      <p>{t('permissionHint')}</p>
                    )}
                </div>
                <button
                  onClick={() => {
                    if (!libraries.length) void initialize();
                    else refresh();
                  }}
                >
                  {t('retry')}
                </button>
                <button aria-label={t('close')} onClick={() => setError(null)}>
                  ×
                </button>
              </div>
            )}
            {upload && (
              <div className="progress-banner" role="status">
                {t('uploading', upload)}
                <progress value={upload.current} max={upload.total} />
              </div>
            )}
            {selected.size > 0 && (
              <BatchBar
                count={selected.size}
                folders={folders}
                tags={tags}
                trash={Boolean(filters.trash)}
                onBatch={(patch) => {
                  void batch(patch);
                }}
                onClear={() => setSelected(new Set())}
                onSelectAll={() =>
                  setSelected(new Set(assets.map((asset) => asset.id)))
                }
              />
            )}
            {booting || (loading && assets.length === 0) ? (
              <div className="empty-state" role="status">
                <span className="loader" />
                {t('loadingAssets')}
              </div>
            ) : !libraryId ? (
              <div className="empty-state welcome-state">
                <div className="welcome-art" aria-hidden="true">
                  <span>◈</span>
                  <span>▧</span>
                  <span>✦</span>
                </div>
                <p className="eyebrow">CURA · {t('localLibrary')}</p>
                <h2>{t('welcome')}</h2>
                <p>{t('welcomeHint')}</p>
                <button
                  className="button-primary"
                  onClick={() =>
                    document
                      .querySelector<HTMLButtonElement>('[data-create-library]')
                      ?.click()
                  }
                >
                  ＋ {t('createFirst')}
                </button>
                <small>{t('localFirst')}</small>
              </div>
            ) : assets.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">
                  {filters.trash ? '♧' : hasFilters ? '⌕' : '▧'}
                </span>
                <h2>
                  {t(
                    filters.trash
                      ? 'emptyTrash'
                      : hasFilters
                        ? 'noResults'
                        : 'emptyLibrary',
                  )}
                </h2>
                <p>
                  {t(
                    filters.trash
                      ? 'emptyTrashHint'
                      : hasFilters
                        ? 'noResultsHint'
                        : 'emptyLibraryHint',
                  )}
                </p>
                {hasFilters ? (
                  <button onClick={() => setFilters({ trash: filters.trash })}>
                    {t('clearFilters')}
                  </button>
                ) : (
                  !filters.trash && (
                    <button
                      className="button-primary"
                      onClick={() => uploadRef.current?.click()}
                    >
                      {t('importFiles')}
                    </button>
                  )
                )}
              </div>
            ) : (
              <AssetGrid
                assets={assets}
                layout={settings.layout}
                selected={selected}
                onSelect={selectAsset}
                onPreview={setPreview}
                onLoadMore={() => {
                  void loadMore();
                }}
                hasMore={assets.length < total}
                loading={loading}
              />
            )}
            <footer className="catalog-status">
              <span>
                {t('assetCount', { count: total })}
                {filters.similarTo && (
                  <button
                    onClick={() => changeFilters({ similarTo: undefined })}
                  >
                    {t('clearSimilar')}
                  </button>
                )}
              </span>
              <span className="connection-state">
                <i />
                {eventStatus || t('offlineReady')}
              </span>
            </footer>
          </section>
          <Inspector
            asset={selectedAsset}
            tags={tags}
            folders={folders}
            onSave={saveAsset}
            onPreview={() => selectedAsset && setPreview(selectedAsset)}
            onSimilar={() =>
              selectedAsset && changeFilters({ similarTo: selectedAsset.id })
            }
            onColor={(color) => changeFilters({ color })}
          />
          {showSettings && (
            <SettingsDialog
              settings={settings}
              libraryId={libraryId}
              onUpdate={update}
              onClose={() => setShowSettings(false)}
              onError={reportError}
            />
          )}
          {currentPreview && (
            <AssetPreview
              asset={currentPreview}
              hasPrevious={previewIndex > 0}
              hasNext={
                previewIndex >= 0 &&
                (previewIndex < assets.length - 1 || assets.length < total)
              }
              onNavigate={(direction) => {
                void navigatePreview(direction);
              }}
              onClose={() => setPreview(null)}
              onChanged={refresh}
            />
          )}
          {dragging && libraryId && (
            <div className="drop-overlay">
              <span>＋</span>
              <h2>{t('dropFiles')}</h2>
              <p>{t('dropHint')}</p>
            </div>
          )}
        </main>
      )}
    </>
  );
}
