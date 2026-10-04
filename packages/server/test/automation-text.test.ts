import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationService } from '../src/automation/service.js';
import { HTTPTextProvider } from '../src/automation/provider.js';
import { automationFixture } from './automation-fixture.js';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.reverse()) await close();
  cleanup.length = 0;
});
async function done(s: AutomationService, lib: string, id: string) {
  for (let i = 0; i < 200; i++) {
    const j = s.job(lib, id);
    if (!['queued', 'running'].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('timeout');
}
describe('configured text provider source validation', () => {
  it('uses a real HTTP protocol response, derives excerpts locally, and rejects invented line references', async () => {
    let line = 2;
    let sent = '';
    const server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      sent = Buffer.concat(chunks).toString();
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  entities: [
                    {
                      kind: 'prop',
                      name: 'lantern',
                      notes: 'explicit object',
                      ranges: [{ startLine: line, endLine: line }],
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('address');
    cleanup.push(
      () =>
        new Promise<void>((r) => {
          server.closeAllConnections();
          server.close(() => r());
        }),
    );
    const f = await automationFixture();
    cleanup.push(() => f.close());
    const service = new AutomationService({
      ...f,
      schedule: false,
      textProvider: new HTTPTextProvider({
        url: `http://127.0.0.1:${address.port}`,
        model: 'protocol-fixture-not-a-model',
        mode: 'json',
      }),
    });
    cleanup.push(() => service.close());
    const script = await service.content.importScript(
      f.library.id,
      'story.txt',
      Buffer.from('A girl entered the room.\r\nShe carried a lantern.'),
    );
    const job = service.content.analyzeScript(f.library.id, script.id, {
      providerId: 'http-text',
    });
    expect((await done(service, f.library.id, job.id)).status).toBe(
      'completed',
    );
    const updated = service.content.script(f.library.id, script.id);
    expect(updated.entities[0]?.references).toEqual([
      { startLine: 2, endLine: 2, excerpt: 'She carried a lantern.' },
    ]);
    expect(updated.provenance).toMatchObject({
      kind: 'http-text',
      mode: 'json',
      model: 'protocol-fixture-not-a-model',
    });
    expect(sent).toContain('2: She carried a lantern.');
    line = 9;
    const bad = service.content.analyzeScript(f.library.id, script.id, {
      providerId: 'http-text',
    });
    expect(await done(service, f.library.id, bad.id)).toMatchObject({
      status: 'failed',
      errorCode: 'SCRIPT_INVALID_RANGE',
    });
    expect(service.content.script(f.library.id, script.id)).toEqual(updated);
  });
});
