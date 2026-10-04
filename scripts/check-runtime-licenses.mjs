import { execFileSync } from 'node:child_process';

const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('Run this check with pnpm check:licenses.');
const licenses = JSON.parse(
  execFileSync(
    process.execPath,
    [pnpm, 'licenses', 'list', '--prod', '--json'],
    {
      encoding: 'utf8',
    },
  ),
);
const allowed = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  '0BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '(MIT OR WTFPL)',
  '(BSD-2-Clause OR MIT OR Apache-2.0)',
]);
const failures = [];
let count = 0;
for (const [license, packages] of Object.entries(licenses)) {
  for (const dependency of packages) {
    count += 1;
    // AGENTS explicitly mandates Sharp; its native bundle exception is documented.
    const mandatorySharpBundle =
      license === 'LGPL-3.0-or-later' &&
      dependency.name.startsWith('@img/sharp-libvips-');
    if (!allowed.has(license) && !mandatorySharpBundle)
      failures.push(`${dependency.name}: ${license}`);
  }
}
if (failures.length) {
  console.error(`Runtime license check failed:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(
    `${count} installed runtime package licenses checked; documented Sharp native exception retained. Bundled asset/native notices require separate review.`,
  );
}
