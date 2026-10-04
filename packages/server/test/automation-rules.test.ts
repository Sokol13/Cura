import { join } from 'node:path';
import { processFile } from '../src/media/image.js';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationService } from '../src/automation/service.js';
import { setFinalSelection } from '../src/process/final-selections.js';
import { automationFixture } from './automation-fixture.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup.length = 0;
});
async function fixture() {
  const f = await automationFixture();
  const service = new AutomationService({ ...f, schedule: false });
  cleanup.push(
    () => f.close(),
    () => service.close(),
  );
  return { ...f, service };
}
async function done(s: AutomationService, lib: string, id: string) {
  for (let i = 0; i < 100; i++) {
    const j = s.job(lib, id);
    if (!['queued', 'running'].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('timeout');
}
describe('archive rules protect historical final owners', () => {
  it('previews exclusions, rechecks final protection at execution and retains reviewable archive undo', async () => {
    const f = await fixture(),
      a = await f.add('one.png'),
      b = await f.add('two.png');
    const rule = f.service.createRule(f.library.id, {
      name: 'Unused',
      filters: { olderThanDays: 0 },
    });
    const owner = {
      libraryId: f.library.id,
      ownerKind: 'manual' as const,
      ownerId: a.id,
    };
    setFinalSelection(f.database, owner, {
      assetId: a.id,
      versionId: a.currentVersionId,
    });
    const replacement = await processFile({
      filePath: join(f.root.path, 'two.png'),
      dataDir: f.paths.data,
      cacheDir: f.paths.cache,
    });
    f.store.replaceAsset(a.id, replacement, 'replacement.png');
    expect(f.store.getAsset(a.id).finalized).toBe(false); // Only its historical version is selected.
    const preview = f.service.previewRule(f.library.id, rule.id, {
      expectedRevision: 0,
    });
    expect(preview.eligible.map((p) => p.assetId)).toEqual([b.id]);
    expect(preview.protected.map((p) => p.assetId)).toEqual([a.id]);
    const job = f.service.runRule(f.library.id, rule.id, {
      expectedRevision: 0,
    });
    await done(f.service, f.library.id, job.id);
    expect(f.store.getAsset(a.id).archivedAt).toBeNull();
    expect(f.store.getAsset(b.id).archivedAt).toBeTruthy();
    const p = f.service.proposals(f.library.id, { jobId: job.id }).items[0]!,
      c = p.changes[0]!;
    expect(
      f.service.undo(f.library.id, {
        items: [
          {
            proposalId: p.id,
            expectedVersionId: b.currentVersionId,
            changes: [{ changeId: c.id, expectedValue: c.afterValue }],
          },
        ],
      }).conflicts,
    ).toEqual([]);
    expect(f.store.getAsset(b.id).archivedAt).toBeNull();
    const next = f.service.runRule(f.library.id, rule.id, {
      expectedRevision: 0,
    });
    setFinalSelection(
      f.database,
      { ...owner, ownerId: b.id },
      { assetId: b.id, versionId: b.currentVersionId },
    );
    const finished = await done(f.service, f.library.id, next.id);
    expect(finished.status).toBe('completed');
    expect(
      finished.results.every((r) => r.errorCode === 'FINAL_SELECTION'),
    ).toBe(true);
    expect(f.store.getAsset(b.id).archivedAt).toBeNull();
  });
  it('retains the exact rule rationale in completed history after rule edits and deletion', async () => {
    const f = await fixture();
    await f.add();
    const rule = f.service.createRule(f.library.id, {
      name: 'Original rule',
      filters: { olderThanDays: 0, maxRating: 2 },
    });
    const job = f.service.runRule(f.library.id, rule.id, {
      expectedRevision: 0,
    });
    await done(f.service, f.library.id, job.id);
    f.service.updateRule(f.library.id, rule.id, {
      expectedRevision: 0,
      name: 'Changed',
    });
    f.service.deleteRule(f.library.id, rule.id, { expectedRevision: 1 });
    expect(f.service.job(f.library.id, job.id).archiveRuleSnapshot).toEqual({
      name: 'Original rule',
      revision: 0,
      filters: rule.filters,
    });
  });
  it('uses revision CAS and does not reset enabled on a name-only patch', async () => {
    const f = await fixture();
    const rule = f.service.createRule(f.library.id, {
      name: 'Old',
      enabled: true,
      filters: { olderThanDays: 0 },
    });
    const changed = f.service.updateRule(f.library.id, rule.id, {
      expectedRevision: 0,
      name: 'New',
    });
    expect(changed.enabled).toBe(true);
    expect(() =>
      f.service.runRule(f.library.id, rule.id, { expectedRevision: 0 }),
    ).toThrow('REVISION_CHANGED');
  });
});
