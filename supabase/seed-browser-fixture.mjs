import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, open, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const roles = ['owner', 'editor', 'viewer', 'outsider'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message) => {
  throw new Error(message);
};
async function privateJson(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
    fail('Private input must be a regular file of at most 64 KiB.');
  if (process.platform !== 'win32' && stat.mode & 0o077)
    fail('Private input permissions must be 0600.');
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    fail('Private input is not valid JSON.');
  }
}
function existingFixture(value, url, anonKey) {
  return (
    object(value) &&
    Object.keys(value).sort().join(',') === 'accounts,anonKey,url' &&
    value.url === url &&
    value.anonKey === anonKey &&
    object(value.accounts) &&
    Object.keys(value.accounts).sort().join(',') ===
      [...roles].sort().join(',') &&
    roles.every((role) => {
      const account = value.accounts[role];
      return (
        object(account) &&
        Object.keys(account).sort().join(',') === 'email,id,password' &&
        typeof account.id === 'string' &&
        uuid.test(account.id) &&
        typeof account.email === 'string' &&
        account.email.includes('@') &&
        typeof account.password === 'string' &&
        account.password.length > 0
      );
    })
  );
}

/** Development-only account seeding. No Supabase admin key enters the output. */
export async function seedBrowserFixture({
  statusPath,
  outputPath,
  serviceRoleKey,
}) {
  if (!statusPath || !outputPath)
    fail('Set CURA_SYNC_TEST_STATUS and CURA_SYNC_E2E_FIXTURE.');
  const parent = await realpath(dirname(resolve(outputPath)));
  const fromRepository = relative(await realpath(repository), parent);
  if (
    !isAbsolute(fromRepository) &&
    fromRepository !== '..' &&
    !fromRepository.startsWith(`..${sep}`)
  )
    fail('The private output must be outside the repository.');
  const input = await privateJson(statusPath);
  if (
    !object(input) ||
    typeof input.API_URL !== 'string' ||
    typeof input.ANON_KEY !== 'string' ||
    !input.ANON_KEY
  )
    fail('Private status requires API_URL and ANON_KEY.');
  let project;
  try {
    project = new URL(input.API_URL);
  } catch {
    fail('Invalid local Supabase URL.');
  }
  if (
    !['http:', 'https:'].includes(project.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(project.hostname) ||
    project.username ||
    project.password ||
    project.search ||
    project.hash ||
    project.pathname !== '/'
  )
    fail('Only a disposable loopback Supabase project is permitted.');
  const url = project.origin,
    anonKey = input.ANON_KEY;
  try {
    await lstat(outputPath);
    if (!existingFixture(await privateJson(outputPath), url, anonKey))
      fail(
        'Existing fixture does not match this project or the private fixture schema. It was not changed.',
      );
    return { created: 0, reused: true };
  } catch (error) {
    if (!object(error) || error.code !== 'ENOENT') throw error;
  }
  const adminKey = serviceRoleKey || input.SERVICE_ROLE_KEY || input.SECRET_KEY;
  if (typeof adminKey !== 'string' || !adminKey || /\s/.test(adminKey))
    fail(
      'Private status or CURA_SUPABASE_SERVICE_ROLE_KEY must provide a local admin key.',
    );
  const output = await open(outputPath, 'wx', 0o600);
  const created = [],
    accounts = {};
  const admin = async (method, path, body) => {
    let response;
    try {
      response = await fetch(`${url}/auth/v1/admin/users${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          apikey: adminKey,
          authorization: `Bearer ${adminKey}`,
          'content-type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      fail('Local Auth admin request could not complete.');
    }
    if (!response.ok)
      fail(`Local Auth admin request failed with HTTP ${response.status}.`);
    if (method === 'DELETE') return null;
    try {
      return await response.json();
    } catch {
      fail('Local Auth returned an invalid user response.');
    }
  };
  try {
    for (const role of roles) {
      const email = `cura-ui-${role}-${randomUUID()}@example.test`;
      const password = randomBytes(32).toString('base64url');
      const user = await admin('POST', '', {
        email,
        password,
        email_confirm: true,
      });
      if (!object(user) || typeof user.id !== 'string' || !uuid.test(user.id))
        fail('Local Auth did not return a valid user UUID.');
      created.push(user.id);
      accounts[role] = { id: user.id, email, password };
    }
    await output.writeFile(
      JSON.stringify({ url, anonKey, accounts }, null, 2) + '\n',
    );
    await output.sync();
    return { created: created.length, reused: false };
  } catch (error) {
    let cleanupFailed = false;
    for (const id of created) {
      try {
        await admin('DELETE', `/${id}`);
      } catch {
        cleanupFailed = true;
      }
    }
    await output.close();
    await rm(outputPath, { force: true });
    if (cleanupFailed)
      fail(
        'Seeding failed; account cleanup was incomplete in the disposable stack. No fixture was saved.',
      );
    throw error;
  } finally {
    await output.close().catch(() => {});
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await seedBrowserFixture({
      statusPath: process.env.CURA_SYNC_TEST_STATUS,
      outputPath: process.env.CURA_SYNC_E2E_FIXTURE,
      serviceRoleKey: process.env.CURA_SUPABASE_SERVICE_ROLE_KEY,
    });
    console.log(
      result.reused
        ? 'Existing private browser fixture preserved.'
        : 'Created four local Auth accounts and saved the private browser fixture.',
    );
  } catch (error) {
    // Controlled errors carry no HTTP bodies, credentials or parsed input.
    const known = error instanceof Error && !('code' in error);
    console.error(
      known
        ? error.message
        : 'Cannot read or write the private local fixture files.',
    );
    process.exitCode = 1;
  }
}
