import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import {
  SyncAccountSchema,
  SyncSignInSchema,
  type SyncAccount,
  type SyncProblem,
  type SyncSignIn,
  type SyncStatus,
} from '@cura/shared';
import type { UserPaths } from '../paths.js';
import { SyncError } from './errors.js';

interface SavedSession {
  version: 1;
  projectId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  account: SyncAccount;
}
function parseSession(input: unknown): SavedSession {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid private session.');
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(',') !==
      'accessToken,account,expiresAt,projectId,refreshToken,version' ||
    value.version !== 1 ||
    typeof value.projectId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.projectId) ||
    typeof value.accessToken !== 'string' ||
    value.accessToken.length < 1 ||
    value.accessToken.length > 32768 ||
    typeof value.refreshToken !== 'string' ||
    value.refreshToken.length < 1 ||
    value.refreshToken.length > 8192 ||
    typeof value.expiresAt !== 'number' ||
    !Number.isFinite(value.expiresAt) ||
    value.expiresAt < 0
  ) {
    throw new Error('Invalid private session.');
  }
  return {
    version: 1,
    projectId: value.projectId,
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    expiresAt: value.expiresAt,
    account: SyncAccountSchema.parse(value.account),
  };
}

const problem = (code: string, error: string): SyncProblem => ({ code, error });
const offline = () =>
  problem(
    'SYNC_OFFLINE',
    'Cloud connection is unavailable. Local work remains available.',
  );
const expired = () =>
  problem(
    'SYNC_AUTH_EXPIRED',
    'Cloud sign-in has expired. Sign in again to resume sync.',
  );
const storageError = () =>
  problem(
    'SYNC_AUTH_STORAGE',
    'Cloud sign-in could not be saved in the private user data directory.',
  );

function configuration(
  environment: NodeJS.ProcessEnv,
): { url: string; key: string } | null {
  const urlText = environment.CURA_SUPABASE_URL?.trim() ?? '';
  const key = environment.CURA_SUPABASE_ANON_KEY?.trim() ?? '';
  if (!urlText && !key) return null;
  try {
    if (
      !urlText ||
      !key ||
      key.length > 16384 ||
      /\s/.test(key) ||
      /[?#]/.test(urlText)
    )
      throw new Error();
    const url = new URL(urlText);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error();
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      throw new Error();
    // Never silently accept an administrative key in the public-key setting.
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
      const pieces = key.split('.');
      if (pieces.length !== 3 || !pieces[1]) throw new Error();
      const claims: unknown = JSON.parse(
        Buffer.from(pieces[1], 'base64url').toString('utf8'),
      );
      if (
        !claims ||
        typeof claims !== 'object' ||
        !('role' in claims) ||
        claims.role !== 'anon'
      )
        throw new Error();
    }
    return { url: url.origin, key };
  } catch {
    throw new SyncError(
      'Cloud configuration requires a project URL and a public anon or publishable key.',
      'SYNC_CONFIG',
      503,
    );
  }
}

/** Server-only Auth. The SDK has in-memory storage; the only durable credentials
 * are this project-bound, private file. Public state never contains a token. */
export class SyncAuth {
  readonly configured: boolean;
  readonly projectId: string;
  #directory: string;
  #filename: string;
  #client: SupabaseClient | null = null;
  #session: SavedSession | null = null;
  #state: SyncStatus['auth'] = 'unconfigured';
  #error: SyncProblem | null = null;
  #subscription: { unsubscribe(): void } | null = null;
  #initialized: Promise<void> | null = null;
  #operations: Promise<void> = Promise.resolve();
  #writes: Promise<void> = Promise.resolve();
  #signingOut = false;
  #closed = false;
  #closing: Promise<void> | null = null;
  #requests = new AbortController();

  constructor(paths: UserPaths, environment: NodeJS.ProcessEnv = process.env) {
    this.#directory = join(paths.data, 'sync');
    this.#filename = join(this.#directory, 'auth.json');
    let config: ReturnType<typeof configuration>;
    try {
      config = configuration(environment);
    } catch {
      config = null;
      this.#error = problem(
        'SYNC_CONFIG',
        'Cloud configuration requires a project URL and a public anon or publishable key.',
      );
    }
    this.configured = config !== null;
    this.projectId = config
      ? createHash('sha256').update(config.url).digest('hex')
      : '';
    if (!config) return;
    this.#state = 'signed-out';
    this.#client = createClient(config.url, config.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: `cura-${this.projectId}-${randomUUID()}`,
        debug: false,
      },
      global: {
        fetch: async (input, init) => {
          const address = new URL(
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
          );
          const timeout = AbortSignal.timeout(
            address.pathname.startsWith('/storage/') ? 120_000 : 30_000,
          );
          const signal = AbortSignal.any([
            this.#requests.signal,
            timeout,
            ...(init?.signal ? [init.signal] : []),
          ]);
          // A thrown fetch error makes the Auth SDK retry refreshes. A terminal
          // cancellation response stops that retry loop without revoking tokens.
          const cancelled = () =>
            new Response('{"message":"Cloud synchronization was cancelled."}', {
              status: 499,
              headers: { 'content-type': 'application/json' },
            });
          if (this.#requests.signal.aborted) return cancelled();
          try {
            const response = await fetch(input, {
              ...init,
              signal,
              redirect: 'error',
            });
            if (address.pathname.startsWith('/auth/') && !response.ok) {
              if (
                !this.#closed &&
                address.searchParams.get('grant_type') === 'refresh_token'
              ) {
                const transient =
                  response.status === 429 || response.status >= 500;
                this.#state = transient ? 'offline' : 'expired';
                this.#error = transient ? offline() : expired();
              }
              // Provider error bodies can echo credentials. Keep them away
              // from SDK diagnostics and return only a stable public message.
              await response.body?.cancel();
              return new Response(
                '{"message":"Cloud authentication request failed."}',
                {
                  status: response.status,
                  headers: { 'content-type': 'application/json' },
                },
              );
            }
            return response;
          } catch {
            if (this.#requests.signal.aborted) return cancelled();
            if (!this.#closed && address.pathname.startsWith('/auth/')) {
              this.#state = 'offline';
              this.#error = offline();
            }
            // Auth SDK may log transport failures. Never propagate URL/header/body
            // details or a request object into its error surface.
            throw new Error('Cloud connection is unavailable.');
          }
        },
      },
    });
    this.#subscription = this.#client.auth.onAuthStateChange(
      (event, session) => {
        if (this.#closed || this.#signingOut || event === 'INITIAL_SESSION')
          return;
        if (session) this.#accept(session);
        else if (event === 'SIGNED_OUT' && this.#session) {
          this.#state = 'expired';
          this.#error = expired();
        }
      },
    ).data.subscription;
  }

  status(): {
    auth: SyncStatus['auth'];
    account: SyncAccount | null;
    error: SyncProblem | null;
  } {
    if (
      this.#state === 'signed-in' &&
      this.#session &&
      this.#session.expiresAt * 1000 <= Date.now()
    ) {
      this.#state = 'expired';
      this.#error = expired();
    }
    return {
      auth: this.#state,
      account: this.#session ? { ...this.#session.account } : null,
      error: this.#error ? { ...this.#error } : null,
    };
  }

  initialize(): Promise<void> {
    this.#initialized ??= this.#initialize();
    return this.#initialized;
  }

  async #initialize(): Promise<void> {
    if (!this.#client || this.#closed) return;
    try {
      await this.#privateDirectory();
      const handle = await open(
        this.#filename,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let text: string;
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > 65536) throw new Error();
        await handle.chmod(0o600);
        text = await handle.readFile('utf8');
      } finally {
        await handle.close();
      }
      const saved = parseSession(JSON.parse(text));
      if (saved.projectId !== this.projectId) {
        this.#error = problem(
          'SYNC_AUTH_PROJECT',
          'Saved sign-in belongs to a different cloud project. Sign in to this project.',
        );
        return;
      }
      if (this.#requests.signal.aborted) return;
      this.#session = saved;
      const { data, error } = await this.#client.auth.setSession({
        access_token: saved.accessToken,
        refresh_token: saved.refreshToken,
      });
      if (error || !data.session) this.#authFailure(error, false);
      else this.#accept(data.session);
      await this.#writes;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return;
      this.#error = storageError();
      this.#state = this.#session ? 'offline' : 'signed-out';
    }
  }

  async signIn(input: SyncSignIn): Promise<void> {
    await this.initialize();
    return this.#serialize(async () => {
      const client = this.#requireConfigured();
      const parsed = SyncSignInSchema.safeParse(input);
      if (!parsed.success)
        throw new SyncError(
          'Enter a valid email address and password.',
          'SYNC_AUTH_FAILED',
          400,
        );
      const { data, error } = await client.auth.signInWithPassword(parsed.data);
      if (error || !data.session) throw this.#authFailure(error, true);
      this.#accept(data.session);
      await this.#writes;
      this.#checkPersistence();
    });
  }

  async refresh(): Promise<void> {
    await this.initialize();
    return this.#serialize(async () => {
      const client = this.#requireConfigured();
      if (!this.#session)
        throw new SyncError(
          'Sign in to use cloud sync.',
          'SYNC_AUTH_REQUIRED',
          401,
        );
      const { data, error } = await client.auth.refreshSession({
        refresh_token: this.#session.refreshToken,
      });
      if (error || !data.session) throw this.#authFailure(error, false);
      this.#accept(data.session);
      await this.#writes;
      this.#checkPersistence();
    });
  }

  async signOut(): Promise<void> {
    await this.initialize();
    return this.#serialize(async () => {
      this.#signingOut = true;
      try {
        // Local-scope revocation preserves other devices' independent sessions.
        if (this.#client) await this.#client.auth.signOut({ scope: 'local' });
      } finally {
        this.#session = null;
        this.#state = this.configured ? 'signed-out' : 'unconfigured';
        this.#error = null;
        await this.#persist(null);
        this.#signingOut = false;
      }
      this.#checkPersistence();
    });
  }

  client(): SupabaseClient {
    const client = this.#requireConfigured();
    const status = this.status();
    if (status.auth === 'expired')
      throw new SyncError(expired().error, 'SYNC_AUTH_EXPIRED', 401);
    if (status.auth === 'offline')
      throw new SyncError(offline().error, 'SYNC_OFFLINE', 503);
    if (!this.#session || status.auth !== 'signed-in')
      throw new SyncError(
        'Sign in to use cloud sync.',
        'SYNC_AUTH_REQUIRED',
        401,
      );
    return client;
  }

  close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    this.#requests.abort();
    await this.#client?.auth.stopAutoRefresh();
    await this.#initialized;
    await this.#operations;
    if (this.#client) {
      // Drain SDK initialization/refresh and persistence before detaching the
      // callback, so an already completed token rotation is retained on disk.
      await this.#client.auth.getSession();
      await this.#client.auth.stopAutoRefresh();
      await this.#client.removeAllChannels();
    }
    this.#closed = true;
    this.#subscription?.unsubscribe();
    await this.#writes;
  }

  #requireConfigured(): SupabaseClient {
    if (this.#requests.signal.aborted)
      throw new SyncError(
        'Cloud synchronization was cancelled.',
        'SYNC_CANCELLED',
        499,
      );
    if (!this.#client || this.#closed)
      throw new SyncError('Cloud sync is not configured.', 'SYNC_CONFIG', 503);
    return this.#client;
  }

  #serialize(action: () => Promise<void>): Promise<void> {
    const operation = this.#operations.then(() => {
      if (this.#requests.signal.aborted)
        throw new SyncError(
          'Cloud synchronization was cancelled.',
          'SYNC_CANCELLED',
          499,
        );
      return action();
    });
    this.#operations = operation.catch(() => {});
    return operation;
  }

  #accept(session: Session): void {
    this.#session = parseSession({
      version: 1,
      projectId: this.projectId,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at ?? 0,
      account: { id: session.user.id, email: session.user.email ?? null },
    });
    this.#state = 'signed-in';
    this.#error = null;
    void this.#persist(this.#session);
  }

  #authFailure(error: unknown, signingIn: boolean): SyncError {
    if (this.#requests.signal.aborted)
      return new SyncError(
        'Cloud synchronization was cancelled.',
        'SYNC_CANCELLED',
        499,
      );
    const status =
      error && typeof error === 'object' && 'status' in error
        ? error.status
        : undefined;
    const transient =
      typeof status !== 'number' ||
      status === 0 ||
      status === 429 ||
      status >= 500;
    if (transient) {
      this.#state = 'offline';
      this.#error = offline();
      return new SyncError(this.#error.error, this.#error.code, 503);
    }
    if (signingIn) {
      this.#state = this.#session ? 'signed-in' : 'signed-out';
      this.#error = problem(
        'SYNC_AUTH_FAILED',
        'Cloud sign-in failed. Check the email and password.',
      );
    } else {
      this.#state = 'expired';
      this.#error = expired();
    }
    return new SyncError(this.#error.error, this.#error.code, 401);
  }

  async #privateDirectory(): Promise<void> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.#directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error();
    await chmod(this.#directory, 0o700);
  }

  #persist(session: SavedSession | null): Promise<void> {
    // Capture the exact event payload, so delayed writes cannot resurrect a
    // later sign-out or overwrite a newer refresh token.
    const body = session ? JSON.stringify(session) : null;
    this.#writes = this.#writes.then(async () => {
      const temporary = join(this.#directory, `.auth-${randomUUID()}.part`);
      try {
        await this.#privateDirectory();
        if (body === null) await rm(this.#filename, { force: true });
        else {
          const handle = await open(temporary, 'wx', 0o600);
          try {
            await handle.writeFile(body, 'utf8');
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rename(temporary, this.#filename);
          await chmod(this.#filename, 0o600);
        }
      } catch {
        this.#error = storageError();
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
    });
    return this.#writes;
  }

  #checkPersistence(): void {
    if (this.#error?.code === 'SYNC_AUTH_STORAGE')
      throw new SyncError(this.#error.error, this.#error.code, 500);
  }
}
