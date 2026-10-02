import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(
  new URL('../packages/server/package.json', import.meta.url),
);
const packageDirectory = dirname(
  require.resolve('better-sqlite3/package.json'),
);
const nativeRequire = createRequire(join(packageDirectory, 'package.json'));
const Database = require('better-sqlite3');

function verify() {
  const db = new Database(':memory:');
  try {
    const { answer } = db.prepare('SELECT 42 AS answer').get();
    if (answer !== 42) throw new Error('SQLite native smoke check failed');
  } finally {
    db.close();
  }
}

try {
  verify();
  console.log(
    'better-sqlite3: existing native binary verified (no compilation).',
  );
} catch {
  console.log(
    'better-sqlite3: installing a prebuilt binary; source compilation is disabled.',
  );
  execFileSync(
    process.execPath,
    [nativeRequire.resolve('prebuild-install/bin.js')],
    {
      cwd: packageDirectory,
      stdio: 'inherit',
    },
  );
  verify();
  console.log('better-sqlite3: prebuilt binary verified.');
}
