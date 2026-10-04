import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Generated fixtures only: retain readable evidence when artifact downloads fail.
async function report(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await report(file);
    else if (
      entry.name === 'error-context.md' ||
      entry.name.endsWith('.json')
    ) {
      const contents = await readFile(file, 'utf8');
      console.log(`::group::${file}`);
      console.log(contents.slice(0, 32_768));
      console.log('::endgroup::');
    }
  }
}
await report('test-results');
await report('playwright-report/data');
