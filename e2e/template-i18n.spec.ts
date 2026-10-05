import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  AssetSchema,
  BoardDocumentSchema,
  LibrarySchema,
  SlotHistorySchema,
  SlotTemplateSchema,
  SlotTemplatesSchema,
  type BoardDocument,
} from '../packages/shared/src/index.js';

test.use({ viewport: { width: 1500, height: 1000 } });

const presets = [
  {
    kind: 'character',
    names: ['Character studies', '角色设定'],
    descriptions: [
      'Reference images, shot sizes, and angles for a character.',
      '角色的设定图、景别和角度。',
    ],
    slots: [
      ['reference', 'Reference', '设定图'],
      ['close', 'Close-up', '近景'],
      ['wide', 'Wide shot', '全景'],
      ['angle35', '35° view', '35° 视角'],
    ],
  },
  {
    kind: 'scene',
    names: ['Scene explorations', '场景探索'],
    descriptions: [
      'Overviews, details, and alternatives for a scene.',
      '场景的整体、细节和备选方案。',
    ],
    slots: [
      ['overview', 'Overview', '场景总览'],
      ['detail', 'Detail', '场景细节'],
      ['option', 'Option', '备选方案'],
    ],
  },
  {
    kind: 'product',
    names: ['Product development', '产品开发'],
    descriptions: [
      'Product development from white model to AI render.',
      '产品从白模到 AI 渲染的开发过程。',
    ],
    slots: [
      ['white', 'White model', '白模'],
      ['clay', 'Clay render', '粗渲'],
      ['ai', 'AI render', 'AI 渲染'],
    ],
  },
  {
    kind: 'brand',
    names: ['Brand variations', '品牌变体'],
    descriptions: [
      'Horizontal, vertical, and monochrome brand logos.',
      '品牌标志的横版、竖版和单色变体。',
    ],
    slots: [
      ['horizontal', 'Horizontal logo', '横版标志'],
      ['vertical', 'Vertical logo', '竖版标志'],
      ['monochrome', 'Monochrome logo', '单色标志'],
    ],
  },
] as const;

async function setup(request: APIRequestContext, name: string) {
  const created = await request.post('/api/libraries', { data: { name } });
  expect(created.status()).toBe(201);
  const library = LibrarySchema.parse(await created.json());
  expect(
    (
      await request.patch('/api/settings', {
        data: { activeLibraryId: library.id, language: 'en', theme: 'dark' },
      })
    ).ok(),
  ).toBe(true);
  const templates = SlotTemplatesSchema.parse(
    await (
      await request.get(`/api/libraries/${library.id}/slot-templates`)
    ).json(),
  );
  expect(templates.filter((template) => template.preset)).toHaveLength(4);
  const createBoard = async (name: string, templateId: string) => {
    const response = await request.post(`/api/libraries/${library.id}/boards`, {
      data: { name, kind: 'canvas', templateId },
    });
    expect(response.status()).toBe(201);
    return BoardDocumentSchema.parse(await response.json());
  };
  return { library, templates, createBoard };
}

async function getBoard(request: APIRequestContext, id: string) {
  return BoardDocumentSchema.parse(
    await (await request.get(`/api/boards/${id}`)).json(),
  );
}

async function switchLanguage(
  page: Page,
  language: 'en' | 'zh-CN',
  boardId: string,
) {
  const chinese = language === 'zh-CN';
  await page
    .getByRole('button', {
      name: chinese ? 'Back to library' : '返回资产库',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', { name: chinese ? 'Settings' : '设置', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: chinese ? 'Language' : '语言', exact: true })
    .selectOption(language);
  await expect(
    dialog.getByRole('heading', {
      name: chinese ? '设置' : 'Settings',
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: chinese ? '关闭' : 'Close', exact: true })
    .last()
    .click();
  await page.goto(`/?workspace=boards&board=${boardId}`);
}

test('existing English preset boards localize every slot and description without rewriting saved data', async ({
  page,
  request,
}) => {
  const { library, templates, createBoard } = await setup(
    request,
    'Preset localization',
  );
  const documents: BoardDocument[] = [];
  for (const preset of presets) {
    const template = templates.find((entry) => entry.preset === preset.kind)!;
    const document = await createBoard(`Existing ${preset.kind}`, template.id);
    expect(document.slots.map((slot) => slot.label)).toEqual(
      preset.slots.map(([, label]) => label),
    );
    documents.push(document);
  }
  const imported = await request.post(
    `/api/libraries/${library.id}/upload?name=Character.svg`,
    {
      headers: { 'content-type': 'application/octet-stream' },
      data: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#f49245"/></svg>',
      ),
    },
  );
  expect(imported.status()).toBe(201);
  const asset = AssetSchema.parse(await imported.json());
  const character = documents[0]!;
  const referenceId = character.slots.find(
    (slot) => slot.templateKey === 'reference',
  )!.id;
  const assigned = await request.put(`/api/slots/${referenceId}/assignment`, {
    data: {
      expectedRevision: 0,
      pin: { assetId: asset.id, versionId: asset.currentVersionId },
    },
  });
  expect(assigned.ok()).toBe(true);
  documents[0] = BoardDocumentSchema.parse(await assigned.json());
  const historyBefore = SlotHistorySchema.parse(
    await (await request.get(`/api/slots/${referenceId}/history`)).json(),
  );
  await page.goto(`/?workspace=boards&board=${character.board.id}`);
  await expect(
    page.getByRole('region', {
      name: 'Drop asset into Reference',
      exact: true,
    }),
  ).toBeVisible();
  await switchLanguage(page, 'zh-CN', character.board.id);

  for (const language of ['zh-CN', 'en'] as const) {
    const chinese = language === 'zh-CN';
    if (!chinese) await switchLanguage(page, 'en', character.board.id);
    for (const [index, preset] of presets.entries()) {
      const document = documents[index]!;
      await page
        .locator('.board-navigation button')
        .filter({ hasText: document.board.name })
        .click();
      await expect(
        page.getByRole('heading', { name: document.board.name, exact: true }),
      ).toBeVisible();
      for (const [key, english, translated] of preset.slots) {
        const label = chinese ? translated : english;
        const slot = document.slots.find((entry) => entry.templateKey === key)!;
        const region = page.getByRole('region', {
          name: chinese ? `将资产拖入 ${label}` : `Drop asset into ${label}`,
          exact: true,
        });
        await expect(region).toBeVisible();
        await expect(region.locator('strong')).toHaveText(label);
        await expect(region).toHaveAccessibleDescription(
          chinese ? /[\u3400-\u9fff]/ : /[A-Za-z]/,
        );
        await expect(
          region.getByRole('button', {
            name: chinese
              ? `为 ${label} 选择资产`
              : `Choose asset for ${label}`,
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          region.getByRole('button', {
            name: chinese ? `${label} 的历史` : `History for ${label}`,
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.locator(`.react-flow__node[data-id="${slot.id}"]`),
        ).toHaveAttribute('aria-label', label);
      }
    }
    await page
      .locator('.board-navigation button')
      .filter({ hasText: character.board.name })
      .click();
    const referenceLabel = chinese ? '设定图' : 'Reference';
    const reference = page.locator(`[data-slot-id="${referenceId}"]`);
    await expect(reference).toHaveAccessibleDescription(
      chinese
        ? '角色外观与服装的设定依据。'
        : 'Reference for the character’s appearance and clothing.',
    );
    const historyTitle = chinese ? '设定图 的历史' : 'History for Reference';
    await reference
      .getByRole('button', { name: historyTitle, exact: true })
      .click();
    const history = page.getByRole('dialog', {
      name: historyTitle,
      exact: true,
    });
    await expect(
      history.getByText(chinese ? '资产槽版本 V1' : 'Slot version V1', {
        exact: true,
      }),
    ).toBeVisible();
    await history
      .getByRole('button', { name: chinese ? '关闭' : 'Close', exact: true })
      .click();
    await reference
      .getByRole('button', {
        name: chinese
          ? `为 ${referenceLabel} 选择资产`
          : `Choose asset for ${referenceLabel}`,
        exact: true,
      })
      .click();
    await expect(page.locator('.board-assignment-bar strong')).toHaveText(
      referenceLabel,
    );
    await page
      .getByRole('button', {
        name: chinese ? '取消资产槽选择' : 'Cancel slot selection',
        exact: true,
      })
      .click();

    await page
      .getByRole('button', {
        name: chinese ? '管理模板' : 'Manage templates',
        exact: true,
      })
      .click();
    const manager = page.getByRole('dialog');
    for (const preset of presets) {
      const article = manager.locator('article').filter({
        has: page.getByText(preset.names[chinese ? 1 : 0], { exact: true }),
      });
      await expect(
        article.getByText(preset.descriptions[chinese ? 1 : 0], {
          exact: true,
        }),
      ).toBeVisible();
    }
    await manager
      .getByRole('button', { name: chinese ? '关闭' : 'Close', exact: true })
      .click();
    await page
      .getByRole('button', {
        name: chinese ? '新建看板' : 'New board',
        exact: true,
      })
      .click();
    const form = page.getByRole('dialog');
    for (const preset of presets) {
      const template = templates.find((entry) => entry.preset === preset.kind)!;
      await form
        .getByRole('combobox', {
          name: chinese ? '资产槽模板' : 'Slot template',
          exact: true,
        })
        .selectOption(template.id);
      await expect(
        form.getByText(preset.descriptions[chinese ? 1 : 0], { exact: true }),
      ).toBeVisible();
    }
    await form
      .getByRole('button', { name: chinese ? '取消' : 'Cancel', exact: true })
      .click();
    if (chinese)
      await page.screenshot({
        path: 'docs/screenshots/v0.3.1-template-i18n.png',
        fullPage: true,
      });
  }
  for (const document of documents)
    expect(await getBoard(request, document.board.id)).toEqual(document);
  expect(
    SlotTemplatesSchema.parse(
      await (
        await request.get(`/api/libraries/${library.id}/slot-templates`)
      ).json(),
    ),
  ).toEqual(templates);
  expect(
    SlotHistorySchema.parse(
      await (await request.get(`/api/slots/${referenceId}/history`)).json(),
    ),
  ).toEqual(historyBefore);
});

test('Chinese display preserves custom templates with canonical keys and user-renamed built-in slots', async ({
  page,
  request,
}) => {
  const { library, templates, createBoard } = await setup(
    request,
    'Custom slot localization boundaries',
  );
  const character = templates.find((entry) => entry.preset === 'character')!;
  const customResponse = await request.post(
    `/api/libraries/${library.id}/slot-templates`,
    { data: { name: 'Character studies', slots: [character.slots[0]!] } },
  );
  expect(customResponse.status()).toBe(201);
  const custom = SlotTemplateSchema.parse(await customResponse.json());
  expect(custom.preset).toBeNull();
  const customBoard = await createBoard('Custom reference', custom.id);
  expect(customBoard.slots[0]).toMatchObject({
    templateKey: 'reference',
    label: 'Reference',
  });
  const original = await createBoard('Renamed preset reference', character.id);
  const renamedSlot = original.slots.find(
    (slot) => slot.templateKey === 'reference',
  )!;
  const renamedResponse = await request.put(
    `/api/boards/${original.board.id}/layout`,
    {
      data: {
        expectedRevision: original.board.revision,
        items: [],
        edges: [],
        slotLayouts: [
          { id: renamedSlot.id, label: 'Client-approved reference' },
        ],
      },
    },
  );
  expect(renamedResponse.ok()).toBe(true);
  const renamed = BoardDocumentSchema.parse(await renamedResponse.json());
  await request.patch('/api/settings', { data: { language: 'zh-CN' } });
  await page.goto(`/?workspace=boards&board=${customBoard.board.id}`);
  const literal = page.getByRole('region', {
    name: '将资产拖入 Reference',
    exact: true,
  });
  await expect(literal).toBeVisible();
  await expect(
    literal.getByRole('button', { name: 'Reference 的历史', exact: true }),
  ).toBeVisible();
  await expect(literal).toHaveAccessibleDescription('');
  await page
    .locator('.board-navigation button')
    .filter({ hasText: renamed.board.name })
    .click();
  await expect(
    page.getByRole('region', {
      name: '将资产拖入 Client-approved reference',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: '将资产拖入 近景', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', {
      name: '将资产拖入 Client-approved reference',
      exact: true,
    }),
  ).toHaveAccessibleDescription('');
  expect(await getBoard(request, customBoard.board.id)).toEqual(customBoard);
  expect(await getBoard(request, renamed.board.id)).toEqual(renamed);
});
