import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cura-static-files-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'web');
  await mkdir(join(root, 'assets', 'nested'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<title>Cura</title>');
  const app = await createApp({ staticRoot: root });
  cleanups.push(() => app.close());
  return { directory, root, app };
}

it('does not expose files outside the web root through traversal or symlinks', async () => {
  const { directory, root, app } = await fixture();
  await writeFile(join(directory, 'secret.txt'), 'private outside content');
  await symlink(join(directory, 'secret.txt'), join(root, 'leak.txt'));
  await symlink(directory, join(root, 'linked'));
  for (const url of [
    '/leak.txt',
    '/linked/secret.txt',
    '/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/..%5csecret.txt',
  ]) {
    const response = await app.inject(url);
    expect(response.statusCode, url).toBe(404);
    expect(response.body, url).not.toContain('private outside content');
  }
});

it('serves correct MIME types and GET/HEAD cache headers for nested build resources', async () => {
  const { root, app } = await fixture();
  const files = [
    ['app-AbCd1234.js', 'javascript'],
    ['app-AbCd1234.css', 'text/css'],
    ['decoder-AbCd1234.wasm', 'application/wasm'],
    ['font-AbCd1234.woff2', 'font/woff2'],
    ['font-AbCd1234.woff', 'font/woff'],
    ['font-AbCd1234.ttf', 'font/ttf'],
    ['config.json', 'application/json'],
    ['picture.png', 'image/png'],
    ['picture.jpg', 'image/jpeg'],
    ['picture.webp', 'image/webp'],
    ['picture.gif', 'image/gif'],
    ['picture.avif', 'image/avif'],
    ['picture.svg', 'image/svg+xml'],
    ['unknown.bin', 'application/octet-stream'],
  ] as const;
  for (const [name, type] of files) {
    await writeFile(join(root, 'assets', 'nested', name), 'test bytes');
    const url = `/assets/nested/${name}?v=1`;
    const get = await app.inject(url);
    const head = await app.inject({ method: 'HEAD', url });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toContain(type);
    expect(get.body).toBe('test bytes');
    expect(get.headers['x-content-type-options']).toBe('nosniff');
    expect(get.headers['cache-control']).toBe(
      name.includes('-AbCd1234.')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    );
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-type']).toBe(get.headers['content-type']);
    expect(head.headers['content-length']).toBe(
      String(Buffer.byteLength(get.body)),
    );
    expect(head.headers['cache-control']).toBe(get.headers['cache-control']);
    expect(head.body).toBe('');
  }
  for (const url of ['/', '/index.html']) {
    const response = await app.inject(url);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.headers['content-type']).toContain('text/html');
  }
  for (const url of ['/missing.js', '/assets/nested']) {
    const response = await app.inject({ method: 'HEAD', url });
    expect(response.statusCode).toBe(404);
    expect(response.body).toBe('');
  }
  expect(
    (await app.inject({ method: 'HEAD', url: '/api/missing' })).statusCode,
  ).toBe(404);
  expect((await app.inject({ method: 'POST', url: '/' })).statusCode).toBe(404);
});
