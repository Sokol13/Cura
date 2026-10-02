import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import envPaths from 'env-paths';

export interface UserPaths {
  data: string;
  cache: string;
  log: string;
}

export function resolveUserPaths(
  environment: NodeJS.ProcessEnv = process.env,
): UserPaths {
  const defaults = envPaths('Cura', { suffix: '' });
  return {
    data: resolve(environment.CURA_DATA_DIR || defaults.data),
    cache: resolve(environment.CURA_CACHE_DIR || defaults.cache),
    log: resolve(environment.CURA_LOG_DIR || defaults.log),
  };
}

export function ensureUserDirectories(paths: UserPaths): void {
  for (const directory of Object.values(paths)) {
    mkdirSync(directory, { recursive: true });
  }
}
