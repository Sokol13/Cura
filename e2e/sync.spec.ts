import { expect, test } from '@playwright/test';
import {
  LibrarySchema,
  SyncStatusSchema,
} from '../packages/shared/src/index.js';

test('cloud workspace stays fully local without configuration in English and Chinese', async ({
  page,
  request,
  context,
}) => {
  const outside: string[] = [];
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1')
      await route.continue();
    else {
      outside.push(route.request().url());
      await route.abort();
    }
  });
  await context.routeWebSocket('**/*', (socket) => {
    if (new URL(socket.url()).hostname === '127.0.0.1')
      socket.connectToServer();
    else {
      outside.push(socket.url());
      socket.close();
    }
  });
  expect(
    SyncStatusSchema.parse(await (await request.get('/api/sync/status')).json())
      .configured,
  ).toBe(false);
  const library = LibrarySchema.parse(
    await (
      await request.post('/api/libraries', {
        data: { name: 'Local cloud workspace' },
      })
    ).json(),
  );
  await request.patch('/api/settings', {
    data: { activeLibraryId: library.id, language: 'en', theme: 'dark' },
  });
  await page.goto('/?workspace=sync');
  await expect(
    page.getByRole('heading', { name: 'Cloud & team', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Local mode', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Cloud sync is not configured. Your libraries remain fully available on this device.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Refresh status', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Local mode', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Back to library/ }).click();
  await expect(
    page.getByRole('button', { name: 'Cloud & team', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Library', exact: true }),
  ).toHaveValue(library.id);
  await request.patch('/api/settings', {
    data: { language: 'zh-CN', theme: 'light' },
  });
  await page.goto('/?workspace=sync');
  await expect(
    page.getByRole('heading', { name: '云同步与团队', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '本地模式', exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({
    path: 'docs/screenshots/v0.3-cloud-local.png',
    fullPage: true,
  });
  expect(outside).toEqual([]);
});
