import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  AssetSchema,
  AssetPageSchema,
  LibrarySchema,
  SyncConflictDetailSchema,
  SyncMembersSchema,
  SyncStatusSchema,
} from '../packages/shared/src/index.js';
import { syncFixture, syncPort } from './fixtures/sync-fixture.js';

const fixture = syncFixture();
const base = (offset: number) => `http://127.0.0.1:${syncPort + offset}`;
const original = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><rect width="128" height="96" fill="#e28142"/></svg>',
);
const originalHash = createHash('sha256').update(original).digest('hex');
async function status(api: APIRequestContext) {
  return SyncStatusSchema.parse(
    await (await api.get('/api/sync/status')).json(),
  );
}
async function settle(api: APIRequestContext, libraryId: string) {
  await expect
    .poll(
      async () => {
        const link = (await status(api)).links.find(
          (item) => item.libraryId === libraryId,
        );
        if (link && ['error', 'blocked', 'offline'].includes(link.state))
          throw new Error(
            `Sync entered ${link.state}: ${link.lastError?.code ?? 'UNKNOWN'}`,
          );
        return Boolean(
          link?.materialized && link.state === 'idle' && link.lastSyncedAt,
        );
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}
async function signIn(page: Page, account: typeof fixture.accounts.owner) {
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Sign out on this device', exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
}
async function refresh(page: Page) {
  await page
    .getByRole('button', { name: 'Refresh status', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Refresh status', exact: true }),
  ).toBeEnabled();
}
async function pause(page: Page, name: string) {
  const card = page.getByRole('article', { name, exact: true });
  await card.getByRole('button', { name: 'Pause sync', exact: true }).click();
  await expect(
    card.getByRole('button', { name: 'Resume sync', exact: true }),
  ).toBeEnabled();
}
async function resume(
  page: Page,
  api: APIRequestContext,
  name: string,
  libraryId: string,
) {
  await page
    .getByRole('article', { name, exact: true })
    .getByRole('button', { name: 'Resume sync', exact: true })
    .click();
  await settle(api, libraryId);
  await refresh(page);
}
async function asset(api: APIRequestContext, id: string) {
  return AssetSchema.parse(await (await api.get(`/api/assets/${id}`)).json());
}

test('two real Cura devices share retained bytes, incremental edits, conflicts and team permissions', async ({
  browser,
  playwright,
}, testInfo) => {
  await testInfo.attach('error-context', {
    body: 'Credential-bearing page snapshots are omitted for this configured acceptance test.',
    contentType: 'text/plain',
  });
  const started = Date.now();
  const contextA = await browser.newContext({ baseURL: base(0) });
  const contextB = await browser.newContext({ baseURL: base(1) });
  const apiA = await playwright.request.newContext({ baseURL: base(0) });
  const apiB = await playwright.request.newContext({ baseURL: base(1) });
  const pageA = await contextA.newPage(),
    pageB = await contextB.newPage();
  const outside: string[] = [];
  for (const context of [contextA, contextB]) {
    await context.route('**/*', async (route) => {
      const origin = new URL(route.request().url()).origin;
      if ([base(0), base(1)].includes(origin)) await route.continue();
      else {
        outside.push(origin);
        await route.abort();
      }
    });
    await context.routeWebSocket('**/*', (socket) => {
      const origin = new URL(socket.url()).origin;
      if (
        [base(0), base(1)]
          .map((value) => value.replace('http:', 'ws:'))
          .includes(origin)
      )
        socket.connectToServer();
      else {
        outside.push(origin);
        socket.close();
      }
    });
  }
  try {
    for (const api of [apiA, apiB]) {
      const initial = await status(api);
      expect(initial.configured).toBe(true);
      expect(initial.auth).toBe('signed-out');
    }
    const library = LibrarySchema.parse(
      await (
        await apiA.post('/api/libraries', {
          data: { name: 'Shared acceptance library' },
        })
      ).json(),
    );
    const placeholder = LibrarySchema.parse(
      await (
        await apiB.post('/api/libraries', {
          data: { name: 'Device B local library' },
        })
      ).json(),
    );
    const uploaded = await apiA.post(
      `/api/libraries/${library.id}/upload?name=original.svg`,
      {
        data: original,
        headers: { 'content-type': 'application/octet-stream' },
      },
    );
    expect(uploaded.ok()).toBe(true);
    await expect
      .poll(
        async () =>
          AssetPageSchema.parse(
            await (
              await apiA.get(`/api/libraries/${library.id}/assets`)
            ).json(),
          ).total,
      )
      .toBe(1);
    const source = AssetPageSchema.parse(
      await (await apiA.get(`/api/libraries/${library.id}/assets`)).json(),
    ).items[0]!;
    expect(source.hash).toBe(originalHash);
    for (const [api, id] of [
      [apiA, library.id],
      [apiB, placeholder.id],
    ] as const)
      expect(
        (
          await api.patch('/api/settings', {
            data: { activeLibraryId: id, language: 'en', theme: 'dark' },
          })
        ).ok(),
      ).toBe(true);
    await pageA.goto('/?workspace=sync');
    await pageB.goto('/?workspace=sync');
    await signIn(pageA, fixture.accounts.owner);
    await pageA
      .getByRole('button', { name: 'Refresh session', exact: true })
      .click();
    await expect(
      pageA.getByRole('button', { name: 'Publish this library', exact: true }),
    ).toBeEnabled();
    await pageA
      .getByRole('button', { name: 'Publish this library', exact: true })
      .click();
    await settle(apiA, library.id);
    await refresh(pageA);
    const cardA = pageA.getByRole('article', {
      name: library.name,
      exact: true,
    });
    await cardA
      .getByRole('button', { name: 'Manage team', exact: true })
      .click();
    const team = pageA.getByRole('dialog', {
      name: 'Team members',
      exact: true,
    });
    const owner = team.getByRole('group', {
      name: fixture.accounts.owner.id,
      exact: true,
    });
    await expect(owner.getByRole('button')).toHaveCount(0);
    for (const [account, role] of [
      [fixture.accounts.editor, 'editor'],
      [fixture.accounts.viewer, 'viewer'],
    ] as const) {
      const form = team.locator('form');
      await form
        .getByLabel('Member account UUID', { exact: true })
        .fill(account.id);
      await form.getByLabel('Member role').selectOption(role);
      await form
        .getByRole('button', { name: 'Add member', exact: true })
        .click();
      await expect(
        team.getByRole('group', { name: account.id, exact: true }),
      ).toBeVisible();
    }
    await team.getByRole('button', { name: 'Close', exact: true }).click();
    await signIn(pageB, fixture.accounts.editor);
    await pageB.getByLabel('Shared library').selectOption(library.id);
    await pageB
      .getByRole('button', { name: 'Join library', exact: true })
      .click();
    await settle(apiB, library.id);
    await refresh(pageB);
    let cardB = pageB.getByRole('article', { name: library.name, exact: true });
    await expect(cardB.getByText('Editor', { exact: true })).toBeVisible();
    await cardB
      .getByRole('button', { name: 'Open library', exact: true })
      .click();
    await expect(
      pageB.getByRole('combobox', { name: 'Library', exact: true }),
    ).toHaveValue(library.id);
    await expect(
      pageB.getByRole('button', { name: 'Select original.svg', exact: true }),
    ).toBeVisible();
    expect((await asset(apiB, source.id)).currentVersionId).toBe(
      source.currentVersionId,
    );
    expect(
      await (
        await apiB.get(`/api/versions/${source.currentVersionId}/file`)
      ).body(),
    ).toEqual(original);
    await pageB
      .getByRole('button', { name: 'Cloud & team', exact: true })
      .click();
    cardB = pageB.getByRole('article', { name: library.name, exact: true });

    // Pause both devices before edits so the periodic worker cannot consume the conflict early.
    await pause(pageA, library.name);
    await pause(pageB, library.name);
    expect(
      (
        await apiA.patch(`/api/assets/${source.id}`, {
          data: { note: 'Incremental baseline' },
        })
      ).ok(),
    ).toBe(true);
    await resume(pageA, apiA, library.name, library.id);
    await resume(pageB, apiB, library.name, library.id);
    expect((await asset(apiB, source.id)).note).toBe('Incremental baseline');
    await pause(pageA, library.name);
    await pause(pageB, library.name);
    expect(
      (
        await apiA.patch(`/api/assets/${source.id}`, {
          data: { note: 'Owner competing note' },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await apiB.patch(`/api/assets/${source.id}`, {
          data: { note: 'Editor local winner' },
        })
      ).ok(),
    ).toBe(true);
    await resume(pageA, apiA, library.name, library.id);
    await pause(pageA, library.name);
    await resume(pageB, apiB, library.name, library.id);
    expect((await asset(apiB, source.id)).note).toBe('Editor local winner');
    await expect(
      cardB.getByRole('button', { name: /View conflicts \([1-9]/ }),
    ).toBeEnabled();
    await cardB.getByRole('button', { name: /View conflicts/ }).click();
    const conflicts = pageB.getByRole('dialog', {
      name: 'Conflicts',
      exact: true,
    });
    await conflicts
      .getByRole('button', { name: 'Inspect conflict', exact: true })
      .first()
      .click();
    for (const name of ['Local snapshot', 'Remote snapshot'])
      await conflicts.locator('summary').filter({ hasText: name }).click();
    await expect(
      conflicts.getByText(/Editor local winner/).first(),
    ).toBeVisible();
    await expect(
      conflicts.getByText(/Owner competing note/).first(),
    ).toBeVisible();
    const downloadPromise = pageB.waitForEvent('download');
    await conflicts
      .getByRole('button', { name: 'Download conflict JSON', exact: true })
      .click();
    const download = await downloadPromise;
    const saved = await download.path();
    expect(saved).not.toBeNull();
    const detail = SyncConflictDetailSchema.parse(
      JSON.parse(await readFile(saved!, 'utf8')),
    );
    expect(detail.resolution).toBe('local-wins');
    expect(JSON.stringify(detail.local)).toContain('Editor local winner');
    expect(JSON.stringify(detail.remote)).toContain('Owner competing note');
    await conflicts.getByRole('button', { name: 'Close', exact: true }).click();

    await pause(pageB, library.name);
    await resume(pageA, apiA, library.name, library.id);
    expect((await asset(apiA, source.id)).note).toBe('Editor local winner');
    await pause(pageA, library.name);
    await cardA
      .getByRole('button', { name: 'Manage team', exact: true })
      .click();
    const editorRow = team.getByRole('group', {
      name: fixture.accounts.editor.id,
      exact: true,
    });
    await editorRow.getByLabel('Member role').selectOption('viewer');
    await editorRow
      .getByRole('button', { name: 'Save role', exact: true })
      .click();
    await expect(editorRow.getByLabel('Member role')).toHaveValue('viewer');
    await expect
      .poll(
        async () =>
          SyncMembersSchema.parse(
            await (
              await apiA.get(`/api/sync/libraries/${library.id}/members`)
            ).json(),
          ).find((member) => member.userId === fixture.accounts.editor.id)
            ?.role,
      )
      .toBe('viewer');
    await team.getByRole('button', { name: 'Close', exact: true }).click();
    expect(
      (
        await apiB.patch(`/api/assets/${source.id}`, {
          data: { note: 'Viewer private edit' },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await apiA.patch(`/api/assets/${source.id}`, { data: { rating: 4 } })
      ).ok(),
    ).toBe(true);
    await resume(pageA, apiA, library.name, library.id);
    await resume(pageB, apiB, library.name, library.id);
    await expect(
      cardB.getByRole('button', { name: 'Download updates', exact: true }),
    ).toBeEnabled();
    await expect(
      cardB.getByRole('button', { name: 'Manage team', exact: true }),
    ).toHaveCount(0);
    const viewerAsset = await asset(apiB, source.id);
    expect(viewerAsset.note).toBe('Viewer private edit');
    expect(viewerAsset.rating).toBe(4);
    expect((await asset(apiA, source.id)).note).toBe('Editor local winner');
    const viewerLink = (await status(apiB)).links.find(
      (link) => link.libraryId === library.id,
    )!;
    expect(viewerLink.lastError?.code).toBe('VIEWER_READ_ONLY');
    await cardB.getByRole('button', { name: 'View team', exact: true }).click();
    await expect(
      pageB
        .getByRole('dialog')
        .getByRole('button', { name: 'Add member', exact: true }),
    ).toHaveCount(0);
    await pageB
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .click();

    // Revocation is explicit and the local library remains intact.
    await cardA
      .getByRole('button', { name: 'Manage team', exact: true })
      .click();
    await editorRow
      .getByRole('button', { name: 'Remove member', exact: true })
      .click();
    await team
      .getByRole('button', { name: 'Confirm removal', exact: true })
      .click();
    await expect(editorRow).toHaveCount(0);
    await team.getByRole('button', { name: 'Close', exact: true }).click();
    await cardB
      .getByRole('button', { name: 'Download updates', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await status(apiB)).links.find((link) => link.id === viewerLink.id)
            ?.lastError?.code,
      )
      .toBe('SYNC_FORBIDDEN');
    await refresh(pageB);
    await expect(
      cardB.getByRole('button', { name: 'Open library', exact: true }),
    ).toBeEnabled();
    expect(
      await (
        await apiB.get(`/api/versions/${source.currentVersionId}/file`)
      ).body(),
    ).toEqual(original);
    await pageB
      .getByRole('button', { name: 'Sign out on this device', exact: true })
      .click();
    await expect(
      pageB.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeEnabled();
    expect((await status(apiA)).auth).toBe('signed-in');
    await signIn(pageB, fixture.accounts.outsider);
    await expect(pageB.getByLabel('Shared library')).toHaveCount(0);
    expect(
      (
        await apiB.post('/api/sync/join', { data: { libraryId: library.id } })
      ).status(),
    ).toBe(403);
    await pageB
      .getByRole('button', { name: 'Sign out on this device', exact: true })
      .click();
    // Both devices now authenticate the same owner: local sign-out must not revoke A's refresh token.
    await signIn(pageB, fixture.accounts.owner);
    await pageB
      .getByRole('button', { name: 'Sign out on this device', exact: true })
      .click();
    await expect(
      pageB.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeEnabled();
    await pageA
      .getByRole('button', { name: 'Refresh session', exact: true })
      .click();
    await expect(
      pageA.getByRole('button', { name: 'Refresh session', exact: true }),
    ).toBeEnabled();
    expect((await status(apiA)).auth).toBe('signed-in');
    for (const context of [contextA, contextB]) {
      const storage = JSON.stringify(await context.storageState());
      const session = await context
        .pages()[0]!
        .evaluate(() => JSON.stringify({ ...sessionStorage }));
      const privateValues = [
        fixture.anonKey,
        ...Object.values(fixture.accounts).map((account) => account.password),
      ];
      expect(
        privateValues.some(
          (value) => storage.includes(value) || session.includes(value),
        ),
      ).toBe(false);
      expect(/access_token|refresh_token/.test(storage + session)).toBe(false);
    }
    expect(outside).toEqual([]);
    await pageA.screenshot({
      path: 'docs/screenshots/v0.3-cloud-shared.png',
      fullPage: true,
      mask: [
        pageA.locator('code'),
        pageA
          .locator('.sync-panel > p')
          .filter({ hasText: fixture.accounts.owner.email }),
      ],
    });
    await mkdir('docs/evidence/v0.3.0', { recursive: true });
    await writeFile(
      'docs/evidence/v0.3.0/cloud-workspace.json',
      JSON.stringify(
        {
          environment:
            'Linux headless Chromium; two real Cura servers; disposable local Supabase Auth/Postgres/Storage',
          elapsedMs: Date.now() - started,
          devices: 2,
          browserExternalRequests: outside.length,
          assertions: [
            'server-managed password sign-in and refresh',
            'publish and authorized join',
            'verified retained original bytes and version UUID',
            'open materialized library',
            'pause/resume and incremental metadata pull',
            'local-wins conflict UI and complete downloaded JSON',
            'owner add/change/remove roles',
            'viewer pending edits retained without upload',
            'viewer still downloads remote changes',
            'revoked member blocked with local files retained',
            'outsider join rejected',
            'local sign-out preserves other device session',
            'browser storage has no passwords or session tokens',
          ],
          limits: [
            'No hosted Supabase project or physical macOS/Windows browser was used.',
          ],
        },
        null,
        2,
      ) + '\n',
    );
  } catch (error) {
    let message =
      error instanceof Error
        ? error.message
        : 'Configured browser acceptance failed.';
    const secrets = [
      fixture.anonKey,
      ...Object.values(fixture.accounts).flatMap((account) => [
        account.id,
        account.email,
        account.password,
      ]),
    ];
    for (const secret of secrets)
      message = message.replaceAll(secret, '[redacted]');
    throw new Error(message);
  } finally {
    await Promise.all([
      contextA.close(),
      contextB.close(),
      apiA.dispose(),
      apiB.dispose(),
    ]);
  }
});
