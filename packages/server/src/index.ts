import { join } from 'node:path';
import open from 'open';
import pino from 'pino';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { readRuntimeConfig } from './runtime.js';

async function start(): Promise<void> {
  const { port, paths } = readRuntimeConfig();
  const database = openDatabase(paths);
  const logDestination = pino.destination({
    dest: join(paths.log, 'cura.log'),
    sync: true,
  });
  const logger = pino(
    { level: 'info' },
    pino.multistream([{ stream: process.stdout }, { stream: logDestination }]),
  );

  const app = await createApp({
    loggerInstance: logger,
    database,
    paths,
    onClose: () => {
      database.close();
      logDestination.end();
    },
  });

  try {
    const address = await app.listen({ host: '127.0.0.1', port });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        void app.close().catch((error: unknown) => {
          console.error(error);
          process.exitCode = 1;
        });
      });
    }

    if (process.env.CURA_OPEN_BROWSER !== '0') {
      if (
        process.platform === 'linux' &&
        !process.env.DISPLAY &&
        !process.env.WAYLAND_DISPLAY
      ) {
        app.log.info(
          { address },
          'No desktop display; open this URL manually.',
        );
      } else {
        try {
          await open(address, { wait: false });
        } catch (error) {
          app.log.warn(
            { err: error, address },
            'Could not open the default browser.',
          );
        }
      }
    }
  } catch (error) {
    await app.close();
    throw error;
  }
}

void start().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
