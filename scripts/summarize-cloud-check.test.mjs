import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { summarizeCloudCheck } from './summarize-cloud-check.mjs';

const token = 'private-refresh-token-CANARY-do-not-print';
const vitest = (overrides = {}) => ({
  numPassedTests: 11,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  testResults: [
    {
      name: token,
      message: token,
      assertionResults: [
        {
          title: token,
          failureMessages: [token],
          actual: token,
          expected: token,
        },
      ],
    },
  ],
  ...overrides,
});
test('prints only a fixed phase label and bounded counts, never report titles or failure details', () => {
  const result = summarizeCloudCheck(
    'protocol',
    1,
    vitest({ numPassedTests: 10, numFailedTests: 1 }),
  );
  assert.equal(result.passed, false);
  assert.match(result.line, /SQL, RLS, CAS and Storage: FAIL/);
  assert.match(result.line, /passed=10, failed=1/);
  assert(!result.line.includes(token));
});
test('requires every real suite, rejects skips, and propagates command failures even with a passing report', () => {
  assert.equal(summarizeCloudCheck('protocol', 0, vitest()).passed, true);
  for (const report of [
    vitest({ numPassedTests: 0 }),
    vitest({ numPassedTests: 10 }),
    vitest({ numPendingTests: 1 }),
    vitest({ numTodoTests: 1 }),
    vitest({ numFailedTests: 1 }),
  ])
    assert.equal(summarizeCloudCheck('protocol', 0, report).passed, false);
  assert.equal(
    summarizeCloudCheck('auth', 0, vitest({ numPassedTests: 4 })).passed,
    true,
  );
  assert.equal(
    summarizeCloudCheck('service', 0, vitest({ numPassedTests: 2 })).passed,
    true,
  );
  assert.equal(summarizeCloudCheck('protocol', 1, vitest()).passed, false);
});
test('rejects missing, malformed, unbounded and string counters without exposing their values', () => {
  for (const report of [
    null,
    {},
    vitest({ numPassedTests: token }),
    vitest({ numPassedTests: Infinity }),
    vitest({ numPassedTests: 1000001 }),
  ]) {
    const result = summarizeCloudCheck('protocol', 0, report);
    assert.equal(result.passed, false);
    assert(!result.line.includes(token));
  }
  assert.equal(
    summarizeCloudCheck(token, 0, vitest()).line,
    'Cloud check: FAIL (unknown phase).',
  );
});
test('browser summaries reject skips, flaky results and global failures without echoing browser errors', () => {
  const browser = {
    stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
    errors: [],
    suites: [{ title: token, tests: [{ errors: [token] }] }],
  };
  assert.equal(summarizeCloudCheck('browser', 0, browser).passed, true);
  for (const stats of [
    { ...browser.stats, skipped: 1 },
    { ...browser.stats, flaky: 1 },
    { ...browser.stats, unexpected: 1 },
    { ...browser.stats, expected: 0 },
  ])
    assert.equal(
      summarizeCloudCheck('browser', 0, { ...browser, stats }).passed,
      false,
    );
  const result = summarizeCloudCheck('browser', 0, {
    ...browser,
    errors: [{ message: token }],
  });
  assert.equal(result.passed, false);
  assert(!result.line.includes(token));
});
test('CLI malformed reports and unknown phases never print raw input, parse errors or private paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cura-cloud-reporter-'));
  try {
    const path = join(dir, `${token}.json`);
    await writeFile(path, `{${token}`, { mode: 0o600 });
    const result = spawnSync(
      process.execPath,
      ['scripts/summarize-cloud-check.mjs', 'protocol', '0', path],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert(!`${result.stdout}${result.stderr}`.includes(token));
    assert(!`${result.stdout}${result.stderr}`.includes(dir));
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /required report unavailable or invalid/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
