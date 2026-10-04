/// <reference lib="dom" />
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

function artwork(name: string, color: string, detail: string) {
  return {
    name,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${color}"/><circle cx="320" cy="220" r="130" fill="${detail}"/><path d="M0 450L180 190L380 480" fill="#ffffff" opacity=".3"/></svg>`,
    ),
  };
}
async function createLibrary(page: Page, name: string) {
  await page.getByRole('button', { name: 'New library', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
async function createNamed(page: Page, trigger: string, name: string) {
  await page.getByRole('button', { name: trigger, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test.beforeEach(async ({ request }) => {
  const response = await request.patch('/api/settings', {
    data: { language: 'en', theme: 'dark', layout: 'grid' },
  });
  expect(response.ok()).toBeTruthy();
});

test('local catalog imports, organizes, searches, batches and preserves workspace settings', async ({
  page,
}) => {
  await page.goto('/');
  await createLibrary(page, 'Fieldwork Studio');
  await page
    .getByLabel('Import files', { exact: true })
    .and(page.locator('input[type="file"]'))
    .setInputFiles([
      artwork('Terracotta study.svg', '#a55739', '#edbb7c'),
      artwork('Forest study.svg', '#244b42', '#79a475'),
      artwork('Cobalt study.svg', '#283d67', '#8cb5c8'),
    ]);
  const terracotta = page.getByRole('button', {
    name: 'Select Terracotta study.svg',
    exact: true,
  });
  await expect(terracotta).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.asset-card')).toHaveCount(3);
  await createNamed(page, 'New folder', 'Campaign');
  await createNamed(page, 'New tag group', 'Mood');
  await page.getByRole('button', { name: 'New tag', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Warm');
  await dialog.getByLabel('Tag color', { exact: true }).fill('#e69b65');
  await dialog
    .getByRole('combobox', { name: 'Tag group', exact: true })
    .selectOption({ label: 'Mood' });
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await terracotta.click();
  const inspector = page.getByRole('complementary', { name: 'Asset details' });
  await inspector
    .getByRole('textbox', { name: 'Prompt', exact: true })
    .fill('Warm sculptural architecture in the desert');
  await inspector
    .getByRole('textbox', { name: 'Negative prompt', exact: true })
    .fill('blurry');
  await inspector.getByLabel('Model', { exact: true }).fill('Studio model');
  await inspector.getByLabel('Source', { exact: true }).fill('ComfyUI');
  await inspector.getByLabel('Seed', { exact: true }).fill('9007199254740993');
  await inspector
    .getByRole('textbox', { name: 'Notes', exact: true })
    .fill('Opening scene reference');
  await inspector
    .getByRole('combobox', { name: 'Folders', exact: true })
    .selectOption({ label: 'Campaign' });
  await inspector.getByLabel('Warm', { exact: true }).check();
  await inspector.getByRole('button', { name: '5 stars', exact: true }).click();
  await inspector
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect(inspector.getByRole('status')).toHaveText('Saved');
  await page.getByRole('searchbox').fill('Opening scene');
  await expect(page.locator('.asset-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const filters = page.getByRole('region', { name: 'Filters' });
  await filters.getByLabel('Source', { exact: true }).fill('ComfyUI');
  await filters
    .getByRole('combobox', { name: 'Rating', exact: true })
    .selectOption('5');
  await expect(terracotta).toBeVisible();
  await createNamed(page, 'Save search', 'Approved warm studies');
  await page.getByRole('button', { name: 'All assets', exact: true }).click();
  await expect(page.locator('.asset-card')).toHaveCount(3);
  await page
    .getByRole('button', { name: 'Approved warm studies', exact: true })
    .click();
  await expect(page.locator('.asset-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'All assets', exact: true }).click();
  await terracotta.click();
  await page
    .getByRole('button', { name: 'Select Forest study.svg', exact: true })
    .click({ modifiers: ['Control'] });
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Move to trash', exact: true })
    .click();
  await expect(page.locator('.asset-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(page.locator('.asset-card')).toHaveCount(2);
  await terracotta.click();
  await page
    .getByRole('button', { name: 'Select all loaded assets', exact: true })
    .click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(
    page.getByText('The trash is empty', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'All assets', exact: true }).click();
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Theme', exact: true })
    .selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await dialog
    .getByRole('button', { name: 'Close', exact: true })
    .last()
    .click();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'List view', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await terracotta.click();
  await expect(
    inspector.getByRole('textbox', { name: 'Notes', exact: true }),
  ).toHaveValue('Opening scene reference');
  await expect(inspector.getByLabel('Seed', { exact: true })).toHaveValue(
    '9007199254740993',
  );
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Theme', exact: true })
    .selectOption('dark');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .last()
    .click();
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({
    path: 'docs/screenshots/v0.1.0.png',
    fullPage: true,
  });
});

test('directory registration, live updates, drop upload, shortcuts and bilingual UI work against the service', async ({
  page,
}) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cura-catalog-e2e-'));
  try {
    await writeFile(
      path.join(directory, 'Local reference.svg'),
      artwork('Local reference.svg', '#456c83', '#edccad').buffer,
    );
    await page.goto('/');
    await createLibrary(page, 'Local directory workflow');
    await page
      .getByRole('button', { name: 'Register directory', exact: true })
      .click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Directory path', { exact: true }).fill(directory);
    await dialog.getByRole('button', { name: 'Browse', exact: true }).click();
    await dialog
      .getByRole('button', { name: 'Register directory', exact: true })
      .click();
    const reference = page.getByRole('button', {
      name: 'Select Local reference.svg',
      exact: true,
    });
    await expect(reference).toBeVisible({ timeout: 15_000 });
    await writeFile(
      path.join(directory, 'Live addition.svg'),
      artwork('Live addition.svg', '#65936e', '#bbd1a0').buffer,
    );
    await expect(
      page.getByRole('button', {
        name: 'Select Live addition.svg',
        exact: true,
      }),
    ).toBeVisible({ timeout: 5000 });
    await page.locator('.workspace').evaluate(
      (node, svg) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([svg], 'Dropped concept.svg', { type: 'image/svg+xml' }),
        );
        node.dispatchEvent(
          new DragEvent('drop', { bubbles: true, dataTransfer: transfer }),
        );
      },
      artwork('Dropped concept.svg', '#865a6d', '#dfa3aa').buffer.toString(),
    );
    await expect(
      page.getByRole('button', {
        name: 'Select Dropped concept.svg',
        exact: true,
      }),
    ).toBeVisible({ timeout: 15_000 });
    await reference.click();
    await page.keyboard.press('Control+f');
    await expect(page.getByRole('searchbox')).toBeFocused();
    await page.getByRole('searchbox').fill('Local reference');
    await expect(page.locator('.asset-card')).toHaveCount(1);
    await reference.click();
    await page
      .getByRole('textbox', { name: 'Notes', exact: true })
      .fill('Typing does not delete the asset');
    await page
      .getByRole('textbox', { name: 'Notes', exact: true })
      .press('Delete');
    await expect(reference).toBeVisible();
    await reference.click();
    await page.keyboard.press('Delete');
    await expect(reference).not.toBeVisible();
    await page.getByRole('button', { name: 'Trash', exact: true }).click();
    await expect(reference).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog
      .getByRole('combobox', { name: 'Language', exact: true })
      .selectOption('zh-CN');
    await expect(
      dialog.getByRole('heading', { name: '设置', exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('combobox', { name: '语言', exact: true })
      .selectOption('en');
    await expect(
      dialog.getByRole('heading', { name: 'Settings', exact: true }),
    ).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
