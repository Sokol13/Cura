import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

// Explicit opt-in: this suite resets ONLY Cura's sync schema and own policies
// on a disposable loopback Supabase stack. It never resets Auth or other apps.
const configPath = process.env.CURA_SYNC_TEST_STATUS;
const cloud = configPath ? describe : describe.skip;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RecordValue = { [key: string]: Json };
type Session = { token: string; userId: string; refreshToken: string };
type Change = {
  kind: string;
  key: string;
  expectedRevision: string;
  payload: RecordValue | null;
  tombstone: boolean;
};

cloud('real local Supabase sync protocol', () => {
  let apiUrl: string;
  let anonKey: string;
  let owner: Session;
  let editor: Session;
  let viewer: Session;
  let outsider: Session;
  const libraryId = randomUUID();
  const otherLibraryId = randomUUID();
  const createOperation = randomUUID();
  const folderId = randomUUID();
  const createdAt = '2026-10-04T00:00:00.000Z';

  function sql(statement: string): string {
    return execFileSync(
      'docker',
      [
        'exec',
        '-i',
        process.env.CURA_SYNC_TEST_CONTAINER ?? 'supabase_db_cura-supabase-dev',
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-At',
      ],
      { input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  }

  async function request(
    path: string,
    token?: string,
    body?: Json,
    method = 'POST',
  ) {
    return fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token ?? anonKey}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function rpc(
    name: string,
    session: Session | undefined,
    body: RecordValue = {},
  ) {
    const response = await request(
      `/rest/v1/rpc/cura_sync_${name}`,
      session?.token,
      body,
    );
    const value: unknown = await response.json();
    return { status: response.status, value: value as RecordValue };
  }

  async function ok(name: string, session: Session, body: RecordValue = {}) {
    const result = await rpc(name, session, body);
    expect(result.status, JSON.stringify(result.value)).toBe(200);
    return result.value;
  }

  async function signup(label: string): Promise<Session> {
    const credentials = {
      email: `cura-sync-${label}-${randomUUID()}@example.test`,
      password: randomBytes(24).toString('base64url'),
    };
    const signupResponse = await request(
      '/auth/v1/signup',
      undefined,
      credentials,
    );
    expect(signupResponse.status).toBe(200);
    const login = await request(
      '/auth/v1/token?grant_type=password',
      undefined,
      credentials,
    );
    expect(login.status).toBe(200);
    const value = (await login.json()) as {
      access_token: string;
      refresh_token: string;
      user: { id: string };
    };
    return {
      token: value.access_token,
      userId: value.user.id,
      refreshToken: value.refresh_token,
    };
  }

  function change(
    kind: string,
    id: string,
    data: RecordValue,
    revision = '0',
  ): Change {
    return {
      kind,
      key: id,
      expectedRevision: revision,
      tombstone: false,
      payload: { kind, id, libraryId, data },
    };
  }

  function folder(name: string, revision: string): Change {
    return change(
      'folder',
      folderId,
      {
        id: folderId,
        libraryId,
        name,
        parentId: null,
        createdAt,
        updatedAt: createdAt,
      },
      revision,
    );
  }

  async function commit(
    changes: Change[],
    session = owner,
    operationId = randomUUID(),
  ) {
    return rpc('commit', session, {
      p_library_id: libraryId,
      p_operation_id: operationId,
      p_changes: changes as unknown as Json[],
    });
  }

  beforeAll(async () => {
    const configuration = JSON.parse(readFileSync(configPath!, 'utf8')) as {
      API_URL: string;
      ANON_KEY: string;
    };
    const url = new URL(configuration.API_URL);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error(
        'Sync integration tests require a disposable loopback Supabase URL.',
      );
    }
    apiUrl = url.origin;
    anonKey = configuration.ANON_KEY;
    const migrationDirectory = fileURLToPath(
      new URL('../../../supabase/migrations/', import.meta.url),
    );
    const migrations = readdirSync(migrationDirectory).filter((name) =>
      name.endsWith('_cura_sync_protocol.sql'),
    );
    expect(migrations).toHaveLength(1);
    const migration = readFileSync(
      `${migrationDirectory}/${migrations[0]}`,
      'utf8',
    );
    sql(`drop schema if exists cura_sync cascade;
      drop policy if exists cura_sync_objects_read on storage.objects;
      drop policy if exists cura_sync_objects_insert on storage.objects;
      ${migration}`);
    // PostgREST reload is asynchronous; wait boundedly for the new endpoint.
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await request(
        '/rest/v1/rpc/cura_sync_libraries',
        undefined,
        {},
      );
      if (response.status !== 404) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    [owner, editor, viewer, outsider] = await Promise.all([
      signup('owner'),
      signup('editor'),
      signup('viewer'),
      signup('outsider'),
    ]);
  }, 30_000);

  it('uses private RLS tables, narrow invoker RPCs and immutable ownership', () => {
    const tables = JSON.parse(
      sql(`select json_agg(json_build_object('name', c.relname, 'rls', c.relrowsecurity))
      from pg_class c join pg_namespace n on c.relnamespace=n.oid
      where n.nspname='cura_sync' and c.relkind='r'`),
    ) as { name: string; rls: boolean }[];
    expect(tables).toHaveLength(4);
    expect(tables.every((table) => table.rls)).toBe(true);
    expect(
      sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'cura_sync_%' and p.prosecdef`),
    ).toBe('0');
    expect(
      sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='cura_sync' and p.prosecdef`),
    ).toBe('1');
    expect(
      sql(
        `select has_function_privilege('anon','public.cura_sync_libraries()','EXECUTE')`,
      ),
    ).toBe('f');
  });

  it('creates a retry-safe hidden bootstrap and denies anonymous or outsider access', async () => {
    const body = {
      p_library_id: libraryId,
      p_name: 'Shared library',
      p_operation_id: createOperation,
    };
    const created = await ok('create_library', owner, body);
    expect((created.library as RecordValue).head).toBe('0');
    expect((created.library as RecordValue).createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect((created.library as RecordValue).published).toBe(false);
    expect(await ok('create_library', owner, body)).toEqual(created);
    expect(
      (await rpc('create_library', owner, { ...body, p_name: 'Different' }))
        .value.message,
    ).toBe('CURA_SYNC_OPERATION_MISMATCH');
    expect((await rpc('libraries', undefined)).status).toBe(401);
    expect((await ok('libraries', outsider)).libraries).toEqual([]);
    expect(
      (await rpc('manifest', outsider, { p_library_id: libraryId })).status,
    ).toBe(403);
    await ok('set_member', owner, {
      p_library_id: libraryId,
      p_user_id: editor.userId,
      p_role: 'editor',
    });
    await ok('set_member', owner, {
      p_library_id: libraryId,
      p_user_id: viewer.userId,
      p_role: 'viewer',
    });
    expect((await ok('libraries', editor)).libraries).toEqual([]);
    expect(
      (await rpc('manifest', editor, { p_library_id: libraryId })).status,
    ).toBe(403);
    expect((await commit([folder('Premature', '0')])).value.message).toBe(
      'CURA_SYNC_BOOTSTRAP_REQUIRED',
    );
    expect(
      (await ok('manifest', owner, { p_library_id: libraryId })).records,
    ).toEqual([]);
    expect(() =>
      sql(`begin; set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${owner.userId}","role":"authenticated"}', true);
      update cura_sync.libraries set owner_id='${outsider.userId}' where id='${libraryId}'; commit;`),
    ).toThrow();
    expect(
      (
        await rpc('set_member', owner, {
          p_library_id: libraryId,
          p_user_id: owner.userId,
          p_role: 'viewer',
        })
      ).status,
    ).toBe(400);
  });

  it('publishes a complete graph atomically and returns exact idempotent commit acknowledgments', async () => {
    const operationId = randomUUID();
    const changes = [
      change('library', libraryId, {
        id: libraryId,
        name: 'Shared library',
        createdAt,
        updatedAt: createdAt,
      }),
      folder('Initial', '0'),
    ];
    const first = await commit(changes, owner, operationId);
    expect(first.status, JSON.stringify(first.value)).toBe(200);
    expect(first.value.sequence).toBe('1');
    expect(
      (first.value.changes as RecordValue[]).map((item) => item.revision),
    ).toEqual(['1', '1']);
    expect(await commit(changes, owner, operationId)).toEqual(first);
    expect(
      (await commit([folder('Wrong retry', '0')], owner, operationId)).value
        .message,
    ).toBe('CURA_SYNC_OPERATION_MISMATCH');
    expect((await ok('libraries', editor)).libraries).toHaveLength(1);
    expect((await ok('libraries', viewer)).libraries).toHaveLength(1);
    const manifest = await ok('manifest', viewer, { p_library_id: libraryId });
    expect(manifest.sequence).toBe('1');
    expect(manifest.records).toHaveLength(2);
    const members = await ok('members', viewer, { p_library_id: libraryId });
    expect(
      (members.members as RecordValue[]).map((member) => member.role).sort(),
    ).toEqual(['editor', 'owner', 'viewer']);
  });

  it('rejects direct REST CRUD, viewer writes, editor membership changes and cross-library envelopes', async () => {
    for (const table of ['libraries', 'members', 'records', 'commits']) {
      const response = await request(
        `/rest/v1/${table}`,
        owner.token,
        undefined,
        'GET',
      );
      expect(response.status).toBe(404);
      const privateResponse = await fetch(`${apiUrl}/rest/v1/${table}`, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${owner.token}`,
          'Accept-Profile': 'cura_sync',
        },
      });
      expect(privateResponse.status).toBe(406);
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        const mutation = await request(
          `/rest/v1/${table}`,
          owner.token,
          {},
          method,
        );
        expect(mutation.status).toBe(404);
      }
    }
    expect((await commit([folder('Forbidden', '1')], viewer)).status).toBe(403);
    expect((await commit([folder('Forbidden', '1')], outsider)).status).toBe(
      403,
    );
    expect(
      (
        await rpc('set_member', editor, {
          p_library_id: libraryId,
          p_user_id: outsider.userId,
          p_role: 'editor',
        })
      ).status,
    ).toBe(403);
    const wrongLibrary = folder('Wrong library', '1');
    wrongLibrary.payload!.libraryId = otherLibraryId;
    expect((await commit([wrongLibrary])).value.message).toBe(
      'CURA_SYNC_INVALID_PAYLOAD',
    );
    const wrongNested = change('board', randomUUID(), {
      board: { libraryId: otherLibraryId },
    });
    expect((await commit([wrongNested])).value.message).toBe(
      'CURA_SYNC_CROSS_LIBRARY',
    );
    const wrongNestedArray = change('board', randomUUID(), {
      items: [{ libraryId: otherLibraryId }],
    });
    expect((await commit([wrongNestedArray])).value.message).toBe(
      'CURA_SYNC_CROSS_LIBRARY',
    );
    const wrongRevision = {
      ...folder('Numeric revision', '1'),
      expectedRevision: 1,
    };
    expect(
      (
        await rpc('commit', owner, {
          p_library_id: libraryId,
          p_operation_id: randomUUID(),
          p_changes: [wrongRevision],
        })
      ).value.message,
    ).toBe('CURA_SYNC_INVALID_ENVELOPE');
    expect(
      (await commit([folder('Duplicate', '1'), folder('Duplicate', '1')])).value
        .message,
    ).toBe('CURA_SYNC_DUPLICATE_KEY');
  });

  it('rejects stale CAS without partial writes and paginates whole commits', async () => {
    const added = randomUUID();
    const first = await commit(
      [
        folder('Edited', '1'),
        change('tagGroup', added, {
          id: added,
          libraryId,
          name: 'Tags',
          createdAt,
          updatedAt: createdAt,
        }),
      ],
      editor,
    );
    expect(first.status).toBe(200);
    expect(first.value.sequence).toBe('2');
    const rejectedId = randomUUID();
    const stale = await commit([
      folder('Stale', '1'),
      change('tagGroup', rejectedId, { libraryId }),
    ]);
    expect(stale.value.message).toBe('CURA_SYNC_CONFLICT');
    const details = JSON.parse(stale.value.details as string) as RecordValue[];
    expect(details[0]?.actualRevision).toBe('2');
    const manifest = await ok('manifest', owner, { p_library_id: libraryId });
    expect(manifest.records).toHaveLength(3);
    expect(manifest.sequence).toBe('2');
    const page1 = await ok('pull', viewer, {
      p_library_id: libraryId,
      p_after: '0',
      p_limit: 1,
    });
    expect(page1.cursor).toBe('1');
    expect(page1.hasMore).toBe(true);
    expect((page1.commits as RecordValue[])[0]?.changes as Json[]).toHaveLength(
      2,
    );
    const page2 = await ok('pull', viewer, {
      p_library_id: libraryId,
      p_after: page1.cursor!,
      p_limit: 1,
    });
    expect(page2.cursor).toBe('2');
    expect(page2.hasMore).toBe(false);
    expect((page2.commits as RecordValue[])[0]?.changes as Json[]).toHaveLength(
      2,
    );
    expect(
      (
        await rpc('pull', owner, {
          p_library_id: libraryId,
          p_after: '3',
          p_limit: 1,
        })
      ).value.message,
    ).toBe('CURA_SYNC_INVALID_CURSOR');
  });

  it('serializes concurrent sequence allocation and has no cursor gaps', async () => {
    const start = await ok('manifest', owner, { p_library_id: libraryId });
    const commits = await Promise.all(
      Array.from({ length: 8 }, (_, index) => {
        const id = randomUUID();
        return commit(
          [
            change('activity', id, {
              id,
              libraryId,
              action: `Concurrent ${index}`,
              createdAt,
              updatedAt: createdAt,
            }),
          ],
          index % 2 ? editor : owner,
        );
      }),
    );
    expect(commits.map((result) => result.status)).toEqual(Array(8).fill(200));
    expect(
      commits
        .map((result) => Number(result.value.sequence))
        .sort((a, b) => a - b),
    ).toEqual(
      Array.from(
        { length: 8 },
        (_, index) => Number(start.sequence) + index + 1,
      ),
    );
    const pull = await ok('pull', viewer, {
      p_library_id: libraryId,
      p_after: start.sequence!,
      p_limit: 100,
    });
    expect(pull.commits).toHaveLength(8);
    expect(pull.cursor).toBe(pull.head);
    // Two writers at the same revision: exactly one commits, the other sees
    // the newly committed row after waiting for the per-library lock.
    const competing = await Promise.all([
      commit([folder('One', '2')]),
      commit([folder('Two', '2')], editor),
    ]);
    expect(competing.map((result) => result.status).sort()).toEqual([200, 400]);
    expect(
      competing.find((result) => result.status === 400)?.value.message,
    ).toBe('CURA_SYNC_CONFLICT');
  });

  it('holds later commits behind a lower uncommitted sequence while readers keep the old cursor', async () => {
    const before = await ok('manifest', viewer, { p_library_id: libraryId });
    const slowOperation = randomUUID();
    sql(`create function cura_sync.test_delay() returns trigger language plpgsql set search_path='' as $$
      begin if new.operation_id='${slowOperation}'::uuid then perform pg_sleep(0.8); end if; return new; end $$;
      create trigger test_delay before insert on cura_sync.commits for each row execute function cura_sync.test_delay();`);
    try {
      const first = commit(
        [
          change('activity', randomUUID(), {
            libraryId,
            action: 'Slow commit',
          }),
        ],
        owner,
        slowOperation,
      );
      let sleeping = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        sleeping =
          sql(
            "select count(*) from pg_stat_activity where wait_event='PgSleep'",
          ) !== '0';
        if (sleeping) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(sleeping).toBe(true);
      let secondFinished = false;
      const second = commit(
        [
          change('activity', randomUUID(), {
            libraryId,
            action: 'Following commit',
          }),
        ],
        editor,
      ).then((value) => {
        secondFinished = true;
        return value;
      });
      const during = await ok('pull', viewer, {
        p_library_id: libraryId,
        p_after: before.sequence!,
        p_limit: 100,
      });
      expect(during.cursor).toBe(before.sequence);
      expect(during.commits).toEqual([]);
      expect(secondFinished).toBe(false);
      const [one, two] = await Promise.all([first, second]);
      expect(one.status).toBe(200);
      expect(two.status).toBe(200);
      expect(BigInt(two.value.sequence as string)).toBe(
        BigInt(one.value.sequence as string) + 1n,
      );
      const after = await ok('pull', viewer, {
        p_library_id: libraryId,
        p_after: before.sequence!,
        p_limit: 100,
      });
      expect(
        (after.commits as RecordValue[]).map((item) => item.sequence),
      ).toEqual([one.value.sequence, two.value.sequence]);
    } finally {
      sql(
        'drop trigger test_delay on cura_sync.commits; drop function cura_sync.test_delay();',
      );
    }
  });

  it('preserves integers above JavaScript precision and rejects bounded requests explicitly', async () => {
    await ok('create_library', owner, {
      p_library_id: otherLibraryId,
      p_name: 'Precision fixture',
      p_operation_id: randomUUID(),
    });
    const initial = {
      kind: 'library',
      key: otherLibraryId,
      expectedRevision: '0',
      tombstone: false,
      payload: {
        kind: 'library',
        id: otherLibraryId,
        libraryId: otherLibraryId,
        data: {
          id: otherLibraryId,
          name: 'Precision fixture',
          createdAt,
          updatedAt: createdAt,
        },
      },
    };
    await ok('commit', owner, {
      p_library_id: otherLibraryId,
      p_operation_id: randomUUID(),
      p_changes: [initial],
    });
    sql(`update cura_sync.libraries set head=9007199254740993 where id='${otherLibraryId}';
      update cura_sync.records set revision=9007199254740993 where library_id='${otherLibraryId}';`);
    const result = await ok('commit', owner, {
      p_library_id: otherLibraryId,
      p_operation_id: randomUUID(),
      p_changes: [{ ...initial, expectedRevision: '9007199254740993' }],
    });
    expect(result.sequence).toBe('9007199254740994');
    expect((result.changes as RecordValue[])[0]?.revision).toBe(
      '9007199254740994',
    );
    expect(
      (
        await ok('pull', owner, {
          p_library_id: otherLibraryId,
          p_after: '9007199254740993',
          p_limit: 1,
        })
      ).cursor,
    ).toBe('9007199254740994');
    const tooMany = await commit(
      Array.from({ length: 10001 }, () => folder('Limit', '4')),
    );
    expect(tooMany.value.message).toBe('CURA_SYNC_LIMIT');
    const tooLarge = await commit([
      change('activity', randomUUID(), { note: 'x'.repeat(16777216) }),
    ]);
    expect(tooLarge.value.message).toBe('CURA_SYNC_LIMIT');
    sql(`insert into cura_sync.records(library_id,kind,key,revision,payload,tombstone)
      select '${otherLibraryId}', 'activity', gen_random_uuid(), 1, null, true from generate_series(1,10000);`);
    expect(
      (await rpc('manifest', owner, { p_library_id: otherLibraryId })).value
        .message,
    ).toBe('CURA_SYNC_LIMIT');
  });

  it('retains hard-delete tombstones and allows user JSON with a literal libraryId', async () => {
    const removed = await commit([
      {
        kind: 'folder',
        key: folderId,
        expectedRevision: '3',
        payload: null,
        tombstone: true,
      },
    ]);
    expect(removed.status).toBe(200);
    const record = (removed.value.changes as RecordValue[])[0];
    expect(record?.revision).toBe('4');
    expect(record?.payload).toBeNull();
    expect(record?.tombstone).toBe(true);
    const id = randomUUID();
    const asset = change('asset', id, {
      asset: { id, libraryId, params: { libraryId: 'user metadata' } },
    });
    expect((await commit([asset])).status).toBe(200);
    const invalidLibraryDelete = {
      kind: 'library',
      key: libraryId,
      expectedRevision: '1',
      payload: null,
      tombstone: true,
    };
    expect((await commit([invalidLibraryDelete])).value.message).toBe(
      'CURA_SYNC_INVALID_TOMBSTONE',
    );
  });

  it('enforces private content-addressed immutable Storage for every role', async () => {
    const bytes = Buffer.from('Immutable Cura object bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const objectName = `${libraryId}/${hash}`;
    async function upload(session: Session, name: string, upsert = false) {
      return fetch(`${apiUrl}/storage/v1/object/cura-sync-objects/${name}`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/octet-stream',
          'x-upsert': String(upsert),
        },
        body: bytes,
      });
    }
    async function download(token = anonKey) {
      return fetch(
        `${apiUrl}/storage/v1/object/authenticated/cura-sync-objects/${objectName}`,
        {
          headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
        },
      );
    }
    expect((await upload(editor, objectName)).status).toBe(200);
    for (const session of [owner, editor, viewer]) {
      const response = await download(session.token);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    }
    for (const token of [anonKey, outsider.token])
      expect((await download(token)).ok).toBe(false);
    for (const session of [owner, editor, viewer, outsider]) {
      expect((await upload(session, objectName, true)).ok).toBe(false);
    }
    expect((await upload(viewer, `${libraryId}/${'a'.repeat(64)}`)).ok).toBe(
      false,
    );
    expect((await upload(outsider, `${libraryId}/${'b'.repeat(64)}`)).ok).toBe(
      false,
    );
    expect((await upload(owner, `${randomUUID()}/${'c'.repeat(64)}`)).ok).toBe(
      false,
    );
    expect((await upload(owner, `${libraryId}/wrong-hash`)).ok).toBe(false);
    expect((await upload(owner, `${libraryId}/${hash}/extra`)).ok).toBe(false);
    const removed = await request(
      '/storage/v1/object/cura-sync-objects',
      owner.token,
      { prefixes: [objectName] },
      'DELETE',
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual([]);
    expect((await download(owner.token)).status).toBe(200);
    const publicDownload = await fetch(
      `${apiUrl}/storage/v1/object/public/cura-sync-objects/${objectName}`,
    );
    expect(publicDownload.ok).toBe(false);
  });

  it('revokes access immediately using membership rows and keeps local-scope sessions independent', async () => {
    sql(`create function cura_sync.test_revoke_delay() returns trigger language plpgsql set search_path='' as $$
      begin perform pg_sleep(0.6); return old; end $$;
      create trigger test_revoke_delay before delete on cura_sync.members
      for each row execute function cura_sync.test_revoke_delay();`);
    try {
      const revoked = ok('set_member', owner, {
        p_library_id: libraryId,
        p_user_id: editor.userId,
        p_role: null,
      });
      let sleeping = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        sleeping =
          sql(
            "select count(*) from pg_stat_activity where wait_event='PgSleep'",
          ) !== '0';
        if (sleeping) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(sleeping).toBe(true);
      const waitingWriter = commit([folder('Racing revocation', '4')], editor);
      await revoked;
      expect((await waitingWriter).status).toBe(403);
    } finally {
      sql(
        'drop trigger test_revoke_delay on cura_sync.members; drop function cura_sync.test_revoke_delay();',
      );
    }
    expect((await ok('libraries', editor)).libraries).toEqual([]);
    expect(
      (await rpc('manifest', editor, { p_library_id: libraryId })).status,
    ).toBe(403);
    expect(
      (await rpc('pull', editor, { p_library_id: libraryId, p_after: '0' }))
        .status,
    ).toBe(403);
    expect((await commit([folder('Revoked', '4')], editor)).status).toBe(403);
    await ok('set_member', owner, {
      p_library_id: libraryId,
      p_user_id: viewer.userId,
      p_role: 'editor',
    });
    expect(
      (await commit([folder('Restored by promoted member', '4')], viewer))
        .status,
    ).toBe(200);
    const refreshed = await request(
      '/auth/v1/token?grant_type=refresh_token',
      undefined,
      { refresh_token: owner.refreshToken },
    );
    expect(refreshed.status).toBe(200);
    const refreshedSession = (await refreshed.json()) as {
      access_token: string;
    };
    const signedOut = await request(
      '/auth/v1/logout?scope=local',
      refreshedSession.access_token,
    );
    expect(signedOut.status).toBe(204);
    const viewerRefresh = await request(
      '/auth/v1/token?grant_type=refresh_token',
      undefined,
      { refresh_token: viewer.refreshToken },
    );
    expect(viewerRefresh.status).toBe(200);
  });
});
