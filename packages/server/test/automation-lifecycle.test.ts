import { chmod, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationService } from '../src/automation/service.js';
import { HTTPVisionProvider } from '../src/automation/provider.js';
import { readAutomationExport } from '../src/automation/export.js';
import { automationFixture } from './automation-fixture.js';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.reverse()) await close();
  cleanup.length = 0;
});
async function endpoint() {
  let requests = 0;
  let firstSent: () => void = () => {};
  const first = new Promise<void>((r) => {
    firstSent = r;
  });
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      void _;
    }
    requests++;
    if (requests === 1) {
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content:
                  '{"tags":["red"],"name":"house","caption":"Red house"}',
              },
            },
          ],
        }),
      );
      firstSent();
    } else if (requests === 2) {
      res.end(
        JSON.stringify({
          choices: [
            { finish_reason: 'stop', message: { content: 'malformed output' } },
          ],
        }),
      );
    } else {
      /* held until cancelled; no timers or synthetic inference claim */
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw Error('address');
  cleanup.push(
    () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  );
  return {
    url: `http://127.0.0.1:${addr.port}`,
    first,
    requests: () => requests,
  };
}
async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('timeout');
}
describe('bounded persisted automation job lifecycle', () => {
  it('retains mixed genuine protocol successes/errors, cancels requests and excludes active portable records', async () => {
    const ep = await endpoint();
    const f = await automationFixture();
    cleanup.push(() => f.close());
    const service = new AutomationService({
      ...f,
      schedule: false,
      providers: [
        new HTTPVisionProvider({
          url: ep.url,
          model: 'protocol-fixture',
          mode: 'json',
        }),
      ],
    });
    cleanup.push(() => service.close());
    const a = await f.add('a.png'),
      b = await f.add('b.png');
    const j = service.analyze(f.library.id, {
      providerId: 'http-vision',
      assetIds: [a.id, b.id],
    });
    await waitFor(() => service.job(f.library.id, j.id).processed === 2);
    await waitFor(() => service.job(f.library.id, j.id).status === 'completed');
    expect(
      service.job(f.library.id, j.id).results.map((r) => r.errorCode),
    ).toEqual([null, 'PROVIDER_INVALID_OUTPUT']);
    expect(service.proposals(f.library.id, {}).total).toBe(1);
    const held = service.analyze(f.library.id, {
      providerId: 'http-vision',
      assetIds: [a.id],
    });
    const second = service.analyze(f.library.id, {
      providerId: 'http-vision',
      assetIds: [b.id],
    });
    expect(() =>
      service.analyze(f.library.id, {
        providerId: 'http-vision',
        assetIds: [a.id],
      }),
    ).toThrow('AUTOMATION_BUSY');
    expect(
      readAutomationExport(f.database, f.library.id).jobs.map((job) => job.id),
    ).toEqual([j.id]);
    await waitFor(() => ep.requests() >= 3);
    service.cancel(f.library.id, held.id);
    await service.close();
    expect(service.job(f.library.id, held.id).status).toBe('cancelled');
    expect(service.job(f.library.id, second.id).status).toBe('cancelled');
    expect(service.proposals(f.library.id, {}).total).toBe(1);
    expect(() => service.analyze(f.library.id, { assetIds: [a.id] })).toThrow(
      'AUTOMATION_CLOSED',
    );
  });
  it('does not send a corrupted retained raster to a configured model', async () => {
    const ep = await endpoint();
    const f = await automationFixture();
    cleanup.push(() => f.close());
    const service = new AutomationService({
      ...f,
      schedule: false,
      providers: [
        new HTTPVisionProvider({
          url: ep.url,
          model: 'protocol-fixture',
          mode: 'json',
        }),
      ],
    });
    cleanup.push(() => service.close());
    const a = await f.add('original.png'),
      b = await f.add('different.png');
    await chmod(f.store.getVersionFile(a.currentVersionId).snapshotPath, 0o600);
    await writeFile(
      f.store.getVersionFile(a.currentVersionId).snapshotPath,
      await readFile(f.store.getVersionFile(b.currentVersionId).snapshotPath),
    );
    const job = service.analyze(f.library.id, {
      providerId: 'http-vision',
      assetIds: [a.id],
    });
    await waitFor(
      () =>
        !['queued', 'running'].includes(
          service.job(f.library.id, job.id).status,
        ),
    );
    expect(service.job(f.library.id, job.id).results[0]?.errorCode).toBe(
      'SOURCE_CHANGED',
    );
    expect(ep.requests()).toBe(0);
  });
  it('marks persisted in-flight work interrupted after restart, preserving completed partial records', async () => {
    const f = await automationFixture();
    cleanup.push(() => f.close());
    const service = new AutomationService({ ...f, schedule: false });
    const a = await f.add();
    const job = service.analyze(f.library.id, { assetIds: [a.id] });
    await waitFor(
      () => service.job(f.library.id, job.id).status === 'completed',
    );
    await service.close();
    const old = service.job(f.library.id, job.id);
    service.repo.put('automation_jobs', { ...old, status: 'running' });
    const restarted = new AutomationService({ ...f, schedule: false });
    cleanup.push(() => restarted.close());
    expect(restarted.job(f.library.id, job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'INTERRUPTED',
      processed: 1,
    });
    expect(restarted.proposals(f.library.id, {}).total).toBe(1);
  });
});
