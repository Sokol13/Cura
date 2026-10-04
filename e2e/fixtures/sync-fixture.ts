import { readFileSync } from 'node:fs';
import { IdSchema, SyncSignInSchema } from '../../packages/shared/src/index.js';

type Account = { id: string; email: string; password: string };
type Fixture = {
  url: string;
  anonKey: string;
  accounts: Record<'owner' | 'editor' | 'viewer' | 'outsider', Account>;
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid private sync fixture shape.');
  return value as Record<string, unknown>;
}

// Never include credential values or validation issues in test reports.
export function syncFixture(): Fixture {
  const path = process.env.CURA_SYNC_E2E_FIXTURE;
  if (!path)
    throw new Error('CURA_SYNC_E2E_FIXTURE must name a private fixture file.');
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Cannot read the private sync fixture.');
  }
  const value = record(input),
    accounts = record(value.accounts);
  if (
    typeof value.url !== 'string' ||
    typeof value.anonKey !== 'string' ||
    !value.anonKey
  )
    throw new Error('Invalid private sync fixture shape.');
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw new Error('Invalid private sync fixture URL.');
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error(
      'Configured acceptance requires a disposable local Supabase.',
    );
  for (const name of ['owner', 'editor', 'viewer', 'outsider']) {
    const account = record(accounts[name]);
    if (
      !IdSchema.safeParse(account.id).success ||
      !SyncSignInSchema.safeParse({
        email: account.email,
        password: account.password,
      }).success
    )
      throw new Error('Invalid private sync fixture account.');
  }
  return {
    url: value.url,
    anonKey: value.anonKey,
    accounts: accounts as Fixture['accounts'],
  };
}
export const syncPort = Number(process.env.CURA_E2E_PORT ?? 4342);
