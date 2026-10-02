import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'cura-e2e-'));
const child = spawn(
  process.execPath,
  [fileURLToPath(new URL('../packages/server/dist/index.js', import.meta.url))],
  {
    env: {
      ...process.env,
      PORT: '4318',
      CURA_OPEN_BROWSER: '0',
      CURA_DATA_DIR: join(directory, 'data'),
      CURA_CACHE_DIR: join(directory, 'cache'),
      CURA_LOG_DIR: join(directory, 'log'),
    },
    stdio: 'inherit',
  },
);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', async (error) => {
  console.error(error);
  await rm(directory, { recursive: true, force: true });
  process.exitCode = 1;
});
child.on('exit', async (code, signal) => {
  await rm(directory, { recursive: true, force: true });
  process.exitCode =
    code ?? (signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1);
});
