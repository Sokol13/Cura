import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationService } from '../src/automation/service.js';
import { setFinalSelection } from '../src/process/final-selections.js';
import { automationFixture } from './automation-fixture.js';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.reverse()) await close();
  cleanup.length = 0;
});
async function fixture(count: number) {
  const f = await automationFixture();
  cleanup.push(() => f.close());
  const service = new AutomationService({ ...f, schedule: false });
  cleanup.push(() => service.close());
  const first = await f.add();
  const db = f.database.sqlite;
  type Row = Record<string, string | number | null>;
  const ar = db.prepare('SELECT * FROM assets WHERE id=?').get(first.id) as Row;
  const vr = db
    .prepare('SELECT * FROM asset_versions WHERE id=?')
    .get(first.currentVersionId) as Row;
  const insert = (table: string, row: Row) => {
    const columns = Object.keys(row);
    return {
      columns,
      statement: db.prepare(
        `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
      ),
    };
  };
  const ai = insert('assets', ar),
    vi = insert('asset_versions', vr);
  const pins = [{ assetId: first.id, versionId: first.currentVersionId }];
  db.transaction(() => {
    for (let i = 1; i < count; i++) {
      const assetId = randomUUID(),
        versionId = randomUUID();
      const a = {
        ...ar,
        id: assetId,
        relative_path: `${i}.png`,
        payload: JSON.stringify({
          ...(JSON.parse(String(ar.payload)) as Record<string, unknown>),
          id: assetId,
          currentVersionId: versionId,
          name: `${i}.png`,
          relativePath: `${i}.png`,
        }),
      };
      const v = {
        ...vr,
        id: versionId,
        asset_id: assetId,
        payload: JSON.stringify({
          ...(JSON.parse(String(vr.payload)) as Record<string, unknown>),
          id: versionId,
          assetId,
          name: `${i}.png`,
        }),
      };
      ai.statement.run(...ai.columns.map((c) => a[c as keyof typeof a]));
      vi.statement.run(...vi.columns.map((c) => v[c as keyof typeof v]));
      pins.push({ assetId, versionId });
    }
  })();
  const rule = service.createRule(f.library.id, {
    name: 'Unused',
    filters: { olderThanDays: 0 },
  });
  return { ...f, service, rule, pins };
}
async function finished(
  service: AutomationService,
  libraryId: string,
  id: string,
) {
  for (let i = 0; i < 3000; i++) {
    const job = service.job(libraryId, id);
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error('archive timeout');
}
describe('archive work yields to the local API', () => {
  it('keeps a 1000-asset preview and queued response responsive and yields throughout archive writes', async () => {
    const f = await fixture(1000); // All schema-valid fixture creation is outside the measured window.
    let previous = performance.now(),
      maxGap = 0;
    const heartbeat = setInterval(() => {
      const current = performance.now();
      maxGap = Math.max(maxGap, current - previous);
      previous = current;
    }, 5);
    let queuedMs = 0,
      previewMs = 0;
    try {
      await new Promise((r) => setTimeout(r, 15));
      let start = performance.now();
      const preview = f.service.previewRule(f.library.id, f.rule.id, {
        expectedRevision: 0,
      });
      previewMs = performance.now() - start;
      expect(preview.eligibleTotal).toBe(1000);
      start = performance.now();
      const job = f.service.runRule(f.library.id, f.rule.id, {
        expectedRevision: 0,
      });
      queuedMs = performance.now() - start;
      const completed = await finished(f.service, f.library.id, job.id);
      await new Promise((r) => setTimeout(r, 10));
      expect(completed).toMatchObject({
        status: 'completed',
        total: 1000,
        processed: 1000,
      });
      expect(completed.results.filter((r) => r.proposalId)).toHaveLength(1000);
    } finally {
      clearInterval(heartbeat);
    }
    expect(previewMs).toBeLessThan(200);
    expect(queuedMs).toBeLessThan(200);
    expect(maxGap).toBeLessThan(250);
  }, 20000);
  it('allows cancellation after a committed chunk while preserving partial history and untouched remaining assets', async () => {
    const f = await fixture(1000);
    const job = f.service.runRule(f.library.id, f.rule.id, {
      expectedRevision: 0,
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        const current = f.service.job(f.library.id, job.id);
        if (current.processed > 0) {
          clearInterval(timer);
          f.service.cancel(f.library.id, job.id);
          resolve();
        } else if (current.status === 'failed') {
          clearInterval(timer);
          reject(Error(current.errorCode ?? 'failed'));
        }
      }, 1);
    });
    const cancelled = await finished(f.service, f.library.id, job.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.processed).toBeGreaterThan(0);
    expect(cancelled.processed).toBeLessThan(1000);
    expect(cancelled.results).toHaveLength(cancelled.processed);
    const archived = f.database.sqlite
      .prepare(
        "SELECT count(*) AS count FROM assets WHERE library_id=? AND json_extract(payload,'$.archivedAt') IS NOT NULL",
      )
      .get(f.library.id) as { count: number };
    expect(archived.count).toBe(cancelled.processed);
    expect(f.service.proposals(f.library.id, { jobId: job.id }).total).toBe(
      cancelled.processed,
    );
  }, 20000);
  it('rechecks a later chunk final owner and stops on a changed rule revision without losing prior changes', async () => {
    const f = await fixture(100);
    const ordered = [...f.pins].sort((a, b) =>
      a.assetId.localeCompare(b.assetId),
    );
    const last = ordered.at(-1)!;
    const replacedPin = ordered.at(-2)!;
    const replacement = await f.add('replacement.png');
    const replacementFile = f.store.getVersionFile(
      replacement.currentVersionId,
    );
    const job = f.service.runRule(f.library.id, f.rule.id, {
      expectedRevision: 0,
    });
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const current = f.service.job(f.library.id, job.id);
        if (current.processed > 0) {
          clearInterval(timer);
          setFinalSelection(
            f.database,
            {
              libraryId: f.library.id,
              ownerKind: 'manual',
              ownerId: last.assetId,
            },
            last,
          );
          f.store.replaceAsset(
            replacedPin.assetId,
            {
              ...replacement,
              generation: {
                prompt: replacement.prompt,
                negativePrompt: replacement.negativePrompt,
                source: replacement.source,
                model: replacement.model,
                seed: replacement.seed,
                params: replacement.params,
              },
              snapshotPath: replacementFile.snapshotPath,
              thumbnailPath: replacementFile.thumbnailPath,
            },
            replacement.name,
          );
          resolve();
        }
      }, 1);
    });
    const completed = await finished(f.service, f.library.id, job.id);
    expect(
      completed.results.find((r) => r.assetId === last.assetId)?.errorCode,
    ).toBe('FINAL_SELECTION');
    expect(f.store.getAsset(last.assetId).archivedAt).toBeNull();
    expect(
      completed.results.find((r) => r.assetId === replacedPin.assetId)
        ?.errorCode,
    ).toBe('VERSION_CHANGED');
    expect(f.store.getAsset(replacedPin.assetId).archivedAt).toBeNull();
    // Use a fresh fixture so the next run has enough eligible records for a second chunk.
    const g = await fixture(100);
    const second = g.service.runRule(g.library.id, g.rule.id, {
      expectedRevision: 0,
    });
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (g.service.job(g.library.id, second.id).processed > 0) {
          clearInterval(timer);
          g.service.updateRule(g.library.id, g.rule.id, {
            expectedRevision: 0,
            name: 'Changed while running',
          });
          resolve();
        }
      }, 1);
    });
    const stopped = await finished(g.service, g.library.id, second.id);
    expect(stopped).toMatchObject({
      status: 'failed',
      errorCode: 'REVISION_CHANGED',
    });
    expect(stopped.processed).toBeGreaterThan(0);
    expect(stopped.processed).toBeLessThan(100);
    expect(stopped.results).toHaveLength(stopped.processed);
  }, 20000);
});
