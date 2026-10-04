import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Only source-controlled labels and bounded numeric counters may reach CI logs.
// Reporter titles, errors, assertion values, output and paths remain private.
const phases = {
  protocol: { label: 'SQL, RLS, CAS and Storage', minimum: 11 },
  auth: { label: 'Real Auth and verified file transfer', minimum: 4 },
  service: { label: 'Two-device graph and recovery', minimum: 2 },
  browser: { label: 'Owner/editor/viewer browser workflow', minimum: 1 },
};
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
export function summarizeCloudCheck(phase, exitCode, report) {
  const definition = Object.hasOwn(phases, phase) ? phases[phase] : null;
  if (!definition)
    return { passed: false, line: 'Cloud check: FAIL (unknown phase).' };
  const invalid = () => ({
    passed: false,
    line: `${definition.label}: FAIL (required report unavailable or invalid).`,
  });
  if (
    !object(report) ||
    !Number.isInteger(exitCode) ||
    exitCode < 0 ||
    exitCode > 255
  )
    return invalid();
  let passed,
    failed,
    skipped,
    flaky = 0,
    globalFailure = false;
  if (phase === 'browser') {
    if (!object(report.stats) || !Array.isArray(report.errors))
      return invalid();
    ({ expected: passed, unexpected: failed, skipped, flaky } = report.stats);
    globalFailure = report.errors.length !== 0;
  } else {
    passed = report.numPassedTests;
    failed = report.numFailedTests;
    skipped = report.numPendingTests;
    const todo = report.numTodoTests ?? 0;
    if (!count(todo)) return invalid();
    globalFailure = todo !== 0 || report.success === false;
  }
  if (![passed, failed, skipped, flaky].every(count)) return invalid();
  const success =
    exitCode === 0 &&
    !globalFailure &&
    passed >= definition.minimum &&
    failed === 0 &&
    skipped === 0 &&
    flaky === 0;
  return {
    passed: success,
    line: `${definition.label}: ${success ? 'PASS' : 'FAIL'} (passed=${passed}, failed=${failed}, skipped=${skipped}, flaky=${flaky}).`,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [, , phase, rawExitCode, filename] = process.argv;
  let report = null;
  try {
    const info = await stat(filename);
    if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error();
    report = JSON.parse(await readFile(filename, 'utf8'));
  } catch {
    // Never stringify filesystem, JSON parsing or reporter errors: these may contain credentials.
  }
  const result = summarizeCloudCheck(phase, Number(rawExitCode), report);
  console.log(result.line);
  process.exitCode = result.passed ? 0 : 1;
}
