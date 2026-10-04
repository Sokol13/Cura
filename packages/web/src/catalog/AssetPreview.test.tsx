import type { Annotation, Asset, AssetVersion } from '@cura/shared';
import { useState } from 'react';
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
import { AssetPreview } from './AssetPreview';

const timestamp = '2026-10-04T10:00:00.000Z';
const file = {
  hash: 'abc',
  type: 'image/png',
  size: 1200,
  width: 1200,
  height: 800,
  colors: ['#c87a4b'],
  phash: '',
  exif: {},
  prompt: '',
  negativePrompt: '',
  model: '',
  seed: '',
  source: '',
  params: {},
  createdAt: timestamp,
  updatedAt: timestamp,
};
const asset: Asset = {
  displayName: null,
  archivedAt: null,
  ...file,
  id: 'asset-a',
  libraryId: 'library-a',
  rootId: 'root-a',
  relativePath: 'portrait.png',
  name: 'portrait.png',
  currentVersionId: 'version-2',
  rating: 0,
  note: '',
  folderId: null,
  deletedAt: null,
  finalized: false,
  tags: [],
};
const originalVersions: AssetVersion[] = [
  {
    ...file,
    id: 'version-2',
    assetId: asset.id,
    ordinal: 2,
    name: 'portrait.png',
  },
  {
    ...file,
    id: 'version-1',
    assetId: asset.id,
    ordinal: 1,
    name: 'sketch.png',
  },
];
let versions: AssetVersion[];
let notes: Annotation[];
let failLoad: boolean;
let uploaded: BodyInit | null | undefined;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  versions = structuredClone(originalVersions);
  notes = [];
  failLoad = false;
  uploaded = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (failLoad)
        return Response.json(
          { error: 'Library is unavailable', code: 'FAILED' },
          { status: 503 },
        );
      if (url === '/api/assets/asset-b/versions')
        return Response.json([
          {
            ...file,
            id: 'version-b',
            assetId: 'asset-b',
            ordinal: 1,
            name: 'landscape.png',
          },
        ]);
      if (url.endsWith('/versions')) return Response.json(versions);
      if (url.includes('/replace?')) {
        uploaded = init?.body;
        const next = {
          ...originalVersions[0]!,
          id: 'version-3',
          ordinal: 3,
          name: 'new portrait.png',
        };
        versions.unshift(next);
        return Response.json({ ...asset, currentVersionId: next.id });
      }
      if (url.endsWith('/annotations') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Pick<
          Annotation,
          'versionId' | 'x' | 'y' | 'text'
        >;
        const note = {
          ...body,
          id: 'note-new',
          assetId: asset.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        notes.push(note);
        return Response.json(note, { status: 201 });
      }
      if (url.includes('/api/annotations/') && init?.method === 'PATCH') {
        const patch = JSON.parse(String(init.body)) as Partial<
          Pick<Annotation, 'text' | 'x' | 'y'>
        >;
        const note = notes.find((item) => url.endsWith(item.id))!;
        Object.assign(note, patch);
        return Response.json(note);
      }
      if (url.includes('/api/annotations/') && init?.method === 'DELETE') {
        notes = notes.filter((note) => !url.endsWith(note.id));
        return Response.json({ ok: true });
      }
      if (url.includes('/annotations')) return Response.json(notes);
      if (url === `/api/assets/${asset.id}`)
        return Response.json({ ...asset, currentVersionId: versions[0]!.id });
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function mount(value = asset) {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const result = render(
    <AssetPreview asset={value} onClose={onClose} onChanged={onChanged} />,
  );
  return { ...result, onClose, onChanged };
}

async function ready() {
  return screen.findByRole('button', { name: /View V1/ });
}

describe('asset preview', () => {
  it('opens the current original image in an accessible dialog and restores focus', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { unmount, onClose } = mount();
    await ready();
    const dialog = screen.getByRole('dialog', { name: 'Asset preview' });
    expect(
      within(dialog).getByRole('img', { name: 'portrait.png — V2' }),
    ).toHaveAttribute('src', '/api/versions/version-2/file');
    expect(screen.getByRole('button', { name: 'Close preview' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('navigates adjacent assets with buttons and arrows while respecting editable fields and boundaries', async () => {
    const gallery = [
      asset,
      {
        ...asset,
        id: 'asset-b',
        currentVersionId: 'version-b',
        name: 'landscape.png',
      },
    ];
    function Gallery() {
      const [index, setIndex] = useState(0);
      return (
        <AssetPreview
          asset={gallery[index]!}
          onClose={() => {}}
          onChanged={() => {}}
          onNavigate={(direction) => setIndex((current) => current + direction)}
          hasPrevious={index > 0}
          hasNext={index < gallery.length - 1}
        />
      );
    }
    render(<Gallery />);
    await ready();
    expect(
      screen.getByRole('button', { name: 'Previous asset' }),
    ).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close preview' }), {
      key: 'ArrowLeft',
    });
    expect(screen.getByRole('heading', { name: 'portrait.png' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next asset' }));
    expect(
      await screen.findByRole('img', { name: 'landscape.png — V1' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next asset' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close preview' }), {
      key: 'ArrowLeft',
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place at center' }));
    fireEvent.keyDown(
      screen.getByRole('textbox', { name: 'Annotation text' }),
      { key: 'ArrowRight' },
    );
    expect(screen.getByRole('heading', { name: 'portrait.png' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close preview' }), {
      key: 'ArrowRight',
    });
    expect(
      await screen.findByRole('img', { name: 'landscape.png — V1' }),
    ).toBeVisible();
  });

  it('edits an annotation without changing its identity, version, or coordinates', async () => {
    notes = [
      {
        id: 'note-1',
        assetId: asset.id,
        versionId: 'version-2',
        x: 0.2,
        y: 0.3,
        text: 'Original note',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Edit annotation 1' }));
    const textbox = screen.getByRole('textbox', { name: 'Annotation text' });
    expect(textbox).toHaveValue('Original note');
    expect(textbox).toHaveFocus();
    fireEvent.change(textbox, { target: { value: 'Revised note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }));
    expect(
      await screen.findByRole('button', { name: 'Annotation 1: Revised note' }),
    ).toBeVisible();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: 'note-1',
      versionId: 'version-2',
      x: 0.2,
      y: 0.3,
      text: 'Revised note',
    });
    expect(screen.getByRole('dialog')).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it('refreshes an open asset when its current version changes and clears a stale annotation draft', async () => {
    const { rerender, onClose, onChanged } = mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place at center' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Annotation text' }), {
      target: { value: 'Old version draft' },
    });
    versions.unshift({
      ...originalVersions[0]!,
      id: 'version-3',
      ordinal: 3,
      name: 'watched.png',
    });
    notes = [
      {
        id: 'note-3',
        assetId: asset.id,
        versionId: 'version-3',
        x: 0.1,
        y: 0.7,
        text: 'Latest note',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    rerender(
      <AssetPreview
        asset={{ ...asset, currentVersionId: 'version-3', name: 'watched.png' }}
        onClose={onClose}
        onChanged={onChanged}
      />,
    );
    expect(
      await screen.findByRole('img', { name: 'watched.png — V3' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Annotation 1: Latest note' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: 'Annotation text' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View V2/ })).toBeVisible();
  });

  it('keeps an explicitly selected historical version when a new current version arrives', async () => {
    const { rerender, onClose, onChanged } = mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /View V1/ }));
    versions.unshift({
      ...originalVersions[0]!,
      id: 'version-3',
      ordinal: 3,
      name: 'watched.png',
    });
    rerender(
      <AssetPreview
        asset={{ ...asset, currentVersionId: 'version-3' }}
        onClose={onClose}
        onChanged={onChanged}
      />,
    );
    await screen.findByRole('button', { name: /View V3/ });
    expect(screen.getByRole('img', { name: 'sketch.png — V1' })).toBeVisible();
    expect(screen.getByRole('button', { name: /View V1/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('zooms with buttons and the range, then resets to fit', async () => {
    mount();
    await ready();
    const zoom = screen.getByRole('slider', { name: 'Zoom' });
    const before = Number((zoom as HTMLInputElement).value);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(Number((zoom as HTMLInputElement).value)).toBeGreaterThan(before);
    fireEvent.change(zoom, { target: { value: '150' } });
    expect(screen.getByText('150%')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Fit image' }));
    expect(Number((zoom as HTMLInputElement).value)).toBeLessThanOrEqual(100);
  });

  it('shows distinct immutable versions side by side', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Compare versions' }));
    expect(
      screen.getByRole('img', { name: 'sketch.png — V1' }),
    ).toHaveAttribute('src', '/api/versions/version-1/file');
    expect(
      screen.getByRole('img', { name: 'portrait.png — V2' }),
    ).toHaveAttribute('src', '/api/versions/version-2/file');
    expect(screen.getByRole('combobox', { name: 'Left version' })).toHaveValue(
      'version-1',
    );
    expect(screen.getByRole('combobox', { name: 'Right version' })).toHaveValue(
      'version-2',
    );
  });

  it('saves normalized image coordinates and keeps annotations on their version', async () => {
    const { onChanged } = mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
    const image = screen.getByRole('img', { name: 'portrait.png — V2' });
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 50,
      left: 100,
      top: 50,
      right: 500,
      bottom: 250,
      width: 400,
      height: 200,
      toJSON: () => ({}),
    });
    fireEvent.click(image, { clientX: 200, clientY: 200 });
    fireEvent.change(screen.getByRole('textbox', { name: 'Annotation text' }), {
      target: { value: 'Warm the lighting' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }));
    expect(
      await screen.findByText('Warm the lighting', { selector: 'p' }),
    ).toBeVisible();
    expect(notes[0]).toMatchObject({
      versionId: 'version-2',
      x: 0.25,
      y: 0.75,
      text: 'Warm the lighting',
    });
    expect(onChanged).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /View V1/ }));
    expect(screen.queryByText('Warm the lighting')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /View V2/ }));
    expect(screen.getByText('Warm the lighting')).toBeVisible();
  });

  it('deletes a note and removes its image marker', async () => {
    notes = [
      {
        id: 'note-1',
        assetId: asset.id,
        versionId: 'version-2',
        x: 0.2,
        y: 0.3,
        text: 'A note',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    mount();
    await ready();
    expect(
      screen.getByRole('button', { name: 'Annotation 1: A note' }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete annotation 1' }),
    );
    await waitFor(() =>
      expect(screen.queryByText('A note')).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: 'Annotation 1: A note' }),
    ).not.toBeInTheDocument();
  });

  it('preserves editing keys inside annotation text and traps tab focus', async () => {
    const { onClose } = mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place at center' }));
    const textbox = screen.getByRole('textbox', { name: 'Annotation text' });
    fireEvent.keyDown(textbox, { key: 'Escape' });
    fireEvent.keyDown(textbox, { key: ' ' });
    expect(onClose).not.toHaveBeenCalled();
    const close = screen.getByRole('button', { name: 'Close preview' });
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(close).not.toHaveFocus();
    expect(screen.getByRole('dialog')).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it('keeps focus inside the dialog after saving or deleting an annotation', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place at center' }));
    const textbox = screen.getByRole('textbox', { name: 'Annotation text' });
    textbox.focus();
    fireEvent.change(textbox, { target: { value: 'Focusable note' } });
    fireEvent.submit(textbox.closest('form')!);
    await screen.findByText('Focusable note', { selector: 'p' });
    expect(screen.getByRole('dialog')).toContainElement(
      document.activeElement as HTMLElement,
    );
    const remove = screen.getByRole('button', { name: 'Delete annotation 1' });
    remove.focus();
    fireEvent.click(remove);
    await waitFor(() =>
      expect(screen.queryByText('Focusable note')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog')).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it('uploads replacement bytes and retains both previous versions', async () => {
    const { onChanged } = mount();
    await ready();
    const replacement = new File(['new-image-bytes'], 'new portrait.png', {
      type: 'image/png',
    });
    fireEvent.change(screen.getByLabelText('Replace file'), {
      target: { files: [replacement] },
    });
    expect(
      await screen.findByRole('button', { name: /View V3/ }),
    ).toBeVisible();
    expect(uploaded).toBe(replacement);
    expect(screen.getByRole('button', { name: /View V1/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /View V2/ })).toBeVisible();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('img', { name: 'new portrait.png — V3' }),
    ).toHaveAttribute('src', '/api/versions/version-3/file');
  });

  it('uses only rasterized thumbnails for SVG and offers generic files as downloads', async () => {
    versions = [{ ...originalVersions[0]!, type: 'image/svg+xml' }];
    const { unmount } = mount({ ...asset, type: 'image/svg+xml' });
    await screen.findByRole('button', { name: /View V2/ });
    expect(
      screen.getByRole('img', { name: 'portrait.png — V2' }),
    ).toHaveAttribute('src', '/api/versions/version-2/thumbnail');
    unmount();
    versions = [
      {
        ...originalVersions[0]!,
        type: 'application/octet-stream',
        width: null,
        height: null,
      },
    ];
    mount({
      ...asset,
      type: 'application/octet-stream',
      width: null,
      height: null,
    });
    await screen.findByRole('button', { name: /View V2/ });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(
      screen.getByText('Preview is not available for this file type.'),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Download original' }),
    ).toHaveAttribute('href', '/api/versions/version-2/file');
  });

  it('reports failed loads and retries without losing the dialog', async () => {
    failLoad = true;
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Library is unavailable',
    );
    failLoad = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the selected historical version when the interface language changes', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /View V1/ }));
    await act(() => i18n.changeLanguage('zh-CN'));
    expect(
      screen.getByRole('img', { name: 'sketch.png — V1' }),
    ).toHaveAttribute('src', '/api/versions/version-1/file');
  });

  it('resets comparison and annotations when the dialog receives a different asset', async () => {
    const { rerender, onClose, onChanged } = mount();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Compare versions' }));
    versions = [
      {
        ...originalVersions[0]!,
        id: 'other-version',
        assetId: 'other-asset',
        name: 'other.png',
        ordinal: 1,
      },
    ];
    rerender(
      <AssetPreview
        asset={{
          ...asset,
          id: 'other-asset',
          name: 'other.png',
          currentVersionId: 'other-version',
        }}
        onClose={onClose}
        onChanged={onChanged}
      />,
    );
    expect(
      await screen.findByRole('img', { name: 'other.png — V1' }),
    ).toHaveAttribute('src', '/api/versions/other-version/file');
    expect(
      screen.queryByRole('combobox', { name: 'Left version' }),
    ).not.toBeInTheDocument();
  });

  it('shows a friendly image failure and translated controls', async () => {
    mount();
    await ready();
    fireEvent.error(screen.getByRole('img', { name: 'portrait.png — V2' }));
    expect(
      screen.getByText(
        'This image could not be loaded. You can still download the original.',
      ),
    ).toBeVisible();
    await act(() => i18n.changeLanguage('zh-CN'));
    expect(screen.getByRole('button', { name: '关闭预览' })).toBeVisible();
    expect(screen.getByRole('button', { name: '替换文件' })).toBeVisible();
  });
});
