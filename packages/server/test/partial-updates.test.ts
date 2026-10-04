import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '../src/database.js';
import { CatalogStore } from '../src/catalog-store.js';

it('preserves unspecified preferences and relationships during partial updates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cura-patch-'));
  const db = openDatabase({
    data: join(dir, 'data'),
    cache: join(dir, 'cache'),
    log: join(dir, 'log'),
  });
  try {
    const store = new CatalogStore(db);
    const library = store.createLibrary({ name: 'Design' });
    store.updateSettings({
      language: 'en',
      theme: 'light',
      layout: 'list',
      sidebarWidth: 300,
    });
    expect(store.updateSettings({ activeLibraryId: library.id })).toMatchObject(
      { language: 'en', theme: 'light', layout: 'list', sidebarWidth: 300 },
    );
    const group = store.createTagGroup(library.id, { name: 'Style' });
    const tag = store.createTag(library.id, {
      name: 'Draft',
      color: '#123456',
      groupId: group.id,
    });
    expect(store.updateTag(tag.id, { name: 'Final' })).toMatchObject({
      name: 'Final',
      color: '#123456',
      groupId: group.id,
    });
    const parent = store.createFolder(library.id, { name: 'Parent' });
    const child = store.createFolder(library.id, {
      name: 'Child',
      parentId: parent.id,
    });
    expect(store.updateFolder(child.id, { name: 'Updated' })).toMatchObject({
      name: 'Updated',
      parentId: parent.id,
    });
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
