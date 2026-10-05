import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Board, BoardSlot, SlotTemplate } from '@cura/shared';
import { i18n } from '../i18n';
import { SlotCard } from './SlotCard';
import { BoardCreateForm } from './BoardForms';
import { TemplateManager } from './TemplateManager';
import { TemplatePresentationProvider } from './TemplatePresentationProvider';

const id = '00000000-0000-4000-8000-000000000001';
const stamp = '2026-10-04T00:00:00.000Z';
const families = [
  [
    'character',
    '角色设定',
    'Character studies',
    '角色的设定图、景别和角度。',
    'Reference images, shot sizes, and angles for a character.',
    [
      [
        'reference',
        'Reference',
        '设定图',
        '角色外观与服装的设定依据。',
        'Reference for the character’s appearance and clothing.',
      ],
      [
        'close',
        'Close-up',
        '近景',
        '面部表情与近距离细节。',
        'Facial expression and close-up details.',
      ],
      [
        'wide',
        'Wide shot',
        '全景',
        '全身姿态与整体轮廓。',
        'Full-body pose and overall silhouette.',
      ],
      [
        'angle35',
        '35° view',
        '35° 视角',
        '观察角色的 35° 斜侧面。',
        'View the character from a 35° angle.',
      ],
    ],
  ],
  [
    'scene',
    '场景探索',
    'Scene explorations',
    '场景的整体、细节和备选方案。',
    'Overviews, details, and alternatives for a scene.',
    [
      [
        'overview',
        'Overview',
        '场景总览',
        '场景布局与整体氛围。',
        'Scene layout and overall atmosphere.',
      ],
      [
        'detail',
        'Detail',
        '场景细节',
        '场景中的局部与材质细节。',
        'Local features and material details in the scene.',
      ],
      [
        'option',
        'Option',
        '备选方案',
        '同一场景的备选设计。',
        'An alternative design for the same scene.',
      ],
    ],
  ],
  [
    'product',
    '产品开发',
    'Product development',
    '产品从白模到 AI 渲染的开发过程。',
    'Product development from white model to AI render.',
    [
      [
        'white',
        'White model',
        '白模',
        '产品形体与比例的白模。',
        'A white model showing product form and proportions.',
      ],
      [
        'clay',
        'Clay render',
        '粗渲',
        '产品光照与体积的粗渲。',
        'A clay render showing product lighting and volume.',
      ],
      [
        'ai',
        'AI render',
        'AI 渲染',
        '产品的 AI 渲染方案。',
        'An AI-rendered product concept.',
      ],
    ],
  ],
  [
    'brand',
    '品牌变体',
    'Brand variations',
    '品牌标志的横版、竖版和单色变体。',
    'Horizontal, vertical, and monochrome brand logos.',
    [
      [
        'horizontal',
        'Horizontal logo',
        '横版标志',
        '横向排布的品牌标志。',
        'The brand logo in a horizontal layout.',
      ],
      [
        'vertical',
        'Vertical logo',
        '竖版标志',
        '纵向排布的品牌标志。',
        'The brand logo in a vertical layout.',
      ],
      [
        'monochrome',
        'Monochrome logo',
        '单色标志',
        '用于单色印刷的品牌标志。',
        'The brand logo for monochrome reproduction.',
      ],
    ],
  ],
] as const;
const board: Board = {
  id,
  libraryId: id,
  name: 'Saved board',
  kind: 'canvas',
  revision: 0,
  viewport: { x: 0, y: 0, zoom: 1 },
  rows: [],
  columns: [],
  templateId: id,
  deletedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
};
function template(preset: SlotTemplate['preset']): SlotTemplate {
  return {
    id,
    libraryId: id,
    name: 'Literal template',
    preset,
    slots: [
      {
        key: 'reference',
        label: 'Reference',
        x: 0,
        y: 0,
        width: 240,
        height: 180,
      },
    ],
    deletedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
}
function slot(key: string, label: string): BoardSlot {
  return Object.freeze({
    id: key,
    libraryId: id,
    boardId: id,
    templateKey: key,
    label,
    x: 0,
    y: 0,
    width: 240,
    height: 180,
    rowId: null,
    columnId: null,
    revision: 0,
    currentPin: null,
    deletedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
}
function card(value: BoardSlot) {
  return (
    <SlotCard
      key={value.id}
      slot={value}
      selected={false}
      busy={false}
      onChoose={vi.fn()}
      onAssign={vi.fn()}
      onHistory={vi.fn()}
    />
  );
}
beforeEach(async () => {
  await i18n.changeLanguage('zh-CN');
});

it.each(families)(
  'localizes every %s slot and purpose in an existing canonical board, including a live language switch',
  async (preset, _zhName, _enName, _zhDescription, _enDescription, frames) => {
    const slots = frames.map(([key, label]) => slot(key, label));
    render(
      <TemplatePresentationProvider
        board={board}
        templates={[template(preset)]}
      >
        {slots.map(card)}
      </TemplatePresentationProvider>,
    );
    for (const [, , label, description] of frames) {
      expect(
        screen.getByRole('region', { name: `将资产拖入 ${label}` }),
      ).toHaveAccessibleDescription(description);
      expect(
        screen.getByRole('button', { name: `为 ${label} 选择资产` }),
      ).toBeVisible();
      expect(
        screen.getByRole('button', { name: `${label} 的历史` }),
      ).toBeVisible();
    }
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    for (const [, label, , , description] of frames) {
      expect(
        screen.getByRole('region', { name: `Drop asset into ${label}` }),
      ).toHaveAccessibleDescription(description);
    }
    expect(slots.map((value) => value.label)).toEqual(
      frames.map(([, label]) => label),
    );
  },
);
it.each(families)(
  'shows localized %s template purpose and keeps creation data canonical',
  async (preset, zhName, enName, zhDescription, enDescription) => {
    const templates = [template(preset)];
    const onCreate = vi.fn();
    const manager = render(
      <TemplateManager
        libraryId={id}
        templates={templates}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText(zhName)).toBeVisible();
    expect(screen.getByText(zhDescription)).toBeVisible();
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(screen.getByText(enName)).toBeVisible();
    expect(screen.getByText(enDescription)).toBeVisible();
    manager.unmount();
    await act(async () => {
      await i18n.changeLanguage('zh-CN');
    });
    render(
      <BoardCreateForm
        templates={templates}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );
    fireEvent.change(screen.getByLabelText('资产槽模板'), {
      target: { value: id },
    });
    expect(screen.getByText(zhDescription)).toBeVisible();
    expect(
      screen.getByRole('combobox', { name: '资产槽模板' }),
    ).toHaveAccessibleDescription(zhDescription);
    fireEvent.change(screen.getByLabelText('看板名称'), {
      target: { value: 'Existing words' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(onCreate).toHaveBeenCalledWith({
      name: 'Existing words',
      kind: 'canvas',
      templateId: id,
    });
    expect(templates[0]?.slots[0]?.label).toBe('Reference');
  },
);
it('preserves custom keys, renamed built-ins, and unrelated template identities', () => {
  const custom = render(
    <TemplatePresentationProvider board={board} templates={[template(null)]}>
      {card(slot('reference', 'Reference'))}
    </TemplatePresentationProvider>,
  );
  expect(
    screen.getByRole('region', { name: '将资产拖入 Reference' }),
  ).not.toHaveAttribute('aria-describedby');
  custom.unmount();
  const renamed = render(
    <TemplatePresentationProvider
      board={board}
      templates={[template('character')]}
    >
      {card(slot('reference', 'My reference'))}
    </TemplatePresentationProvider>,
  );
  expect(
    screen.getByRole('region', { name: '将资产拖入 My reference' }),
  ).not.toHaveAttribute('aria-describedby');
  renamed.unmount();
  render(
    <TemplatePresentationProvider
      board={{ ...board, templateId: null }}
      templates={[template('character')]}
    >
      {card(slot('reference', 'Reference'))}
    </TemplatePresentationProvider>,
  );
  expect(
    screen.getByRole('region', { name: '将资产拖入 Reference' }),
  ).toBeVisible();
});
