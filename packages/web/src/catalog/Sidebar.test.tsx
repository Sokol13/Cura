import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../i18n';
import { Sidebar } from './Sidebar';

const stamp = {
  createdAt: '2026-10-04T00:00:00.000Z',
  updatedAt: '2026-10-04T00:00:00.000Z',
};
const libraries = [
  { ...stamp, id: 'library-1', name: 'Studio' },
  { ...stamp, id: 'library-2', name: 'Archive' },
];
const folders = [
  {
    ...stamp,
    id: 'folder-1',
    libraryId: 'library-1',
    name: 'Characters',
    parentId: null,
  },
  {
    ...stamp,
    id: 'folder-2',
    libraryId: 'library-1',
    name: 'Portraits',
    parentId: 'folder-1',
  },
  {
    ...stamp,
    id: 'folder-3',
    libraryId: 'library-1',
    name: 'Environments',
    parentId: null,
  },
];
const groups = [
  { ...stamp, id: 'group-1', libraryId: 'library-1', name: 'Style' },
];
const tags = [
  {
    ...stamp,
    id: 'tag-1',
    libraryId: 'library-1',
    name: 'Cinematic',
    groupId: 'group-1',
    color: '#ff8a3d',
  },
];
const collections = [
  {
    ...stamp,
    id: 'collection-1',
    libraryId: 'library-1',
    name: 'Favorites',
    rules: { rating: 5, trash: false, archived: false, offset: 0, limit: 100 },
  },
];
const fetchMock = vi.fn<typeof fetch>();

function mount(overrides: Record<string, unknown> = {}) {
  const callbacks = {
    onLibraryChange: vi.fn(),
    onFilterChange: vi.fn(),
    onChanged: vi.fn(),
    onError: vi.fn(),
    onSettings: vi.fn(),
  };
  render(
    <Sidebar
      libraries={libraries}
      libraryId="library-1"
      roots={[]}
      folders={folders}
      groups={groups}
      tags={tags}
      collections={collections}
      filters={{ q: 'old', tagId: 'tag-1' }}
      {...callbacks}
      {...overrides}
    />,
  );
  return callbacks;
}

function ok(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok({ ok: true }));
});
afterEach(() => vi.unstubAllGlobals());

describe('catalog sidebar', () => {
  it('defaults root removal to recoverable trash and keeps the original-file explanation clear', async () => {
    const callbacks = mount({
      roots: [
        {
          ...stamp,
          id: 'root-1',
          libraryId: 'library-1',
          path: '/Pictures',
          kind: 'reference',
        },
      ],
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Unregister directory' }),
    );
    const dialog = within(screen.getByRole('dialog'));
    expect(
      dialog.getByRole('radio', {
        name: 'Also remove these assets (move to Trash; recoverable)',
      }),
    ).toBeChecked();
    expect(
      dialog.getByRole('radio', {
        name: 'Only stop watching (keep history; mark assets offline)',
      }),
    ).not.toBeChecked();
    expect(
      dialog.getByText(/Original files stay in their current folder/),
    ).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(
      dialog.getByRole('button', { name: 'Unregister directory' }),
    );
    await waitFor(() => expect(callbacks.onChanged).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/roots/root-1?mode=trash',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('supports offline removal and restores the trash default after cancelling and reopening', async () => {
    const callbacks = mount({
      roots: [
        {
          ...stamp,
          id: 'root-1',
          libraryId: 'library-1',
          path: '/Pictures',
          kind: 'reference',
        },
      ],
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Unregister directory' }),
    );
    let dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('radio', { name: /Only stop watching/ }));
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Unregister directory' }),
    );
    dialog = within(screen.getByRole('dialog'));
    expect(
      dialog.getByRole('radio', { name: /Also remove these assets/ }),
    ).toBeChecked();
    fireEvent.click(dialog.getByRole('radio', { name: /Only stop watching/ }));
    fireEvent.click(
      dialog.getByRole('button', { name: 'Unregister directory' }),
    );
    await waitFor(() => expect(callbacks.onChanged).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/roots/root-1?mode=offline',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('keeps reverse keyboard navigation inside the dialog after selecting offline mode', () => {
    mount({
      roots: [
        {
          ...stamp,
          id: 'root-1',
          libraryId: 'library-1',
          path: '/Pictures',
          kind: 'reference',
        },
      ],
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Unregister directory' }),
    );
    const dialog = within(screen.getByRole('dialog'));
    const offline = dialog.getByRole('radio', { name: /Only stop watching/ });
    fireEvent.click(offline);
    offline.focus();
    fireEvent.keyDown(offline, { key: 'Tab', shiftKey: true });
    expect(
      dialog.getByRole('button', { name: 'Unregister directory' }),
    ).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(offline).toHaveFocus();
  });

  it('shows both explicit root-removal choices in Chinese', async () => {
    await i18n.changeLanguage('zh-CN');
    mount({
      roots: [
        {
          ...stamp,
          id: 'root-1',
          libraryId: 'library-1',
          path: '/Pictures',
          kind: 'reference',
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: '取消登记目录' }));
    expect(
      screen.getByRole('radio', {
        name: '同时移除这些资产（进回收站，可恢复）',
      }),
    ).toBeChecked();
    expect(
      screen.getByRole('radio', {
        name: '仅停止监听（保留历史版本，资产标记为离线）',
      }),
    ).not.toBeChecked();
  });

  it('restores, edits and clears the unavailable-source rule in saved searches', async () => {
    const callbacks = mount({
      filters: { missing: true },
      collections: [
        {
          ...collections[0],
          rules: { ...collections[0]!.rules, missing: true },
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    expect(callbacks.onFilterChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ missing: true }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'All assets' }));
    expect(callbacks.onFilterChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ missing: undefined }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit Favorites' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('Source availability')).toHaveValue('missing');
    fireEvent.change(dialog.getByLabelText('Source availability'), {
      target: { value: '' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.rules).not.toHaveProperty('missing');
  });

  it('applies an API-created available-source rule and preserves it when renaming the collection', async () => {
    const callbacks = mount({
      collections: [
        {
          ...collections[0],
          rules: { ...collections[0]!.rules, missing: false },
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    expect(callbacks.onFilterChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ missing: false }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit Favorites' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('Source availability')).toHaveValue(
      'available',
    );
    fireEvent.change(dialog.getByLabelText('Name'), {
      target: { value: 'Available favorites' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({ name: 'Available favorites', rules: { missing: false } });
  });

  it('keeps unavailable-source filtering when saving a new smart folder', async () => {
    mount({ filters: { missing: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Save search' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Name'), {
      target: { value: 'Offline assets' },
    });
    expect(dialog.getByLabelText('Source availability')).toHaveValue('missing');
    fireEvent.click(dialog.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({ name: 'Offline assets', rules: { missing: true } });
  });

  it('opens archived assets and restores archived filters from a saved search', () => {
    const callbacks = mount({
      filters: { archived: true },
      collections: [
        {
          ...collections[0],
          rules: { ...collections[0]!.rules, archived: true },
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Archived assets' }));
    expect(callbacks.onFilterChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ archived: true, trash: false, q: undefined }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'All assets' }));
    expect(callbacks.onFilterChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ archived: false, trash: false }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    expect(callbacks.onFilterChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ archived: true, rating: 5 }),
    );
  });

  it('retains the archive filter when saving and editing a smart folder', async () => {
    mount({ filters: { archived: true, q: 'hero' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save search' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Name'), {
      target: { value: 'Archived heroes' },
    });
    expect(dialog.getByLabelText('Search archived assets')).toBeChecked();
    fireEvent.click(dialog.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const options = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(options?.body))).toMatchObject({
      name: 'Archived heroes',
      rules: { archived: true, q: 'hero' },
    });
  });
  it('switches libraries and creates a named library in an accessible dialog', async () => {
    const callbacks = mount();
    fireEvent.change(screen.getByLabelText('Library'), {
      target: { value: 'library-2' },
    });
    expect(callbacks.onLibraryChange).toHaveBeenCalledWith('library-2');
    fireEvent.click(screen.getByRole('button', { name: 'New library' }));
    const dialog = screen.getByRole('dialog', { name: 'New library' });
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Film studies' },
    });
    fetchMock.mockResolvedValueOnce(
      ok({ ...stamp, id: 'library-3', name: 'Film studies' }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(callbacks.onLibraryChange).toHaveBeenCalledWith('library-3'),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/libraries',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Film studies' }),
      }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reparents a folder without offering itself or its descendants as parents', async () => {
    const callbacks = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Characters' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit folder' });
    const parent = within(dialog).getByLabelText('Parent folder');
    expect(
      within(parent).queryByRole('option', { name: 'Characters' }),
    ).not.toBeInTheDocument();
    expect(
      within(parent).queryByRole('option', { name: /Portraits/ }),
    ).not.toBeInTheDocument();
    fireEvent.change(parent, { target: { value: 'folder-3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(callbacks.onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/folders/folder-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Characters', parentId: 'folder-3' }),
      }),
    );
  });

  it('navigates server directories and registers only the selected directory', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (input === '/api/directories')
        return ok({
          path: '/home',
          parent: '/',
          directories: [{ name: 'Pictures', path: '/home/Pictures' }],
        });
      if (input === '/api/directories?path=%2Fhome%2FPictures')
        return ok({ path: '/home/Pictures', parent: '/home', directories: [] });
      return ok({ ok: true });
    });
    const callbacks = mount();
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('registerFolder') }),
    );
    const dialog = screen.getByRole('dialog', {
      name: i18n.t('registerFolder'),
    });
    fireEvent.click(
      await within(dialog).findByRole('button', { name: 'Pictures' }),
    );
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Directory path')).toHaveValue(
        '/home/Pictures',
      ),
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: i18n.t('registerFolder') }),
    );
    await waitFor(() => expect(callbacks.onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/libraries/library-1/roots',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/home/Pictures' }),
      }),
    );
  });

  it('keeps native path editing unavailable until the pending directory value is established', async () => {
    let resolveHome: ((response: Response) => void) | undefined;
    const home = new Promise<Response>((resolve) => {
      resolveHome = resolve;
    });
    fetchMock.mockImplementation(async (input) => {
      if (input === '/api/directories') return home;
      return ok({ ok: true });
    });
    const callbacks = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Register directory' }));
    const dialog = screen.getByRole('dialog', { name: 'Register directory' });
    const input = within(dialog).getByLabelText('Directory path');
    // Native fill first selects the old value, then inserts text. A late home
    // response between those steps must not turn an absolute path into home + path.
    expect(input).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toHaveFocus();
    await act(async () =>
      resolveHome?.(
        ok({ path: '/home/runner', parent: '/home', directories: [] }),
      ),
    );
    expect(input).toBeEnabled();
    expect(input).toHaveValue('/home/runner');
    fireEvent.change(input, { target: { value: '/tmp/cura-images' } });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Register directory' }),
    );
    await waitFor(() => expect(callbacks.onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/libraries/library-1/roots',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/tmp/cura-images' }),
      }),
    );
  });

  it('preserves a typed directory while the initial home listing is still loading', async () => {
    let resolveHome: ((response: Response) => void) | undefined;
    const home = new Promise<Response>((resolve) => {
      resolveHome = resolve;
    });
    fetchMock.mockImplementation(async (input) => {
      if (input === '/api/directories') return home;
      if (input === '/api/directories?path=%2Ftmp%2Fcura-images')
        return ok({
          path: '/tmp/cura-images',
          parent: '/tmp',
          directories: [],
        });
      return ok({ ok: true });
    });
    const callbacks = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Register directory' }));
    const dialog = screen.getByRole('dialog', { name: 'Register directory' });
    const input = within(dialog).getByLabelText('Directory path');
    fireEvent.change(input, { target: { value: '/tmp/cura-images' } });
    await act(async () =>
      resolveHome?.(
        ok({ path: '/home/runner', parent: '/home', directories: [] }),
      ),
    );
    expect(input).toHaveValue('/tmp/cura-images');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Browse' }));
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Register directory' }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Register directory' }),
    );
    await waitFor(() => expect(callbacks.onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/libraries/library-1/roots',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/tmp/cura-images' }),
      }),
    );
  });

  it('preserves newer path edits when an explicit browse response completes', async () => {
    let resolveBrowse: ((response: Response) => void) | undefined;
    const listing = new Promise<Response>((resolve) => {
      resolveBrowse = resolve;
    });
    fetchMock.mockImplementation(async (input) => {
      if (input === '/api/directories')
        return ok({ path: '/home/runner', parent: '/home', directories: [] });
      if (input === '/api/directories?path=%2Ftmp%2Ffirst') return listing;
      return ok({ ok: true });
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Register directory' }));
    const dialog = screen.getByRole('dialog', { name: 'Register directory' });
    const input = within(dialog).getByLabelText('Directory path');
    await waitFor(() => expect(input).toHaveValue('/home/runner'));
    fireEvent.change(input, { target: { value: '/tmp/first' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Browse' }));
    fireEvent.change(input, { target: { value: '/tmp/new-choice' } });
    await act(async () =>
      resolveBrowse?.(
        ok({ path: '/tmp/first', parent: '/tmp', directories: [] }),
      ),
    );
    expect(input).toHaveValue('/tmp/new-choice');
  });

  it('keeps failed mutations open with the entered value for correction', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'A folder with that name already exists',
          code: 'CONFLICT',
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const callbacks = mount();
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Characters' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A folder with that name already exists',
    );
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Characters');
    expect(callbacks.onChanged).not.toHaveBeenCalled();
  });

  it('edits tag name, color and group together', async () => {
    const callbacks = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Cinematic' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit tag' });
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Film' },
    });
    fireEvent.change(within(dialog).getByLabelText('Tag color'), {
      target: { value: '#22aa88' },
    });
    fireEvent.change(within(dialog).getByLabelText('Tag group'), {
      target: { value: '' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(callbacks.onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tags/tag-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Film', color: '#22aa88', groupId: null }),
      }),
    );
  });

  it('requires an explicit confirmation before removing a folder', async () => {
    const callbacks = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Characters' }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );
    await waitFor(() => expect(callbacks.onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/folders/folder-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('replaces previous filters when selecting a saved search', () => {
    const callbacks = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    expect(callbacks.onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({
        rating: 5,
        q: undefined,
        tagId: undefined,
        trash: false,
        archived: false,
      }),
    );
  });

  it('saves the current combined filters as a named smart collection', async () => {
    const callbacks = mount({
      filters: { q: 'forest', rating: 4, color: '#447744' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save search' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Forest moodboard' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(callbacks.onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/libraries/library-1/collections',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Forest moodboard',
          rules: { q: 'forest', rating: 4, color: '#447744' },
        }),
      }),
    );
  });
});
