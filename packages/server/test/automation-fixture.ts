import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../src/database.js';
import { resolveUserPaths } from '../src/paths.js';
import { CatalogStore } from '../src/catalog-store.js';
import { MediaService } from '../src/media/service.js';
import { processFile } from '../src/media/image.js';
export async function automationFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'cura-automation-'));
  const paths = resolveUserPaths({
    CURA_DATA_DIR: join(dir, 'data'),
    CURA_CACHE_DIR: join(dir, 'cache'),
    CURA_LOG_DIR: join(dir, 'logs'),
  });
  const database = openDatabase(paths);
  if (
    !database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE name='automation_jobs'")
      .get()
  )
    database.sqlite.exec(
      await readFile(
        new URL('../drizzle/0006_automation.sql', import.meta.url),
        'utf8',
      ),
    );
  const store = new CatalogStore(database);
  const media = new MediaService(store, paths);
  const library = store.createLibrary({ name: 'Automation' });
  const root = store.addRoot(library.id, join(dir, 'originals'));
  await mkdir(root.path, { recursive: true });
  let color = 10;
  return {
    dir,
    paths,
    database,
    store,
    media,
    library,
    root,
    async add(name = 'red house.png') {
      const path = join(root.path, name);
      await writeFile(
        path,
        await sharp({
          create: {
            width: 16,
            height: 12,
            channels: 3,
            background: { r: color++, g: 40, b: 70 },
          },
        })
          .png()
          .toBuffer(),
      );
      const processed = await processFile({
        filePath: path,
        dataDir: paths.data,
        cacheDir: paths.cache,
      });
      return store.ingest({
        libraryId: library.id,
        rootId: root.id,
        relativePath: name,
        actualRelativePath: name,
        processed,
      }).asset;
    },
    async close() {
      await media.close();
      database.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
