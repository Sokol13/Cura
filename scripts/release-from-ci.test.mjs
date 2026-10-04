import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  publishRequestedRelease,
  validateReleaseRequest,
  execute,
} from './release-from-ci.mjs';

const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const tag = 'v0.3.0';
const repository = 'Sokol13/Cura';
const report = 'docs/REPORT-v0.3.0.md';
const requestPath = '.github/release-request.json';
const trees = {
  server: '1'.repeat(40),
  shared: '2'.repeat(40),
  web: '3'.repeat(40),
};
const request = () => ({
  schemaVersion: 1,
  tag,
  ready: true,
  report,
  productionTrees: { ...trees },
});
const event = () => ({
  action: 'completed',
  repository: { id: 42, full_name: repository },
  workflow_run: {
    name: 'CI',
    path: '.github/workflows/ci.yml',
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    head_branch: 'main',
    head_sha: sha,
    head_repository: { id: 42, full_name: repository },
  },
});

function fixture() {
  const files = new Map([
    [requestPath, JSON.stringify(request())],
    [report, '# v0.3.0\n<!-- cura-release-ready: v0.3.0 -->\n'],
    ...[
      'package.json',
      ...Object.keys(trees).map((p) => `packages/${p}/package.json`),
    ].map((path) => [path, JSON.stringify({ version: '0.3.0' })]),
  ]);
  const state = {
    head: sha,
    main: sha,
    tagObject: null,
    tagTarget: null,
    releases: [],
    calls: [],
    writes: [],
    files,
    trees: { ...trees },
    fail: null,
    beforeWrite: null,
  };
  const run = (command, args) => {
    state.calls.push([command, ...args]);
    if (state.fail?.(command, args))
      throw new Error('simulated command failure');
    if (command === 'git') {
      if (args[0] === 'rev-parse') {
        if (args[1] === 'HEAD') return state.head;
        return state.trees[args[1].split('/').at(-1)];
      }
      if (args[0] === 'ls-tree')
        return state.files.has(requestPath) ? requestPath : '';
      if (args[0] === 'show') {
        const value = state.files.get(args[1].slice(sha.length + 1));
        if (value === undefined) throw new Error('missing tested file');
        return value;
      }
      if (args[0] === 'ls-remote') {
        return [
          `${state.main}\trefs/heads/main`,
          ...(state.tagObject ? [`${state.tagObject}\trefs/tags/${tag}`] : []),
          ...(state.tagTarget
            ? [`${state.tagTarget}\trefs/tags/${tag}^{}`]
            : []),
        ].join('\n');
      }
      if (args.includes('tag')) {
        state.writes.push([command, ...args]);
        state.beforeWrite?.('tag');
        return '';
      }
      if (args[0] === 'push') {
        state.writes.push([command, ...args]);
        state.tagObject = 'c'.repeat(40);
        state.tagTarget = sha;
        state.beforeWrite?.('push');
        return '';
      }
    }
    if (command === 'gh' && args[0] === 'api')
      return state.releases
        .map((release) => JSON.stringify(release))
        .join('\n');
    if (command === 'gh' && args[0] === 'release' && args[1] === 'create') {
      state.writes.push([command, ...args]);
      state.releases.push({ tag_name: tag, draft: false, prerelease: false });
      return 'https://github.com/Sokol13/Cura/releases/tag/v0.3.0';
    }
    throw new Error(`Unexpected seam call: ${command} ${args.join(' ')}`);
  };
  return {
    state,
    publish: (overrides = {}) =>
      publishRequestedRelease({
        eventName: 'workflow_run',
        event: event(),
        repository,
        run,
        ...overrides,
      }),
  };
}

test('request accepts only explicit ready v0.3.0 intent and exactly three valid production trees', () => {
  assert.deepEqual(validateReleaseRequest(request()), request());
  for (const invalid of [
    null,
    [],
    {},
    { ...request(), ready: false },
    { ...request(), tag: 'v0.4.0' },
    { ...request(), tag: 'v0.3.0; touch /tmp/no' },
    { ...request(), report: '../REPORT-v0.3.0.md' },
    { ...request(), schemaVersion: 2 },
    { ...request(), extra: true },
    { ...request(), productionTrees: { ...trees, web: other.slice(1) } },
    {
      ...request(),
      productionTrees: { server: trees.server, shared: trees.shared },
    },
    { ...request(), productionTrees: { ...trees, extra: sha } },
  ])
    assert.throws(() => validateReleaseRequest(invalid), /request/i);
});

test('absent activation file skips without API requests or publication writes', () => {
  const f = fixture();
  f.state.files.delete(requestPath);
  assert.equal(f.publish().status, 'inactive');
  assert.deepEqual(f.state.writes, []);
  assert.equal(
    f.state.calls.some(([command]) => command === 'gh'),
    false,
  );
});

test('rejects every non-main-push successful-CI provenance mismatch before commands', () => {
  const alterations = [
    (e) => {
      e.action = 'requested';
    },
    (e) => {
      e.repository.full_name = 'fork/Cura';
    },
    (e) => {
      e.workflow_run.head_repository.full_name = 'fork/Cura';
    },
    (e) => {
      e.workflow_run.head_repository.id = 43;
    },
    (e) => {
      e.workflow_run.name = 'Other';
    },
    (e) => {
      e.workflow_run.path = '.github/workflows/other.yml';
    },
    (e) => {
      e.workflow_run.event = 'pull_request';
    },
    (e) => {
      e.workflow_run.head_branch = 'feature';
    },
    (e) => {
      e.workflow_run.conclusion = 'failure';
    },
    (e) => {
      e.workflow_run.status = 'in_progress';
    },
    (e) => {
      e.workflow_run.head_sha = 'HEAD';
    },
  ];
  for (const alter of alterations) {
    const f = fixture(),
      payload = event();
    alter(payload);
    assert.throws(() => f.publish({ event: payload }), /CI/);
    assert.deepEqual(f.state.calls, []);
  }
  const f = fixture();
  assert.throws(() => f.publish({ eventName: 'push' }), /CI/);
  assert.deepEqual(f.state.calls, []);
});

test('rejects mismatched checkout, unfinished reports, package versions and package trees before writes', () => {
  const changes = [
    (s) => {
      s.head = other;
    },
    (s) => {
      s.files.set(requestPath, '{bad json');
    },
    (s) => {
      s.files.delete(report);
    },
    (s) => {
      s.files.set(report, '# Work in progress');
    },
    ...[
      'package.json',
      ...Object.keys(trees).map((p) => `packages/${p}/package.json`),
    ].map((path) => (s) => {
      s.files.set(path, JSON.stringify({ version: '0.2.0' }));
    }),
    ...Object.keys(trees).map((p) => (s) => {
      s.trees[p] = other;
    }),
  ];
  for (const change of changes) {
    const f = fixture();
    change(f.state);
    assert.throws(() => f.publish());
    assert.deepEqual(f.state.writes, []);
  }
});

test('stale successful CI cannot publish once main has advanced', () => {
  const f = fixture();
  f.state.main = other;
  assert.throws(() => f.publish(), /main/);
  assert.deepEqual(f.state.writes, []);
});

test('publishes an annotated tag at the tested SHA without force and creates generated notes in the same run', () => {
  const f = fixture();
  assert.equal(f.publish().status, 'published');
  assert.equal(f.state.writes.length, 3);
  assert.ok(f.state.writes[0].includes('--annotate'));
  assert.ok(f.state.writes[0].includes(sha));
  assert.ok(f.state.writes[0].includes('user.name=github-actions[bot]'));
  assert.deepEqual(f.state.writes[1], [
    'git',
    'push',
    'origin',
    `refs/tags/${tag}:refs/tags/${tag}`,
  ]);
  assert.ok(f.state.writes[2].includes('--verify-tag'));
  assert.ok(f.state.writes[2].includes('--generate-notes'));
  assert.equal(
    f.state.writes.some((call) => call.includes('--force')),
    false,
  );
});

test('matching remote tag and published release are idempotent; partial publication resumes without retagging', () => {
  const f = fixture();
  f.state.tagObject = 'c'.repeat(40);
  f.state.tagTarget = sha;
  assert.equal(f.publish().status, 'published');
  assert.equal(f.state.writes.length, 1);
  assert.deepEqual(f.state.writes[0].slice(0, 3), ['gh', 'release', 'create']);
  f.state.writes.length = 0;
  assert.equal(f.publish().status, 'already-published');
  assert.deepEqual(f.state.writes, []);
});

test('existing mismatched tags, orphaned releases and drafts never count as publication', () => {
  for (const mode of ['wrong-target', 'orphan', 'draft', 'prerelease']) {
    const f = fixture();
    if (mode !== 'orphan') {
      f.state.tagObject = other;
      f.state.tagTarget = mode === 'wrong-target' ? other : sha;
    }
    f.state.releases = [
      {
        tag_name: tag,
        draft: mode === 'draft',
        prerelease: mode === 'prerelease',
      },
    ];
    assert.throws(() => f.publish());
    assert.deepEqual(f.state.writes, []);
  }
});

test('API failures do not masquerade as missing releases and failed tag pushes do not create releases', () => {
  const api = fixture();
  api.state.fail = (command) => command === 'gh';
  assert.throws(() => api.publish());
  assert.deepEqual(api.state.writes, []);
  const push = fixture();
  push.state.fail = (command, args) => command === 'git' && args[0] === 'push';
  assert.throws(() => push.publish());
  assert.equal(push.state.writes.length, 1);
  assert.equal(
    push.state.calls.some(
      ([command, action]) => command === 'gh' && action === 'release',
    ),
    false,
  );
});

test('rechecks remote main before tag push and release creation and verifies the pushed target', () => {
  for (const step of ['tag', 'push']) {
    const f = fixture();
    f.state.beforeWrite = (action) => {
      if (action === step) f.state.main = other;
    };
    assert.throws(() => f.publish(), /main/);
    assert.equal(f.state.writes.length, step === 'tag' ? 1 : 2);
  }
  const f = fixture();
  f.state.beforeWrite = (action) => {
    if (action === 'push') f.state.tagTarget = other;
  };
  assert.throws(() => f.publish(), /tag/i);
  assert.equal(f.state.writes.length, 2);
});

test('command failures do not expose child stderr, stdout or credentials', () => {
  assert.throws(
    () =>
      execute(process.execPath, [
        '-e',
        'process.stderr.write("private-token-marker");process.exit(1)',
      ]),
    (error) =>
      !String(error).includes('private-token-marker') &&
      /command failed/.test(error.message),
  );
});

test('workflow has strict push-main same-repository gates, exact checkout and only job-scoped write permission', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/release-fallback.yml', import.meta.url),
    'utf8',
  );
  for (const condition of [
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
    'github.event.workflow_run.head_repository.full_name == github.repository',
    'ref: ${{ github.event.workflow_run.head_sha }}',
  ])
    assert.ok(workflow.includes(condition), condition);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.match(workflow, / {4}permissions:\n {6}contents: write/);
  assert.ok(workflow.includes('node scripts/release-from-ci.mjs'));
  assert.equal(workflow.includes('workflow_dispatch'), false);
  assert.equal(workflow.includes('pull_request_target'), false);
});
