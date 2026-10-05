import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Node } from '@xyflow/react';
import type { BoardDocument, SlotTemplate } from '@cura/shared';
import { expect, it, vi } from 'vitest';
import { BoardCanvas } from './BoardCanvas';
import { TemplatePresentationProvider } from './TemplatePresentationProvider';
import { i18n } from '../i18n';

// Keep the transport callback real while replacing canvas geometry unavailable in jsdom.
vi.mock('@xyflow/react', async (original) => {
  const module = await original<typeof import('@xyflow/react')>();
  let currentNodes: Node[] = [];
  const flow = { getNodes: () => currentNodes };
  return {
    ...module,
    ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
    useReactFlow: () => flow,
    Background: () => null,
    MiniMap: () => null,
    ReactFlow: ({
      nodes,
      onNodeDragStop,
    }: {
      nodes: Node[];
      onNodeDragStop: (event: object, node: Node) => void;
    }) => {
      currentNodes = nodes;
      return (
        <>
          {nodes.map((node) => (
            <button
              key={node.id}
              aria-label={node.ariaLabel}
              onClick={() =>
                onNodeDragStop({}, { ...node, position: { x: 50, y: 60 } })
              }
            >
              Move
            </button>
          ))}
        </>
      );
    },
  };
});
const id = '00000000-0000-4000-8000-000000000001';
const stamp = '2026-10-04T00:00:00.000Z';
const document: BoardDocument = {
  board: {
    id,
    libraryId: id,
    name: 'Saved canvas',
    kind: 'canvas',
    revision: 0,
    viewport: { x: 0, y: 0, zoom: 1 },
    rows: [],
    columns: [],
    templateId: id,
    deletedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  },
  items: [],
  edges: [],
  slots: [
    {
      id,
      libraryId: id,
      boardId: id,
      label: 'Reference',
      templateKey: 'reference',
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
    },
  ],
};
const template: SlotTemplate = {
  id,
  libraryId: id,
  name: 'Character',
  preset: 'character',
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
it('updates node accessible names on language changes without saving translations into the layout', async () => {
  await i18n.changeLanguage('zh-CN');
  const before = JSON.stringify(document);
  const save = vi.fn(async () => true);
  render(
    <TemplatePresentationProvider board={document.board} templates={[template]}>
      <BoardCanvas
        document={document}
        busy={false}
        selectedSlot={null}
        onChoose={vi.fn()}
        onAssign={vi.fn()}
        onHistory={vi.fn()}
        onSave={save}
        onAddPin={vi.fn()}
        onViewport={vi.fn()}
        onAddSlot={vi.fn()}
      />
    </TemplatePresentationProvider>,
  );
  expect(await screen.findByRole('button', { name: '设定图' })).toBeVisible();
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  expect(
    await screen.findByRole('button', { name: 'Reference' }),
  ).toBeVisible();
  expect(save).not.toHaveBeenCalled();
  await act(async () => {
    await i18n.changeLanguage('zh-CN');
  });
  fireEvent.click(await screen.findByRole('button', { name: '设定图' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledExactlyOnceWith({
      items: [],
      edges: [],
      slotLayouts: [{ id, x: 50, y: 60, width: 240, height: 180 }],
    }),
  );
  expect(JSON.stringify(document)).toBe(before);
});
