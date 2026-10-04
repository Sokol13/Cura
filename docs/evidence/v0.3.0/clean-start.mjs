// Linux release acceptance. Run only after the production commit is frozen.
// This creates a genuinely independent clone; it never navigates a browser page.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const [
  sourceArgument,
  commit,
  cloneArgument,
  outputArgument,
  screenshotArgument,
] = process.argv.slice(2);
assert(
  sourceArgument &&
    /^[a-f\d]{40}$/.test(commit ?? '') &&
    cloneArgument &&
    outputArgument &&
    screenshotArgument,
  'Usage: NODE_PATH= node clean-start.mjs SOURCE_REPO FROZEN_FULL_SHA NEW_CLONE OUTPUT_JSON SCREENSHOT_PNG',
);
assert.equal(
  process.platform,
  'linux',
  'This harness tests the Linux XDG opener only',
);
assert.equal(process.versions.node.split('.')[0], '22');
assert.equal(
  process.env.NODE_PATH,
  '',
  'Explicitly clear NODE_PATH for the whole verifier',
);
const source = resolve(sourceArgument),
  clone = resolve(cloneArgument);
const output = resolve(outputArgument),
  screenshot = resolve(screenshotArgument);
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );
assert(!(await exists(clone)), 'The fresh-clone destination must not exist');
const support = await mkdtemp(join(tmpdir(), 'cura-clean-v030-'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const env = { ...process.env, NODE_PATH: '' };
for (const key of Object.keys(env))
  if (/^(CURA_|SUPABASE_|GITHUB_|GH_TOKEN$|NODE_OPTIONS$|BROWSER$)/.test(key))
    delete env[key];
const results = {};
let startup, browser, browserPid, startupExit;
let succeeded = false;
const logFile = (name) => join(support, name);
async function run(command, args, options = {}) {
  const started = performance.now();
  const child = spawn(command, args, {
    cwd: options.cwd ?? clone,
    env: options.env ?? env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks = [];
  const collect = (bytes) => chunks.push(bytes);
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const timeout = setTimeout(
    () => signalGroup(child.pid, 'SIGKILL'),
    options.timeout ?? 120000,
  );
  let code;
  try {
    code = await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('close', done);
    });
  } finally {
    clearTimeout(timeout);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (options.log) await writeFile(logFile(options.log), text);
  assert.equal(
    code,
    0,
    `${command} ${args.join(' ')} failed; inspect the private acceptance log`,
  );
  return {
    text,
    seconds: Math.round((performance.now() - started) / 100) / 10,
  };
}
async function waitFor(check, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.fail(`${label} timed out`);
}
async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
const listening = (port) =>
  new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    const finish = (value) => {
      socket.destroy();
      done(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
function signalGroup(pid, signal) {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
async function liveProcessGroup(pid) {
  if (!pid) return false;
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const stat = await readFile(`/proc/${name}/stat`, 'utf8').catch(() => '');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (fields[2] === String(pid) && fields[0] !== 'Z') return true;
  }
  return false;
}
async function directoryHashes(root, path = root) {
  const entries = await readdir(path, { withFileTypes: true });
  const values = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(path, entry.name);
    if (entry.isDirectory())
      values.push(...(await directoryHashes(root, file)));
    else if (entry.isFile()) {
      const bytes = await readFile(file);
      values.push({
        file: relative(root, file).replaceAll('\\', '/'),
        size: bytes.length,
        sha256: sha256(bytes),
      });
    }
  }
  return values;
}
const serverPort = await freePort();
let cdpPort = await freePort();
while (cdpPort === serverPort) cdpPort = await freePort();
const origin = `http://127.0.0.1:${serverPort}`;
const cdpOrigin = `http://127.0.0.1:${cdpPort}`;
const paths = {
  data: join(support, 'data'),
  cache: join(support, 'cache'),
  log: join(support, 'log'),
};
try {
  await run('git', ['clone', '--no-local', '--no-checkout', source, clone], {
    cwd: dirname(clone),
    log: 'clone.log',
  });
  await run('git', ['checkout', '--detach', commit], { log: 'checkout.log' });
  assert.equal((await run('git', ['rev-parse', 'HEAD'])).text.trim(), commit);
  assert(!(await exists(join(clone, '.git/objects/info/alternates'))));
  for (const path of [
    'node_modules',
    'packages/server/node_modules',
    'packages/shared/node_modules',
    'packages/web/node_modules',
  ])
    assert(
      !(await exists(join(clone, path))),
      `${path} must be absent before install`,
    );
  const packageVersions = {};
  for (const path of [
    'package.json',
    'packages/server/package.json',
    'packages/shared/package.json',
    'packages/web/package.json',
  ]) {
    const manifest = JSON.parse(await readFile(join(clone, path), 'utf8'));
    packageVersions[path] = manifest.version;
    assert.equal(manifest.version, '0.3.0');
  }
  const manifest = JSON.parse(
    await readFile(join(clone, 'package.json'), 'utf8'),
  );
  const pnpmVersion = (await run('pnpm', ['--version'])).text.trim();
  assert.equal(manifest.packageManager, `pnpm@${pnpmVersion}`);
  const install = await run('pnpm', ['install', '--frozen-lockfile'], {
    log: 'install.log',
  });
  assert(install.text.includes('better-sqlite3: prebuilt binary verified.'));
  assert(
    install.text.includes(
      'sharp: prebuilt image processing verified (no compilation).',
    ),
  );
  assert(!/\bnode-gyp\b/i.test(install.text));
  await run('node', ['scripts/ensure-sqlite-prebuilt.mjs'], {
    log: 'sqlite-prebuilt.log',
  });
  await run('node', ['scripts/ensure-sharp-prebuilt.mjs'], {
    log: 'sharp-prebuilt.log',
  });
  const graph = JSON.parse(
    (
      await run('pnpm', ['list', '-r', '--depth', 'Infinity', '--json'], {
        log: 'dependency-graph.json',
      })
    ).text,
  );
  assert(!JSON.stringify(graph).includes('@napi-rs/canvas'));
  const physical = await readdir(join(clone, 'node_modules/.pnpm'));
  assert(!physical.some((name) => name.startsWith('@napi-rs+canvas@')));
  const requireClone = createRequire(join(clone, 'package.json'));
  assert.throws(() => requireClone.resolve('@napi-rs/canvas'), {
    code: 'MODULE_NOT_FOUND',
  });
  const licenseCheck = await run('pnpm', ['check:licenses'], {
    log: 'license-check.log',
  });
  const licenses = JSON.parse(
    (
      await run('pnpm', ['licenses', 'list', '--prod', '--json'], {
        log: 'runtime-licenses.json',
      })
    ).text,
  );
  const runtimePackages = Object.values(licenses).reduce(
    (count, entries) => count + entries.length,
    0,
  );
  assert(
    licenseCheck.text.includes(
      `${runtimePackages} installed runtime package licenses checked;`,
    ),
  );
  await run('git', ['diff', '--exit-code', 'HEAD', '--', 'pnpm-lock.yaml']);
  results.clone = {
    method: 'git clone --no-local; independent Git objects, no alternates',
    nodeModulesAbsentBeforeInstall: true,
    packageVersions,
    frozenLockfile: true,
    installSeconds: install.seconds,
    lockfileSha256: sha256(await readFile(join(clone, 'pnpm-lock.yaml'))),
  };
  results.dependencies = {
    productionLicensePackages: runtimePackages,
    licenseCheckPassed: true,
    sharpNativeLicenseException:
      'Documented mandated Sharp/libvips exception; bundled notices are audited separately.',
    sqlitePrebuiltVerified: true,
    sharpPrebuiltVerified: true,
    nodeGypInvoked: false,
    optionalCanvasInInstalledGraph: false,
    optionalCanvasPhysicallyInstalled: false,
    optionalCanvasResolvableWithEmptyNodePath: false,
  };
  results.environment = {
    os: `${process.platform} ${process.arch}`,
    node: process.version,
    pnpm: pnpmVersion,
    installNodePath: '',
    startupNodePath: '',
    browserVerificationNodePath: '',
  };

  const config = join(support, 'xdg-config'),
    data = join(support, 'xdg-data');
  const applications = join(data, 'applications');
  const profile = join(support, 'browser-profile');
  const launcher = join(support, 'browser-launcher.mjs');
  const launchFile = join(support, 'browser-launch.json');
  const desktopName = 'cura-v030-acceptance.desktop';
  const chromiumExecutable =
    process.env.CURA_CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium';
  assert(await exists(chromiumExecutable));
  assert(!(await exists(profile)));
  await mkdir(config, { recursive: true });
  await mkdir(applications, { recursive: true });
  for (const path of Object.values(paths)) {
    assert(!(await exists(path)));
    await mkdir(path, { recursive: true });
    assert.deepEqual(await readdir(path), []);
  }
  const launcherConfig = {
    executable: chromiumExecutable,
    profile,
    cdpPort,
    launchFile,
    browserLog: logFile('chromium.log'),
  };
  await writeFile(
    launcher,
    `#!/usr/bin/env node\nimport {spawn} from 'node:child_process';\nimport {openSync,writeFileSync} from 'node:fs';\nconst config=${JSON.stringify(launcherConfig)};\nconst urls=process.argv.slice(2);\nconst fd=openSync(config.browserLog,'a',0o600);\nconst browser=spawn(config.executable,['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+config.cdpPort,'--user-data-dir='+config.profile,...urls],{detached:true,stdio:['ignore',fd,fd],env:{...process.env,NODE_PATH:''}});\nwriteFileSync(config.launchFile,JSON.stringify({urls,pid:browser.pid}));\nbrowser.unref();\n`,
  );
  await chmod(launcher, 0o700);
  await writeFile(
    join(applications, desktopName),
    `[Desktop Entry]\nType=Application\nName=Cura release acceptance Chromium\nExec=${launcher} %u\nMimeType=x-scheme-handler/http;x-scheme-handler/https;\nTerminal=false\n`,
  );
  const association = `[Default Applications]\nx-scheme-handler/http=${desktopName}\nx-scheme-handler/https=${desktopName}\n`;
  await writeFile(join(config, 'mimeapps.list'), association);
  await writeFile(join(applications, 'mimeapps.list'), association);
  const startupEnv = {
    ...env,
    CURA_OPEN_BROWSER: '1',
    PORT: String(serverPort),
    CURA_DATA_DIR: paths.data,
    CURA_CACHE_DIR: paths.cache,
    CURA_LOG_DIR: paths.log,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    XDG_CACHE_HOME: join(support, 'xdg-cache'),
    XDG_CURRENT_DESKTOP: 'X-Generic',
    DISPLAY: ':99',
  };
  delete startupEnv.WAYLAND_DISPLAY;
  assert.equal(
    (
      await run('xdg-mime', ['query', 'default', 'x-scheme-handler/http'], {
        env: startupEnv,
      })
    ).text.trim(),
    desktopName,
  );
  assert.equal(
    (
      await run('xdg-mime', ['query', 'default', 'x-scheme-handler/https'], {
        env: startupEnv,
      })
    ).text.trim(),
    desktopName,
  );
  const startLog = openSync(logFile('start.log'), 'a', 0o600);
  const startTime = performance.now();
  startup = spawn('pnpm', ['start'], {
    cwd: clone,
    env: startupEnv,
    detached: true,
    stdio: ['ignore', startLog, startLog],
  });
  closeSync(startLog);
  startup.once('exit', (code, signal) => {
    startupExit = { code, signal };
  });
  startup.once('error', (error) => {
    startupExit = { error: error.message };
  });
  await waitFor(
    async () => {
      assert(!startupExit, 'pnpm start exited before health became ready');
      return fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(1500),
      }).then(
        async (response) => {
          if (!response.ok) return false;
          assert.deepEqual(await response.json(), { status: 'ok' });
          return true;
        },
        () => false,
      );
    },
    'Normal pnpm start health',
    120000,
  );
  const startupSeconds = Math.round((performance.now() - startTime) / 100) / 10;
  const launched = await waitFor(
    async () =>
      (await exists(launchFile))
        ? JSON.parse(await readFile(launchFile, 'utf8'))
        : false,
    'OS default browser launch',
  );
  browserPid = launched.pid;
  assert(Number.isInteger(browserPid) && browserPid > 1);
  assert.equal(launched.urls.length, 1);
  assert.equal(new URL(launched.urls[0]).origin, origin);
  await waitFor(
    () =>
      fetch(`${cdpOrigin}/json/version`, {
        signal: AbortSignal.timeout(1500),
      }).then(
        (response) => response.ok,
        () => false,
      ),
    'Automatically launched browser CDP',
  );
  const { chromium, expect } = requireClone('@playwright/test');
  browser = await chromium.connectOverCDP(cdpOrigin);
  const page = await waitFor(
    () =>
      Promise.resolve(
        browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((entry) => entry.url().startsWith(origin)),
      ),
    'Already opened Cura page',
  );
  // Intentionally never call page.goto(), context.newPage() or browser.newPage().
  await expect(page).toHaveTitle('Cura');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.getByRole('heading', { name: 'Cura', exact: true }),
  ).toBeVisible();
  const libraryName = 'v0.3 启动验证 · 设计资料库';
  await page.getByRole('button', { name: '新建资产库', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: '名称', exact: true })
    .fill(libraryName);
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: libraryName, exact: true }),
  ).toBeVisible();
  const before = await page.evaluate(async () => {
    const [libraries, settings, health] = await Promise.all(
      ['/api/libraries', '/api/settings', '/api/health'].map(async (path) => {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }),
    );
    return { libraries, settings, health };
  });
  assert.equal(before.libraries.length, 1);
  assert.equal(before.libraries[0].name, libraryName);
  assert.equal(before.settings.language, 'zh-CN');
  assert.deepEqual(before.health, { status: 'ok' });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: libraryName, exact: true }),
  ).toBeVisible();
  const after = await page.evaluate(async () => ({
    libraries: await (await fetch('/api/libraries')).json(),
    settings: await (await fetch('/api/settings')).json(),
  }));
  assert.equal(after.libraries[0].id, before.libraries[0].id);
  assert.equal(after.settings.activeLibraryId, before.libraries[0].id);
  await mkdir(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });
  results.environment.chromium = browser.version();
  results.startup = {
    command: 'NODE_PATH= CURA_OPEN_BROWSER=1 PORT=<isolated-port> pnpm start',
    startupSeconds,
    emptyDataCacheLogDirectories: true,
    buildPassed: true,
    health: before.health,
    host: '127.0.0.1',
    defaultBrowserOpened: true,
    defaultBrowserMethod:
      'Isolated XDG HTTP/HTTPS desktop association invoked headless Chromium; global associations unchanged.',
    freshBrowserProfile: true,
    attachedWith:
      'Playwright connectOverCDP to the already automatically opened page',
    pageGotoCalled: false,
    newPageCalled: false,
  };
  results.persistence = {
    language: 'zh-CN',
    libraryName,
    createdThroughChineseUI: true,
    sameLibraryIdAfterReload: true,
    activeLibraryIdAfterReload: true,
  };
  const cdp = await browser.newBrowserCDPSession();
  await cdp.send('Browser.close').catch(() => undefined);
  await browser.close().catch(() => undefined);
  browser = undefined;
  signalGroup(startup.pid, 'SIGTERM');
  await waitFor(
    () => Promise.resolve(Boolean(startupExit)),
    'Normal server process exit',
    15000,
  );
  await waitFor(
    async () => !(await listening(serverPort)) && !(await listening(cdpPort)),
    'Server/browser ports released',
    15000,
  );
  await waitFor(
    async () =>
      !(await liveProcessGroup(startup.pid)) &&
      !(await liveProcessGroup(browserPid)),
    'Owned server and browser process groups stopped',
    15000,
  );
  startup = undefined;
  const Database = createRequire(join(clone, 'packages/server/package.json'))(
    'better-sqlite3',
  );
  const db = new Database(join(paths.data, 'cura.sqlite'), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    assert.deepEqual(db.prepare('SELECT id,name FROM libraries').all(), [
      { id: before.libraries[0].id, name: libraryName },
    ]);
    assert.equal(
      JSON.parse(
        db.prepare("SELECT value FROM settings WHERE id='user'").get().value,
      ).activeLibraryId,
      before.libraries[0].id,
    );
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(
      db.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get()
        .count,
      9,
    );
  } finally {
    db.close();
  }
  results.persistence.closedDatabaseContainsLibrary = true;
  results.persistence.closedDatabaseIntegrityCheck = 'ok';
  results.persistence.closedDatabaseForeignKeyViolations = 0;
  results.persistence.migrationCount = 9;
  results.cleanup = {
    privateServerStopped: true,
    privateBrowserStopped: true,
    serverAndCdpPortsReleased: true,
  };
  const sourceTrees = {};
  for (const path of [
    'packages/web/src',
    'packages/server/src',
    'packages/shared/src',
    'packages/server/drizzle',
  ])
    sourceTrees[path] = (
      await run('git', ['rev-parse', `HEAD:${path}`])
    ).text.trim();
  const artifacts = {};
  for (const path of [
    'packages/shared/dist',
    'packages/server/dist',
    'packages/web/dist',
  ]) {
    const records = await directoryHashes(join(clone, path));
    artifacts[path] = {
      files: records.length,
      bytes: records.reduce((sum, item) => sum + item.size, 0),
      sortedFileHashManifestSha256: sha256(JSON.stringify(records)),
      entrypoints: records.filter((item) =>
        /^(index\.(js|html)|assets\/index-[^/]+\.(js|css))$/.test(item.file),
      ),
    };
  }
  const evidence = {
    milestone: 'v0.3.0',
    status: 'passed',
    verifiedAt: new Date().toISOString(),
    implementationCommit: commit,
    ...results,
    sourceTrees,
    artifacts,
    screenshot: {
      file: basename(screenshot),
      sha256: sha256(await readFile(screenshot)),
      contentOnly: true,
    },
    scope: {
      physicalMacOSVerified: false,
      physicalWindowsVerified: false,
      fullUnitSuiteIncluded: false,
      notes:
        'Fresh clone/install/start and real Chinese browser persistence on Linux. XDG association launches a headless browser; no physical desktop or cloud-account claim.',
    },
  };
  const serialized = JSON.stringify(evidence, null, 2) + '\n';
  for (const privatePath of [source, clone, support])
    assert(!serialized.includes(privatePath));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, serialized);
  succeeded = true;
  console.log(
    JSON.stringify({
      status: 'passed',
      commit,
      runtimePackages,
      startupSeconds,
      defaultBrowserOpened: true,
      reloadedChineseLibrary: true,
    }),
  );
} finally {
  await browser?.close().catch(() => undefined);
  if (!browserPid && (await exists(join(support, 'browser-launch.json'))))
    browserPid = JSON.parse(
      await readFile(join(support, 'browser-launch.json'), 'utf8'),
    ).pid;
  signalGroup(startup?.pid, 'SIGTERM');
  signalGroup(browserPid, 'SIGTERM');
  for (
    let attempt = 0;
    attempt < 30 &&
    ((await listening(serverPort)) || (await listening(cdpPort)));
    attempt++
  )
    await new Promise((done) => setTimeout(done, 100));
  signalGroup(startup?.pid, 'SIGKILL');
  signalGroup(browserPid, 'SIGKILL');
  // Failed attempts retain private logs for diagnosis; they never emit passing evidence.
  if (succeeded) await rm(support, { recursive: true, force: true });
  else console.error(`Private acceptance diagnostics retained at ${support}`);
}
