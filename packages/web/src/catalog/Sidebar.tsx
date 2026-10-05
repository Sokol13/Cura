import type {
  Collection,
  Folder,
  Library,
  LibraryRoot,
  Tag,
  TagGroup,
} from '@cura/shared';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { request } from './api';
import {
  DirectoryBrowserDialog,
  OrganizationDialog,
} from './OrganizationDialog';
import type { Filters } from './types';

type SidebarProps = {
  libraries: Library[];
  libraryId: string;
  roots: LibraryRoot[];
  folders: Folder[];
  tags: Tag[];
  groups: TagGroup[];
  collections: Collection[];
  filters: Filters;
  onLibraryChange: (id: string) => void;
  onFilterChange: (patch: Filters) => void;
  onChanged: () => void;
  onError: (error: unknown) => void;
  onSettings: () => void;
};

type EditDialog = {
  kind: 'library' | 'folder' | 'tag' | 'group' | 'collection';
  id?: string;
  name: string;
  parentId?: string | null;
  groupId?: string | null;
  color?: string;
  rules?: Filters;
};
type DialogState =
  | EditDialog
  | { kind: 'root' }
  | { kind: 'remove-root'; id: string; path: string; mode: 'trash' | 'offline' }
  | {
      kind: 'delete';
      path: string;
      name: string;
      hint: string;
      clear?: Filters | undefined;
    };

const emptyFilters: Filters = {
  q: undefined,
  folderId: undefined,
  tagId: undefined,
  rating: undefined,
  type: undefined,
  color: undefined,
  source: undefined,
  after: undefined,
  before: undefined,
  minWidth: undefined,
  minHeight: undefined,
  similarTo: undefined,
  trash: false,
  archived: false,
  missing: undefined,
};

function savedFilters(rules: Collection['rules']): Filters {
  const {
    q,
    folderId,
    tagId,
    rating,
    type,
    color,
    source,
    after,
    before,
    minWidth,
    minHeight,
    similarTo,
    trash,
    archived,
  } = rules;
  return {
    q,
    folderId,
    tagId,
    rating,
    type,
    color,
    source,
    after,
    before,
    minWidth,
    minHeight,
    similarTo,
    trash,
    archived,
    missing:
      'missing' in rules && typeof rules.missing === 'boolean'
        ? rules.missing
        : undefined,
  };
}

function isInside(
  folder: Folder,
  ancestorId: string,
  folders: Folder[],
): boolean {
  const visited = new Set<string>();
  let current: Folder | undefined = folder;
  while (current && !visited.has(current.id)) {
    if (current.id === ancestorId) return true;
    visited.add(current.id);
    current = folders.find((candidate) => candidate.id === current?.parentId);
  }
  return false;
}

export function Sidebar({
  libraries,
  libraryId,
  roots,
  folders,
  tags,
  groups,
  collections,
  filters,
  onLibraryChange,
  onFilterChange,
  onChanged,
  onSettings,
}: SidebarProps) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const activeLibrary = libraries.find((library) => library.id === libraryId);
  const close = () => setDialog(null);
  const edit =
    dialog &&
    dialog.kind !== 'delete' &&
    dialog.kind !== 'root' &&
    dialog.kind !== 'remove-root'
      ? dialog
      : null;

  function iconButton(
    label: string,
    symbol: string,
    action: () => void,
    disabled = false,
  ) {
    return (
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        data-create-library={label === t('newLibrary') ? '' : undefined}
        title={label}
        onClick={action}
        disabled={disabled}
      >
        <span aria-hidden="true">{symbol}</span>
      </button>
    );
  }

  function actions(name: string, onEdit: () => void, onDelete: () => void) {
    return (
      <span className="nav-actions">
        {iconButton(
          t('editItem', { name, defaultValue: 'Edit {{name}}' }),
          '✎',
          onEdit,
        )}
        {iconButton(
          t('deleteItem', { name, defaultValue: 'Delete {{name}}' }),
          '×',
          onDelete,
        )}
      </span>
    );
  }

  function tree(
    parentId: string | null,
    ancestors: Set<string> = new Set(),
  ): ReactNode {
    const children = folders.filter(
      (folder) => folder.parentId === parentId && !ancestors.has(folder.id),
    );
    if (!children.length) return null;
    return (
      <ul className={parentId ? 'tree-children' : 'tree-list'}>
        {children.map((folder) => (
          <li key={folder.id}>
            <div className="nav-row">
              <button
                type="button"
                className={`nav-item ${filters.folderId === folder.id && !filters.trash ? 'active' : ''}`}
                onClick={() =>
                  onFilterChange({
                    folderId: folder.id,
                    trash: false,
                    archived: false,
                  })
                }
              >
                <span className="nav-icon" aria-hidden="true">
                  ▱
                </span>
                <span>{folder.name}</span>
              </button>
              {actions(
                folder.name,
                () => setDialog({ kind: 'folder', ...folder }),
                () =>
                  setDialog({
                    kind: 'delete',
                    name: folder.name,
                    path: `/api/folders/${encodeURIComponent(folder.id)}`,
                    hint: t(
                      'deleteFolderHint',
                      'Assets remain in your library. Child folders move up one level.',
                    ),
                    clear:
                      filters.folderId === folder.id
                        ? { folderId: undefined }
                        : undefined,
                  }),
              )}
            </div>
            {tree(folder.id, new Set([...ancestors, folder.id]))}
          </li>
        ))}
      </ul>
    );
  }

  function tagList(groupId: string | null) {
    return tags
      .filter((tag) => tag.groupId === groupId)
      .map((tag) => (
        <div className="nav-row" key={tag.id}>
          <button
            type="button"
            className={`nav-item ${filters.tagId === tag.id && !filters.trash ? 'active' : ''}`}
            onClick={() =>
              onFilterChange({ tagId: tag.id, trash: false, archived: false })
            }
          >
            <span
              className="tag-dot"
              style={{ backgroundColor: tag.color }}
              aria-hidden="true"
            />
            <span>{tag.name}</span>
          </button>
          {actions(
            tag.name,
            () => setDialog({ kind: 'tag', ...tag }),
            () =>
              setDialog({
                kind: 'delete',
                name: tag.name,
                path: `/api/tags/${encodeURIComponent(tag.id)}`,
                hint: t(
                  'deleteTagHint',
                  'The tag will be removed from assets. Your assets remain in the library.',
                ),
                clear:
                  filters.tagId === tag.id ? { tagId: undefined } : undefined,
              }),
          )}
        </div>
      ));
  }

  const titles = {
    library: edit?.id
      ? t('renameLibrary', 'Rename library')
      : t('newLibrary', 'New library'),
    folder: edit?.id
      ? t('editFolder', 'Edit folder')
      : t('newFolder', 'New folder'),
    tag: edit?.id ? t('editTag', 'Edit tag') : t('newTag', 'New tag'),
    group: edit?.id
      ? t('editTagGroup', 'Edit tag group')
      : t('newTagGroup', 'New tag group'),
    collection: edit?.id
      ? t('editCollection', 'Edit saved search')
      : t('saveSearch', 'Save search'),
  };

  async function saveEdit() {
    if (!edit) return;
    const resources = {
      library: 'libraries',
      folder: 'folders',
      tag: 'tags',
      group: 'tag-groups',
      collection: 'collections',
    };
    const resource = resources[edit.kind];
    const path = edit.id
      ? `/api/${resource}/${encodeURIComponent(edit.id)}`
      : edit.kind === 'library'
        ? '/api/libraries'
        : `/api/libraries/${encodeURIComponent(libraryId)}/${resource}`;
    const body = {
      name: edit.name.trim(),
      ...(edit.kind === 'folder' ? { parentId: edit.parentId ?? null } : {}),
      ...(edit.kind === 'tag'
        ? { color: edit.color ?? '#ff8a3d', groupId: edit.groupId ?? null }
        : {}),
      ...(edit.kind === 'collection' ? { rules: edit.rules ?? {} } : {}),
    };
    const result = await request<Library>(path, {
      method: edit.id ? 'PATCH' : 'POST',
      body,
    });
    onChanged();
    if (edit.kind === 'library' && !edit.id) onLibraryChange(result.id);
    close();
  }

  function updateRule(patch: Filters) {
    if (edit) setDialog({ ...edit, rules: { ...edit.rules, ...patch } });
  }

  return (
    <aside
      className="sidebar"
      aria-label={t('libraryNavigation', 'Library navigation')}
    >
      <div className="sidebar-brand">
        <span className="brand-mark" aria-hidden="true">
          c
        </span>
        <h1>Cura</h1>
        <span className="local-badge">{t('localLibrary', 'LOCAL')}</span>
      </div>
      <div className="sidebar-library">
        <label className="sr-only" htmlFor="library-select">
          {t('library', 'Library')}
        </label>
        <select
          id="library-select"
          value={libraryId}
          onChange={(event) => onLibraryChange(event.target.value)}
        >
          {!libraries.length && (
            <option value="">{t('newLibrary', 'New library')}</option>
          )}
          {libraries.map((library) => (
            <option key={library.id} value={library.id}>
              {library.name}
            </option>
          ))}
        </select>
        {iconButton(t('newLibrary', 'New library'), '+', () =>
          setDialog({ kind: 'library', name: '' }),
        )}
        {iconButton(
          t('renameLibrary', 'Rename library'),
          '✎',
          () =>
            setDialog({
              kind: 'library',
              id: libraryId,
              name: activeLibrary?.name ?? '',
            }),
          !libraryId,
        )}
      </div>
      <div className="sidebar-scroll">
        <button
          type="button"
          className={`nav-item ${!filters.trash && !filters.archived && !filters.folderId && !filters.tagId ? 'active' : ''}`}
          onClick={() => onFilterChange({ ...emptyFilters })}
        >
          <span className="nav-icon" aria-hidden="true">
            ▦
          </span>
          <span>{t('allAssets', 'All assets')}</span>
        </button>
        <section className="sidebar-section">
          <div className="section-heading">
            <h2>{t('folders', 'Folders')}</h2>
            {iconButton(
              t('newFolder', 'New folder'),
              '+',
              () =>
                setDialog({
                  kind: 'folder',
                  name: '',
                  parentId: filters.folderId ?? null,
                }),
              !libraryId,
            )}
          </div>
          {folders.length ? (
            tree(null)
          ) : (
            <p className="empty-note">
              {t('noFolders', 'Organize your library')}
            </p>
          )}
        </section>
        <section className="sidebar-section">
          <div className="section-heading">
            <h2>{t('collections', 'Smart collections')}</h2>
            {iconButton(
              t('saveSearch', 'Save search'),
              '+',
              () =>
                setDialog({
                  kind: 'collection',
                  name: '',
                  rules: { ...filters },
                }),
              !libraryId,
            )}
          </div>
          {collections.map((collection) => (
            <div className="nav-row" key={collection.id}>
              <button
                type="button"
                className="nav-item"
                onClick={() =>
                  onFilterChange({
                    ...emptyFilters,
                    ...savedFilters(collection.rules),
                  })
                }
              >
                <span className="nav-icon" aria-hidden="true">
                  ◇
                </span>
                <span>{collection.name}</span>
              </button>
              {actions(
                collection.name,
                () =>
                  setDialog({
                    kind: 'collection',
                    id: collection.id,
                    name: collection.name,
                    rules: savedFilters(collection.rules),
                  }),
                () =>
                  setDialog({
                    kind: 'delete',
                    name: collection.name,
                    path: `/api/collections/${encodeURIComponent(collection.id)}`,
                    hint: t(
                      'deleteCollectionHint',
                      'Only this saved search is removed. Your assets remain in the library.',
                    ),
                  }),
              )}
            </div>
          ))}
          {!collections.length && (
            <p className="empty-note">
              {t('noCollections', 'Save filters you use often')}
            </p>
          )}
        </section>
        <section className="sidebar-section">
          <div className="section-heading">
            <h2>{t('tags', 'Tags')}</h2>
            <span>
              {iconButton(
                t('newTagGroup', 'New tag group'),
                '▱',
                () => setDialog({ kind: 'group', name: '' }),
                !libraryId,
              )}
              {iconButton(
                t('newTag', 'New tag'),
                '+',
                () =>
                  setDialog({
                    kind: 'tag',
                    name: '',
                    color: '#ff8a3d',
                    groupId: null,
                  }),
                !libraryId,
              )}
            </span>
          </div>
          {groups.map((group) => (
            <div className="tag-group" key={group.id}>
              <div className="nav-row group-heading">
                <span>{group.name}</span>
                {actions(
                  group.name,
                  () =>
                    setDialog({
                      kind: 'group',
                      id: group.id,
                      name: group.name,
                    }),
                  () =>
                    setDialog({
                      kind: 'delete',
                      name: group.name,
                      path: `/api/tag-groups/${encodeURIComponent(group.id)}`,
                      hint: t(
                        'deleteTagGroupHint',
                        'Tags are kept and moved out of this group.',
                      ),
                    }),
                )}
              </div>
              {tagList(group.id)}
            </div>
          ))}
          {tagList(null)}
          {!tags.length && !groups.length && (
            <p className="empty-note">
              {t('noTags', 'Add a little structure')}
            </p>
          )}
        </section>
        <section className="sidebar-section">
          <div className="section-heading">
            <h2>{t('registeredFolders', 'Watched folders')}</h2>
            {iconButton(
              t('registerFolder', 'Register folder'),
              '+',
              () => setDialog({ kind: 'root' }),
              !libraryId,
            )}
          </div>
          {roots.map((root) => (
            <div className="nav-row" key={root.id}>
              <span className="root-path" title={root.path}>
                <span aria-hidden="true">▱ </span>
                {root.kind === 'inbox' ? t('inbox', 'Inbox') : root.path}
              </span>
              {root.kind === 'reference' &&
                iconButton(
                  t('unregisterFolder', 'Unregister folder'),
                  '×',
                  () =>
                    setDialog({
                      kind: 'remove-root',
                      id: root.id,
                      path: root.path,
                      mode: 'trash',
                    }),
                )}
            </div>
          ))}
          {!roots.length && (
            <p className="empty-note">
              {t('noRoots', 'Connect a folder to begin')}
            </p>
          )}
        </section>
      </div>
      <div className="sidebar-footer">
        <button
          type="button"
          className={`nav-item ${filters.archived && !filters.trash ? 'active' : ''}`}
          onClick={() => onFilterChange({ ...emptyFilters, archived: true })}
        >
          <span className="nav-icon" aria-hidden="true">
            ▤
          </span>
          <span>{t('archivedAssets')}</span>
        </button>
        <button
          type="button"
          className={`nav-item ${filters.trash ? 'active' : ''}`}
          onClick={() => onFilterChange({ ...emptyFilters, trash: true })}
        >
          <span className="nav-icon" aria-hidden="true">
            ♲
          </span>
          <span>{t('trash', 'Trash')}</span>
        </button>
        <button type="button" className="nav-item" onClick={onSettings}>
          <span className="nav-icon" aria-hidden="true">
            ⚙
          </span>
          <span>{t('settings', 'Settings')}</span>
        </button>
      </div>
      {dialog?.kind === 'root' && (
        <DirectoryBrowserDialog
          libraryId={libraryId}
          onClose={close}
          onRegistered={onChanged}
        />
      )}
      {dialog?.kind === 'remove-root' && (
        <OrganizationDialog
          title={t('unregisterFolder')}
          submitLabel={t('unregisterFolder')}
          danger={dialog.mode === 'trash'}
          onClose={close}
          onSubmit={async () => {
            await request(
              `/api/roots/${encodeURIComponent(dialog.id)}?mode=${dialog.mode}`,
              { method: 'DELETE' },
            );
            onChanged();
            close();
          }}
        >
          <p className="root-path" title={dialog.path}>
            {dialog.path}
          </p>
          <p className="field-hint">{t('unregisterFolderHint')}</p>
          <fieldset className="root-removal-options">
            <legend>{t('unregisterFolderOptions')}</legend>
            {(['trash', 'offline'] as const).map((mode) => (
              <label className="root-removal-option" key={mode}>
                <input
                  type="radio"
                  name="root-removal-mode"
                  value={mode}
                  checked={dialog.mode === mode}
                  onChange={() => setDialog({ ...dialog, mode })}
                />
                <span>
                  {t(
                    mode === 'trash'
                      ? 'unregisterAndTrash'
                      : 'unregisterKeepOffline',
                  )}
                </span>
              </label>
            ))}
          </fieldset>
          <p className="field-hint">{t('unregisterOtherSourceHint')}</p>
        </OrganizationDialog>
      )}
      {dialog?.kind === 'delete' && (
        <OrganizationDialog
          title={t('deleteItem', {
            name: dialog.name,
            defaultValue: 'Delete {{name}}',
          })}
          submitLabel={t('delete', 'Delete')}
          danger
          onClose={close}
          onSubmit={async () => {
            await request(dialog.path, { method: 'DELETE' });
            if (dialog.clear) onFilterChange(dialog.clear);
            onChanged();
            close();
          }}
        >
          <p className="field-hint">{dialog.hint}</p>
        </OrganizationDialog>
      )}
      {edit && (
        <OrganizationDialog
          title={titles[edit.kind]}
          onClose={close}
          onSubmit={saveEdit}
          submitLabel={edit.id ? t('save', 'Save') : t('create', 'Create')}
          disabled={!edit.name.trim()}
        >
          <label className="form-field">
            <span>{t('name', 'Name')}</span>
            <input
              required
              maxLength={255}
              value={edit.name}
              onChange={(event) =>
                setDialog({ ...edit, name: event.target.value })
              }
            />
          </label>
          {edit.kind === 'folder' && (
            <label className="form-field">
              <span>{t('parentFolder', 'Parent folder')}</span>
              <select
                value={edit.parentId ?? ''}
                onChange={(event) =>
                  setDialog({ ...edit, parentId: event.target.value || null })
                }
              >
                <option value="">{t('topLevel', 'Top level')}</option>
                {folders
                  .filter(
                    (folder) => !edit.id || !isInside(folder, edit.id, folders),
                  )
                  .map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {edit.kind === 'tag' && (
            <>
              <label className="form-field">
                <span>{t('tagColor', 'Tag color')}</span>
                <input
                  type="color"
                  value={edit.color ?? '#ff8a3d'}
                  onChange={(event) =>
                    setDialog({ ...edit, color: event.target.value })
                  }
                />
              </label>
              <label className="form-field">
                <span>{t('tagGroup', 'Tag group')}</span>
                <select
                  value={edit.groupId ?? ''}
                  onChange={(event) =>
                    setDialog({ ...edit, groupId: event.target.value || null })
                  }
                >
                  <option value="">{t('noGroup', 'No group')}</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {edit.kind === 'collection' && (
            <>
              <p className="field-hint">
                {t(
                  'collectionRulesHint',
                  'Assets that match all of these filters appear automatically.',
                )}
              </p>
              <details className="collection-rules">
                <summary>{t('collectionRules', 'Search filters')}</summary>
                <div className="rule-grid">
                  <label className="form-field">
                    <span>{t('search', 'Search')}</span>
                    <input
                      value={edit.rules?.q ?? ''}
                      onChange={(event) =>
                        updateRule({ q: event.target.value || undefined })
                      }
                    />
                  </label>
                  <label className="form-field">
                    <span>{t('folders', 'Folders')}</span>
                    <select
                      value={edit.rules?.folderId ?? ''}
                      onChange={(event) =>
                        updateRule({
                          folderId: event.target.value || undefined,
                        })
                      }
                    >
                      <option value="">{t('allFolders', 'All folders')}</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    <span>{t('tags', 'Tags')}</span>
                    <select
                      value={edit.rules?.tagId ?? ''}
                      onChange={(event) =>
                        updateRule({ tagId: event.target.value || undefined })
                      }
                    >
                      <option value="">{t('allTags', 'All tags')}</option>
                      {tags.map((tag) => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    <span>{t('rating', 'Rating')}</span>
                    <select
                      value={edit.rules?.rating ?? ''}
                      onChange={(event) =>
                        updateRule({
                          rating:
                            event.target.value === ''
                              ? undefined
                              : Number(event.target.value),
                        })
                      }
                    >
                      <option value="">{t('anyRating', 'Any rating')}</option>
                      {[0, 1, 2, 3, 4, 5].map((rating) => (
                        <option key={rating} value={rating}>
                          {rating
                            ? '★'.repeat(rating)
                            : t('unrated', 'Unrated')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    <span>{t('fileType', 'Format')}</span>
                    <input
                      value={edit.rules?.type ?? ''}
                      onChange={(event) =>
                        updateRule({ type: event.target.value || undefined })
                      }
                    />
                  </label>
                  <label className="form-field">
                    <span>{t('source', 'Source')}</span>
                    <input
                      value={edit.rules?.source ?? ''}
                      onChange={(event) =>
                        updateRule({ source: event.target.value || undefined })
                      }
                    />
                  </label>
                  <label className="form-field">
                    <span>{t('color', 'Color')}</span>
                    <input
                      pattern="#[0-9a-fA-F]{6}"
                      placeholder="#ff8a3d"
                      value={edit.rules?.color ?? ''}
                      onChange={(event) =>
                        updateRule({ color: event.target.value || undefined })
                      }
                    />
                  </label>
                  {(['minWidth', 'minHeight'] as const).map((key) => (
                    <label className="form-field" key={key}>
                      <span>
                        {key === 'minWidth'
                          ? t('minWidth', 'Minimum width')
                          : t('minHeight', 'Minimum height')}
                      </span>
                      <input
                        type="number"
                        min="0"
                        value={edit.rules?.[key] ?? ''}
                        onChange={(event) =>
                          updateRule({
                            [key]:
                              event.target.value === ''
                                ? undefined
                                : Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                  {(['after', 'before'] as const).map((key) => (
                    <label className="form-field" key={key}>
                      <span>
                        {key === 'after'
                          ? t('after', 'Created after')
                          : t('before', 'Created before')}
                      </span>
                      <input
                        type="date"
                        value={edit.rules?.[key]?.slice(0, 10) ?? ''}
                        onChange={(event) =>
                          updateRule({
                            [key]: event.target.value
                              ? new Date(
                                  `${event.target.value}T${key === 'after' ? '00:00:00.000' : '23:59:59.999'}Z`,
                                ).toISOString()
                              : undefined,
                          })
                        }
                      />
                    </label>
                  ))}
                  <label className="form-field">
                    <span>{t('sourceAvailability')}</span>
                    <select
                      value={
                        edit.rules?.missing === undefined
                          ? ''
                          : edit.rules.missing
                            ? 'missing'
                            : 'available'
                      }
                      onChange={(event) =>
                        updateRule({
                          missing:
                            event.target.value === ''
                              ? undefined
                              : event.target.value === 'missing',
                        })
                      }
                    >
                      <option value="">{t('allSources')}</option>
                      <option value="missing">{t('sourceUnavailable')}</option>
                      <option value="available">{t('sourceAvailable')}</option>
                    </select>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={edit.rules?.archived ?? false}
                      onChange={(event) =>
                        updateRule({ archived: event.target.checked })
                      }
                    />
                    {t('searchArchived')}
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={edit.rules?.trash ?? false}
                      onChange={(event) =>
                        updateRule({ trash: event.target.checked })
                      }
                    />
                    {t('searchTrash', 'Search in trash')}
                  </label>
                </div>
              </details>
              <button
                type="button"
                onClick={() => setDialog({ ...edit, rules: { ...filters } })}
              >
                {t('replaceCollectionRules', 'Use current filters')}
              </button>
            </>
          )}
        </OrganizationDialog>
      )}
    </aside>
  );
}
