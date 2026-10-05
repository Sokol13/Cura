import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tag = 'v0.4.0';
const version = '0.4.0';
const requestPath = '.github/release-request.json';
const reportPath = `docs/REPORT-${tag}.md`;
const packages = ['server', 'shared', 'web'];
const hash = /^[a-f0-9]{40}$/;
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) =>
  object(value) &&
  Object.keys(value).sort().join(',') === [...expected].sort().join(',');

export function validateReleaseRequest(value) {
  if (
    !keys(value, [
      'schemaVersion',
      'tag',
      'ready',
      'report',
      'productionTrees',
    ]) ||
    value.schemaVersion !== 1 ||
    value.tag !== tag ||
    value.ready !== true ||
    value.report !== reportPath ||
    !keys(value.productionTrees, packages) ||
    packages.some(
      (name) =>
        typeof value.productionTrees[name] !== 'string' ||
        !hash.test(value.productionTrees[name]),
    )
  )
    throw new Error(
      'Invalid release request: explicit ready v0.4.0 intent, report and three package tree hashes are required.',
    );
  return value;
}

function testedSha(eventName, event, repository) {
  const run = event?.workflow_run;
  if (
    eventName !== 'workflow_run' ||
    event?.action !== 'completed' ||
    typeof repository !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    event?.repository?.full_name !== repository ||
    !Number.isSafeInteger(event?.repository?.id) ||
    event.repository.id <= 0 ||
    run?.head_repository?.full_name !== repository ||
    run?.head_repository?.id !== event.repository.id ||
    run?.name !== 'CI' ||
    run?.path !== '.github/workflows/ci.yml' ||
    run?.status !== 'completed' ||
    run?.conclusion !== 'success' ||
    run?.event !== 'push' ||
    run?.head_branch !== 'main' ||
    typeof run?.head_sha !== 'string' ||
    !hash.test(run.head_sha)
  )
    throw new Error(
      'Release requires successful CI for a push to main in this repository.',
    );
  return run.head_sha;
}

/** Capture subprocess output privately; failures must never dump credential-bearing diagnostics. */
export function execute(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
  } catch {
    throw new Error(
      'Release command failed; child output is withheld to protect credentials.',
    );
  }
}

/** Only this function can publish. Tests replace run with a stateful command seam, never a remote. */
export function publishRequestedRelease({
  eventName,
  event,
  repository,
  run = execute,
}) {
  const sha = testedSha(eventName, event, repository);
  if (run('git', ['rev-parse', 'HEAD']).trim() !== sha)
    throw new Error('Checkout does not match the successful CI SHA.');
  const requestEntry = run('git', [
    'ls-tree',
    '--name-only',
    sha,
    requestPath,
  ]).trim();
  if (requestEntry === '') return { status: 'inactive' };
  if (requestEntry !== requestPath)
    throw new Error('Invalid release request entry.');
  const read = (path) => run('git', ['show', `${sha}:${path}`]);
  const request = validateReleaseRequest(JSON.parse(read(requestPath)));
  for (const path of [
    'package.json',
    ...packages.map((name) => `packages/${name}/package.json`),
  ]) {
    if (JSON.parse(read(path)).version !== version)
      throw new Error(`Package version does not match ${tag}: ${path}`);
  }
  if (
    !read(reportPath)
      .split(/\r?\n/)
      .includes(`<!-- cura-release-ready: ${tag} -->`)
  )
    throw new Error(
      'The milestone report does not explicitly declare release readiness.',
    );
  for (const name of packages) {
    if (
      run('git', ['rev-parse', `${sha}:packages/${name}`]).trim() !==
      request.productionTrees[name]
    )
      throw new Error(
        `Tested ${name} package tree does not match the release request.`,
      );
  }
  const tagRef = `refs/tags/${tag}`;
  const remote = () => {
    const refs = new Map();
    const output = run('git', [
      'ls-remote',
      'origin',
      'refs/heads/main',
      tagRef,
      `${tagRef}^{}`,
    ]).trim();
    for (const line of output.split('\n')) {
      const match = /^([a-f0-9]{40})\s+(\S+)$/.exec(line);
      if (!match || refs.has(match[2]))
        throw new Error('Unexpected remote reference response.');
      refs.set(match[2], match[1]);
    }
    if (refs.get('refs/heads/main') !== sha)
      throw new Error(
        'Remote main has changed since this CI run; no further publication is allowed.',
      );
    const tagObject = refs.get(tagRef);
    const tagTarget = refs.get(`${tagRef}^{}`);
    if (tagObject && !tagTarget)
      throw new Error(
        'Existing remote tag must be an annotated tag with a peeled target; never replace it.',
      );
    if (tagTarget && tagTarget !== sha)
      throw new Error(
        'Existing remote tag does not target the successful CI SHA; never move it.',
      );
    if (!tagObject && tagTarget)
      throw new Error('Invalid remote tag reference.');
    return { tagObject, tagTarget };
  };
  const initial = remote();
  // Listing all pages distinguishes absence from authentication/network failures without guessing exit codes.
  const releases = run('gh', [
    'api',
    '--paginate',
    `repos/${repository}/releases`,
    '--jq',
    '.[] | {tag_name, draft, prerelease} | @json',
  ]).trim();
  const matching = releases
    ? releases
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((release) => release.tag_name === tag)
    : [];
  if (matching.length) {
    if (
      matching.length !== 1 ||
      !initial.tagTarget ||
      matching[0].draft !== false ||
      matching[0].prerelease !== false
    )
      throw new Error(
        'Existing release is orphaned, duplicated, a draft or a prerelease; resolve it explicitly.',
      );
    return { status: 'already-published', tag, sha };
  }
  if (!initial.tagTarget) {
    remote();
    run('git', [
      '-c',
      'user.name=github-actions[bot]',
      '-c',
      'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'tag',
      '--annotate',
      tag,
      '--message',
      `Cura ${tag}`,
      sha,
    ]);
    remote();
    run('git', ['push', 'origin', `${tagRef}:${tagRef}`]);
  }
  if (remote().tagTarget !== sha)
    throw new Error('Remote tag was not published at the successful CI SHA.');
  run('gh', [
    'release',
    'create',
    tag,
    '--repo',
    repository,
    '--verify-tag',
    '--generate-notes',
    '--title',
    `Cura ${tag}`,
    '--target',
    sha,
  ]);
  return { status: 'published', tag, sha };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.GITHUB_EVENT_PATH)
      throw new Error(
        'Run release publication only through the gated GitHub Actions workflow.',
      );
    const result = publishRequestedRelease({
      eventName: process.env.GITHUB_EVENT_NAME,
      repository: process.env.GITHUB_REPOSITORY,
      event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Release gate failed.',
    );
    process.exitCode = 1;
  }
}
