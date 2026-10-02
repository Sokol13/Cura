import { parseArgs } from 'node:util';
import { resolveUserPaths } from './paths.js';

export function readRuntimeConfig(
  args: string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
) {
  const { values } = parseArgs({
    args,
    options: { port: { type: 'string' }, 'data-dir': { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });
  const portValue = values.port ?? environment.PORT ?? '3000';
  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port > 65535) {
    throw new Error('The port must be an integer between 0 and 65535.');
  }
  if (values['data-dir'] !== undefined && !values['data-dir'].trim()) {
    throw new Error('--data-dir must name a directory.');
  }
  return {
    port,
    paths: resolveUserPaths({
      ...environment,
      CURA_DATA_DIR: values['data-dir'] ?? environment.CURA_DATA_DIR,
    }),
  };
}
