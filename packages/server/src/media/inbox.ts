import { join, relative } from 'node:path';
import { realpath } from 'node:fs/promises';
import type { LibraryRoot } from '@cura/shared';
import type { CatalogStore } from '../catalog-store.js';
import type { UserPaths } from '../paths.js';
import type {
  InboxFileIdentity,
  InboxMigration,
} from './inbox-migration-store.js';

type Job = <T>(payload: Record<string, unknown>) => Promise<T>;
/** Coordinates local-only relocation before the Inbox watcher is attached. */
export class InboxPreparation {
  private readonly prepared = new Set<string>();
  constructor(
    private readonly store: CatalogStore,
    private readonly paths: UserPaths,
    private readonly job: Job,
    private readonly active: (rootId: string) => boolean,
    private readonly warn: (root: LibraryRoot, error: unknown) => void,
  ) {}
  ignored(rootId: string): string[] {
    return this.store.inboxMigrations
      .pending(rootId)
      .map((row) =>
        row.state === 'relocated' ? row.oldRelativePath : row.newRelativePath,
      );
  }
  reserved(rootId: string, excludingId?: string): string[] {
    return [
      ...this.store.listSourcePaths(rootId),
      ...this.store.inboxMigrations
        .pending(rootId)
        .filter((row) => row.id !== excludingId)
        .map((row) => row.newRelativePath),
    ];
  }
  async prepare(root: LibraryRoot): Promise<void> {
    if (root.kind !== 'inbox' || this.prepared.has(root.id)) return;
    const expected = join(
      await realpath(this.paths.data),
      'libraries',
      root.libraryId,
      'Inbox',
    );
    // Cloud roots also have kind=inbox. Only the actual local upload directory qualifies.
    if (relative(expected, root.path)) return;
    const rows = this.store.inboxMigrations.pending(root.id);
    const pending = new Set(rows.map((row) => row.sourceId));
    for (const row of rows) await this.migrate(root, row);
    for (const source of this.store.inboxMigrations.sources(root.id)) {
      if (!this.active(root.id)) return;
      if (pending.has(source.id)) continue;
      try {
        const observed = await this.job<InboxFileIdentity>({
          kind: 'process',
          inboxOperation: 'inspect',
          root: root.path,
          relativePath: source.actualRelativePath,
        });
        const destination = await this.job<string>({
          kind: 'process',
          inboxOperation: 'choose',
          root: root.path,
          name: source.actualRelativePath.split(/[\\/]/).at(-1),
          date: source.createdAt,
          reservedRelativePaths: this.reserved(root.id),
        });
        if (!this.active(root.id)) return;
        await this.migrate(
          root,
          this.store.inboxMigrations.plan(source.id, destination, observed),
        );
      } catch (error) {
        this.warn(root, error);
      }
    }
    if (this.active(root.id)) this.prepared.add(root.id);
  }
  private async migrate(root: LibraryRoot, row: InboxMigration): Promise<void> {
    if (!this.active(root.id)) return;
    try {
      if (row.state !== 'relocated') {
        // The file may have changed while Cura was offline. Move the real bytes;
        // leave last_hash unchanged so the following scan records that change.
        try {
          const observed = await this.job<InboxFileIdentity>({
            kind: 'process',
            inboxOperation: 'inspect',
            root: root.path,
            relativePath: row.oldActualRelativePath,
          });
          if (!this.active(root.id)) return;
          row = this.store.inboxMigrations.reobserve(row.id, observed);
        } catch (error) {
          if (
            !['ENOENT', 'MISSING_SOURCE'].includes(
              (error as NodeJS.ErrnoException).code ?? '',
            )
          )
            throw error;
          // A published destination can outlive the original path after interruption.
        }
        const collisions: string[] = [];
        for (let attempt = 0; attempt < 32; attempt++) {
          try {
            const published = await this.job<{
              state: 'reserved' | 'published';
              target: InboxFileIdentity;
            }>({
              kind: 'process',
              inboxOperation: 'publish',
              root: root.path,
              migration: row,
            });
            row = this.store.inboxMigrations.update(row.id, published);
            if (published.state === 'published') break;
          } catch (error) {
            if (
              (error as NodeJS.ErrnoException).code !== 'COLLISION' ||
              row.state !== 'planned'
            )
              throw error;
            collisions.push(row.newRelativePath);
            const destination = await this.job<string>({
              kind: 'process',
              inboxOperation: 'choose',
              root: root.path,
              name: row.oldActualRelativePath.split(/[\\/]/).at(-1),
              date: row.sourceCreatedAt,
              reservedRelativePaths: [
                ...this.reserved(root.id, row.id),
                ...collisions,
              ],
            });
            row = this.store.inboxMigrations.retarget(row.id, destination);
          }
          if (!this.active(root.id)) return;
        }
        if (!this.active(root.id)) return;
        if (row.state !== 'published')
          throw new Error('Inbox destination remained busy.');
        row = this.store.inboxMigrations.relocate(row.id);
      }
      await this.job<void>({
        kind: 'process',
        inboxOperation: 'cleanup',
        root: root.path,
        migration: row,
      });
      this.store.inboxMigrations.complete(row.id);
    } catch (error) {
      if (
        row.state === 'relocated' &&
        (error as NodeJS.ErrnoException).code === 'SOURCE_CHANGED'
      ) {
        try {
          this.store.inboxMigrations.rollback(row.id);
        } catch {
          /* Preserve the durable record for restart. */
        }
      }
      this.warn(root, error);
    }
  }
}
