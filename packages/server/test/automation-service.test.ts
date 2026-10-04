import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationService } from '../src/automation/service.js';
import { readAutomationExport } from '../src/automation/export.js';
import { automationFixture } from './automation-fixture.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.reverse()) await close();
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
async function done(service: AutomationService, lib: string, id: string) {
  for (let i = 0; i < 100; i++) {
    const job = service.job(lib, id);
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('job unfinished');
}
describe('reviewable automation and exact-field history', () => {
  it('retains full catalog tag names through proposal apply, undo and portable history', async () => {
    const f = await fixture();
    const asset = await f.add();
    const name = 'é'.repeat(255);
    const tag = f.store.createTag(f.library.id, { name });
    f.store.updateAsset(asset.id, { tagIds: [tag.id] });
    const job = f.service.analyze(f.library.id, { assetIds: [asset.id] });
    expect((await done(f.service, f.library.id, job.id)).status).toBe(
      'completed',
    );
    const proposal = f.service.proposals(f.library.id, {}).items[0]!;
    const change = proposal.changes.find((item) => item.field === 'tagIds')!;
    expect(change.beforeTagLabels).toEqual([{ id: tag.id, name }]);
    const applied = f.service.apply(f.library.id, {
      items: [
        {
          proposalId: proposal.id,
          expectedVersionId: asset.currentVersionId,
          changes: [{ changeId: change.id, expectedValue: change.beforeValue }],
        },
      ],
    });
    expect(applied.conflicts).toEqual([]);
    const after = applied.proposals[0]!.changes.find(
      (item) => item.id === change.id,
    )!;
    expect(after.afterTagLabels).toContainEqual({ id: tag.id, name });
    expect(
      f.service.undo(f.library.id, {
        items: [
          {
            proposalId: proposal.id,
            expectedVersionId: asset.currentVersionId,
            changes: [{ changeId: change.id, expectedValue: after.afterValue }],
          },
        ],
      }).conflicts,
    ).toEqual([]);
    expect(f.store.getAsset(asset.id).tags).toEqual([tag]);
    expect(
      readAutomationExport(f.database, f.library.id).changes.find(
        (item) => item.id === change.id,
      ),
    ).toMatchObject({
      beforeTagLabels: [{ id: tag.id, name }],
      afterTagLabels: expect.arrayContaining([{ id: tag.id, name }]),
      status: 'undone',
    });
  });
  it('suggests without mutating, selectively applies and undoes while originals and unrelated edits survive', async () => {
    const f = await fixture();
    const a = await f.add();
    const original = await readFile(join(f.root.path, a.name));
    const job = f.service.analyze(f.library.id, {
      assetIds: [a.id],
      providerId: 'metadata-rules',
    });
    await done(f.service, f.library.id, job.id);
    const p = f.service.proposals(f.library.id, {}).items[0]!;
    const tags = p.changes.find((c) => c.field === 'tagIds')!;
    const name = p.changes.find((c) => c.field === 'displayName')!;
    expect(f.store.getAsset(a.id).tags).toEqual([]);
    const apply = f.service.apply(f.library.id, {
      items: [
        {
          proposalId: p.id,
          expectedVersionId: a.currentVersionId,
          changes: [{ changeId: tags.id, expectedValue: tags.beforeValue }],
        },
      ],
    });
    expect(apply.conflicts).toEqual([]);
    expect(f.store.getAsset(a.id).tags.map((t) => t.name)).toContain('house');
    expect(f.store.getAsset(a.id).displayName ?? null).toBe(null);
    f.store.updateAsset(a.id, { note: 'my later note' });
    const applied = apply.proposals[0]!.changes.find((c) => c.id === tags.id)!;
    expect(
      f.service.undo(f.library.id, {
        items: [
          {
            proposalId: p.id,
            expectedVersionId: a.currentVersionId,
            changes: [{ changeId: tags.id, expectedValue: applied.afterValue }],
          },
        ],
      }).conflicts,
    ).toEqual([]);
    expect(f.store.getAsset(a.id)).toMatchObject({
      note: 'my later note',
      tags: [],
    });
    expect(name.status).toBe('pending');
    expect(await readFile(join(f.root.path, a.name))).toEqual(original);
  });
  it('resolves display-name collisions transactionally without renaming historical files', async () => {
    const f = await fixture();
    const a = await f.add();
    const occupied = await f.add('other.png');
    f.store.updateAsset(occupied.id, { displayName: 'red-house.png' });
    const j = f.service.analyze(f.library.id, { assetIds: [a.id] });
    await done(f.service, f.library.id, j.id);
    const p = f.service.proposals(f.library.id, { jobId: j.id }).items[0]!;
    const c = p.changes.find((v) => v.field === 'displayName')!;
    const request = {
      items: [
        {
          proposalId: p.id,
          expectedVersionId: a.currentVersionId,
          changes: [{ changeId: c.id, expectedValue: c.beforeValue }],
        },
      ],
    };
    expect(f.service.apply(f.library.id, request).conflicts).toEqual([]);
    expect(f.store.getAsset(a.id).displayName).toBe('red-house (2).png');
    expect(f.service.apply(f.library.id, request).conflicts).toEqual([]);
    expect(f.store.listVersions(a.id).map((v) => v.name)).toEqual([
      'red house.png',
    ]);
  });
  it('reports stale version and field conflicts without overwriting manual values', async () => {
    const f = await fixture();
    const a = await f.add();
    const j = f.service.analyze(f.library.id, { assetIds: [a.id] });
    await done(f.service, f.library.id, j.id);
    const p = f.service.proposals(f.library.id, {}).items[0]!;
    const c = p.changes.find((v) => v.field === 'displayName')!;
    f.store.updateAsset(a.id, { displayName: 'My manual name' });
    expect(
      f.service.apply(f.library.id, {
        items: [
          {
            proposalId: p.id,
            expectedVersionId: a.currentVersionId,
            changes: [{ changeId: c.id, expectedValue: c.beforeValue }],
          },
        ],
      }).conflicts[0]?.code,
    ).toBe('FIELD_CHANGED');
    expect(f.store.getAsset(a.id).displayName).toBe('My manual name');
    const replacement = await f.add('replacement.png');
    f.store.replaceAsset(
      a.id,
      {
        ...replacement,
        generation: {
          prompt: '',
          negativePrompt: '',
          source: '',
          model: '',
          seed: '',
          params: {},
        },
        snapshotPath: f.store.getVersionFile(replacement.currentVersionId)
          .snapshotPath,
        thumbnailPath: null,
      },
      'new.png',
    );
    expect(
      f.service.apply(f.library.id, {
        items: [
          {
            proposalId: p.id,
            expectedVersionId: a.currentVersionId,
            changes: [{ changeId: c.id, expectedValue: 'My manual name' }],
          },
        ],
      }).conflicts[0]?.code,
    ).toBe('VERSION_CHANGED');
  });
  it('exports terminal closed history with exact pinned dependencies and no provider configuration', async () => {
    const f = await fixture();
    const a = await f.add();
    const j = f.service.analyze(f.library.id, { assetIds: [a.id] });
    await done(f.service, f.library.id, j.id);
    const exported = readAutomationExport(f.database, f.library.id);
    expect(exported.jobs).toHaveLength(1);
    expect(exported.proposals).toHaveLength(1);
    expect(exported.changes).toHaveLength(2);
    expect(exported.pins).toEqual([
      { assetId: a.id, versionId: a.currentVersionId },
    ]);
    expect(JSON.stringify(exported)).not.toContain(f.dir);
  });
});
