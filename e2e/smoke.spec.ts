import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { HealthResponseSchema } from '../packages/shared/src/index.js';

test('production homepage renders and its same-origin health endpoint is ready', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Cura');
  await expect(
    page.getByRole('heading', { name: 'Cura', exact: true }),
  ).toBeVisible();
  const health = await page.evaluate(async () => {
    const response = await fetch('/api/health');
    return {
      status: response.status,
      body: (await response.json()) as unknown,
    };
  });
  expect(health.status).toBe(200);
  expect(HealthResponseSchema.parse(health.body)).toEqual({ status: 'ok' });
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({
    path: 'docs/screenshots/startup.png',
    fullPage: true,
  });
});
