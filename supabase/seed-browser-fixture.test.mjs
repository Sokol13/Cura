import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { seedBrowserFixture } from './seed-browser-fixture.mjs';

async function fixture(run, handler) {
  const directory = await mkdtemp(join(tmpdir(), 'cura-fixture-seeder-'));
  const requests = [];
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const call = {
      method: request.method,
      path: request.url,
      headers: request.headers,
      body: text ? JSON.parse(text) : null,
    };
    requests.push(call);
    if (handler && handler(call, requests, response)) return;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ id: randomUUID() }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const options = {
    statusPath: join(directory, 'status.json'),
    outputPath: join(directory, 'fixture.json'),
  };
  const status = {
    API_URL: `http://127.0.0.1:${port}`,
    ANON_KEY: 'public-test-key',
    SERVICE_ROLE_KEY: 'private-admin-test-key',
  };
  await writeFile(options.statusPath, JSON.stringify(status), { mode: 0o600 });
  try {
    await run({ options, requests, status });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

test('creates four distinct confirmed users, excludes admin key and preserves an existing private fixture', async () => {
  await fixture(async ({ options, requests }) => {
    assert.deepEqual(await seedBrowserFixture(options), {
      created: 4,
      reused: false,
    });
    const bytes = await readFile(options.outputPath, 'utf8');
    const value = JSON.parse(bytes);
    assert.equal(requests.length, 4);
    assert.equal(
      new Set(Object.values(value.accounts).map((account) => account.email))
        .size,
      4,
    );
    for (const call of requests) {
      assert.equal(call.path, '/auth/v1/admin/users');
      assert.equal(call.headers.authorization, 'Bearer private-admin-test-key');
      assert.equal(call.body.email_confirm, true);
      assert.ok(call.body.password.length >= 40);
    }
    assert.equal(bytes.includes('private-admin-test-key'), false);
    if (process.platform !== 'win32')
      assert.equal((await stat(options.outputPath)).mode & 0o777, 0o600);
    assert.deepEqual(await seedBrowserFixture(options), {
      created: 0,
      reused: true,
    });
    assert.equal(await readFile(options.outputPath, 'utf8'), bytes);
    assert.equal(requests.length, 4);
  });
});

test('rejects non-loopback projects and repository output before any admin request', async () => {
  await fixture(async ({ options, requests, status }) => {
    await writeFile(
      options.statusPath,
      JSON.stringify({ ...status, API_URL: 'https://example.invalid' }),
    );
    await assert.rejects(seedBrowserFixture(options), /loopback/);
    await assert.rejects(
      seedBrowserFixture({
        ...options,
        outputPath: fileURLToPath(
          new URL('../private-fixture.json', import.meta.url),
        ),
      }),
      /outside the repository/,
    );
    assert.equal(requests.length, 0);
  });
});

test('rolls back already created accounts and removes a partial output on Auth failure', async () => {
  await fixture(
    async ({ options, requests }) => {
      await assert.rejects(seedBrowserFixture(options), /HTTP 503/);
      assert.equal(
        requests.filter((call) => call.method === 'DELETE').length,
        2,
      );
      await assert.rejects(stat(options.outputPath), { code: 'ENOENT' });
    },
    (call, requests, response) => {
      if (
        call.method === 'POST' &&
        requests.filter((item) => item.method === 'POST').length === 3
      ) {
        response
          .writeHead(503)
          .end('private upstream response must never be logged');
        return true;
      }
      return false;
    },
  );
});

test('refuses to overwrite malformed private output', async () => {
  await fixture(async ({ options, requests }) => {
    await writeFile(options.outputPath, '{"unrelated":true}', { mode: 0o600 });
    await assert.rejects(seedBrowserFixture(options), /was not changed/);
    assert.equal(
      await readFile(options.outputPath, 'utf8'),
      '{"unrelated":true}',
    );
    assert.equal(requests.length, 0);
  });
});
