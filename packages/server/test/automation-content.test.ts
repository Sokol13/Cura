import { afterEach, describe, expect, it } from 'vitest';
import { AutomationService } from '../src/automation/service.js';
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
describe('script and setting document persistence', () => {
  it('preserves full catalog tag names in saved documents and JSON exports', async () => {
    const f = await fixture();
    const asset = await f.add();
    const name = 'é'.repeat(255);
    const tag = f.store.createTag(f.library.id, { name });
    f.store.updateAsset(asset.id, { tagIds: [tag.id] });
    const doc = f.service.content.createDocument(f.library.id, {
      title: 'Tagged setting',
      pins: [{ assetId: asset.id, versionId: asset.currentVersionId }],
    });
    f.store.updateTag(tag.id, { name: 'Later label' });
    expect(
      f.service.content.document(f.library.id, doc.id).sources[0]?.tags,
    ).toEqual([name]);
    expect(doc.markdown).toContain(name);
    expect(
      JSON.parse(
        f.service.content.exportDocument(f.library.id, doc.id, 'json').body,
      ),
    ).toMatchObject({
      sources: [{ tags: [name] }],
    });
  });
  it('retains imported bytes, derives exact editable references and rejects stale edits', async () => {
    const f = await fixture();
    const bytes = Buffer.from(
      'INT. HOUSE - DAY\r\n\r\nALICE\r\nHello.\r\nPROP: key',
    );
    const script = await f.service.content.importScript(
      f.library.id,
      'scene.fountain',
      bytes,
    );
    expect(
      script.entities.find((e) => e.name === 'ALICE')?.references[0]?.excerpt,
    ).toBe('ALICE');
    const entity = script.entities[0]!;
    const edit = {
      expectedRevision: 0,
      entities: [
        {
          id: entity.id,
          kind: entity.kind,
          name: 'House revised',
          notes: 'set notes',
          ranges: [{ startLine: 1, endLine: 1 }],
        },
      ],
    };
    const revised = await f.service.content.updateScript(
      f.library.id,
      script.id,
      edit,
    );
    expect(revised.revision).toBe(1);
    expect(revised.entities[0]?.id).toBe(entity.id);
    await expect(
      f.service.content.updateScript(f.library.id, script.id, edit),
    ).rejects.toMatchObject({ code: 'REVISION_CHANGED' });
    const { readFile } = await import('node:fs/promises');
    expect(
      await readFile(
        f.store.getVersionFile(script.sourcePin.versionId).snapshotPath,
      ),
    ).toEqual(bytes);
  });
  it('pins document source metadata across replacement and preserves manual markdown revisions', async () => {
    const f = await fixture();
    const a = await f.add();
    f.store.updateAsset(a.id, {
      note: 'Original note',
      prompt: 'Original prompt',
      seed: '18446744073709551615',
    });
    const doc = f.service.content.createDocument(f.library.id, {
      title: 'House setting',
      kind: 'scene',
      language: 'en',
      pins: [{ assetId: a.id, versionId: a.currentVersionId }],
    });
    f.store.updateAsset(a.id, { note: 'Later note', prompt: 'Later prompt' });
    expect(doc.markdown).toContain('Original prompt');
    expect(doc.markdown).toContain('Not provided');
    expect(doc.sources[0]?.seed).toBe('18446744073709551615');
    expect(
      f.service.content.document(f.library.id, doc.id).sources[0]?.note,
    ).toBe('Original note');
    const revised = f.service.content.updateDocument(f.library.id, doc.id, {
      expectedRevision: 0,
      markdown: '# My approved setting',
    });
    expect(revised.revision).toBe(1);
    expect(() =>
      f.service.content.updateDocument(f.library.id, doc.id, {
        expectedRevision: 0,
        markdown: 'overwrite',
      }),
    ).toThrow('REVISION_CHANGED');
    expect(
      f.service.content.exportDocument(f.library.id, doc.id, 'markdown').body,
    ).toBe('# My approved setting');
    expect(
      JSON.parse(
        f.service.content.exportDocument(f.library.id, doc.id, 'json').body,
      ),
    ).toMatchObject({
      revision: 1,
      sources: [{ versionId: a.currentVersionId, note: 'Original note' }],
    });
  });
});
