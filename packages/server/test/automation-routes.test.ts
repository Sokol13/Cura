import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerCatalogRoutes } from '../src/catalog-routes.js';
import { registerAutomationRoutes } from '../src/automation/routes.js';
import { automationFixture } from './automation-fixture.js';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.reverse()) await close();
  cleanup.length = 0;
});
describe('library-bound automation HTTP contract', () => {
  it('imports and edits real retained source, exports documents and rejects cross-library IDs', async () => {
    const f = await automationFixture();
    const app = Fastify();
    cleanup.push(() => f.close());
    await registerCatalogRoutes(app, f.store, f.media, f.paths);
    const service = registerAutomationRoutes(app, { ...f, schedule: false });
    cleanup.push(
      () => service.close(),
      () => app.close(),
    );
    const base = `/api/libraries/${f.library.id}/automation`;
    expect((await app.inject({ url: `${base}/providers` })).json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'metadata-rules',
          configured: true,
          kind: 'metadata-rules',
        }),
      ]),
    );
    const imported = await app.inject({
      method: 'POST',
      url: `${base}/scripts?name=scene.fountain`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('INT. ROOM\n\nALICE\nHello'),
    });
    expect(imported.statusCode).toBe(201);
    const script = imported.json();
    expect((await app.inject({ url: `${base}/scripts` })).json()).toMatchObject(
      { total: 1, items: [{ id: script.id }] },
    );
    const other = f.store.createLibrary({ name: 'Other' });
    expect(
      (
        await app.inject({
          url: `/api/libraries/${other.id}/automation/scripts/${script.id}`,
        })
      ).statusCode,
    ).toBe(404);
    const a = await f.add();
    const created = await app.inject({
      method: 'POST',
      url: `${base}/documents`,
      payload: {
        title: 'Setting',
        pins: [{ assetId: a.id, versionId: a.currentVersionId }],
      },
    });
    expect(created.statusCode).toBe(201);
    const doc = created.json();
    const exported = await app.inject({
      url: `${base}/documents/${doc.id}/export?format=json`,
    });
    expect(exported.headers['content-disposition']).toContain('.json');
    expect(exported.json().sources[0].versionId).toBe(a.currentVersionId);
    const tooLarge = await app.inject({
      method: 'POST',
      url: `${base}/scripts?name=huge.txt`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(524289),
    });
    expect(tooLarge.statusCode).toBe(413);
  });
});
