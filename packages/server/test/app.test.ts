import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HealthResponseSchema } from '@cura/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, DEFAULT_WEB_ROOT } from '../src/app.js';

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

describe('HTTP application', () => {
  it.each([
    { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', expected: 200 },
    { host: 'localhost:3000', origin: 'http://localhost:3000', expected: 200 },
    { host: '127.0.0.1:3000', origin: 'http://localhost:5173', expected: 200 },
    { host: '127.0.0.1:3000', origin: 'http://evil.example', expected: 403 },
    { host: '127.0.0.1:3000', origin: 'http://localhost:9999', expected: 403 },
    { host: '127.0.0.1:3000', origin: 'null', expected: 403 },
    { host: 'evil.example', origin: 'http://evil.example', expected: 403 },
    {
      host: '127.0.0.1.evil.example:3000',
      origin: 'http://localhost:3000',
      expected: 403,
    },
    {
      host: 'localhost:3000',
      origin: 'http://localhost:3000/path',
      expected: 403,
    },
    {
      host: 'localhost:3000',
      origin: 'http://user:pass@localhost:3000',
      expected: 403,
    },
  ])(
    'checks Host and Origin: $host / $origin',
    async ({ host, origin, expected }) => {
      const app = await createApp({ staticRoot: false });
      cleanups.push(() => app.close());
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { host, origin },
      });
      expect(response.statusCode).toBe(expected);
    },
  );

  it('returns the shared health contract', async () => {
    const app = await createApp({ staticRoot: false });
    cleanups.push(() => app.close());

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(response.json())).toEqual({
      status: 'ok',
    });
    expect(response.headers['content-type']).toMatch(/application\/json/);
  });

  it('serves a built site and assets while preserving API and asset 404s', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cura-static-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'assets'));
    await mkdir(join(root, 'api'));
    await writeFile(
      join(root, 'index.html'),
      '<!doctype html><title>Cura</title>',
    );
    await writeFile(join(root, 'assets', 'app.js'), 'window.cura = true;');
    await writeFile(join(root, 'api', 'missing'), 'not an API response');
    const app = await createApp({ staticRoot: root });
    cleanups.push(() => app.close());

    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('<title>Cura</title>');
    expect(home.headers['content-type']).toMatch(/text\/html/);
    const asset = await app.inject('/assets/app.js');
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toBe('window.cura = true;');
    const missingApi = await app.inject('/api/missing');
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.headers['content-type']).toMatch(/application\/json/);
    expect((await app.inject('/assets/missing.js')).statusCode).toBe(404);
  });

  it('resolves production web assets relative to the server module', () => {
    expect(DEFAULT_WEB_ROOT).toBe(
      fileURLToPath(new URL('../../web/dist/', import.meta.url)),
    );
  });
});
