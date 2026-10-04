import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fixture validation runs in the dedicated Playwright config before this helper.
const fixture = JSON.parse(
  await readFile(process.env.CURA_SYNC_E2E_FIXTURE, 'utf8'),
);
const directory = await mkdtemp(join(tmpdir(), 'cura-sync-ui-'));
const child = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL('../../packages/server/dist/index.js', import.meta.url),
    ),
  ],
  {
    env: {
      ...process.env,
      PORT: process.argv[2],
      CURA_OPEN_BROWSER: '0',
      CURA_DATA_DIR: join(directory, 'data'),
      CURA_CACHE_DIR: join(directory, 'cache'),
      CURA_LOG_DIR: join(directory, 'log'),
      CURA_SUPABASE_URL: fixture.url,
      CURA_SUPABASE_ANON_KEY: fixture.anonKey,
    },
    stdio: 'inherit',
  },
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal));
child.on('error', async () => {
  console.error('Unable to start the isolated Cura sync server.');
  await rm(directory, { recursive: true, force: true });
  process.exitCode = 1;
});
child.on('exit', async (code, signal) => {
  await rm(directory, { recursive: true, force: true });
  process.exitCode =
    code ?? (signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1);
});
