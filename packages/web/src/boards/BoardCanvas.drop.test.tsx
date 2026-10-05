import { act, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import type { Node, ReactFlowProps } from '@xyflow/react';
import type { BoardDocument } from '@cura/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import { BoardCanvas } from './BoardCanvas';
import { i18n } from '../i18n';

const canvas = vi.hoisted(() => ({
  props: {} as ReactFlowProps,
  screenToFlowPosition: vi.fn((point: { x: number; y: number }) => ({
    x: (point.x - 100) / 2,
    y: (point.y - 50) / 2,
  })),
}));
vi.mock('@xyflow/react', async (original) => {
  const module = await original<typeof import('@xyflow/react')>();
  const flow = {
    getNodes: () => canvas.props.nodes ?? [],
    screenToFlowPosition: canvas.screenToFlowPosition,
  };
  return {
    ...module,
    ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
    useReactFlow: () => flow,
    Background: () => null,
    MiniMap: () => null,
    ReactFlow: (props: ReactFlowProps) => {
      canvas.props = props;
      return null;
    },
  };
});
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stamp = '2026-10-05T00:00:00.000Z';
const entity = (n: number) => ({
  id: id(n),
  libraryId: id(2),
  createdAt: stamp,
  updatedAt: stamp,
});
const document = (): BoardDocument => ({
  board: {
    ...entity(1),
    name: 'Pinned references',
    kind: 'canvas',
    revision: 4,
    viewport: { x: 100, y: 50, zoom: 2 },
    rows: [],
    columns: [],
    templateId: null,
    deletedAt: null,
  },
  items: [
    {
      ...entity(3),
      boardId: id(1),
      kind: 'group',
      x: 100,
      y: 100,
      width: 300,
      height: 240,
      groupId: null,
      label: 'References',
      text: '',
      assetId: null,
      versionId: null,
    },
    {
      ...entity(4),
      boardId: id(1),
      kind: 'asset',
      x: 130,
      y: 150,
      width: 120,
      height: 100,
      groupId: id(3),
      label: 'Historical V1',
      text: '',
      assetId: id(5),
      versionId: id(6),
    },
  ],
  edges: [
    {
      ...entity(7),
      boardId: id(1),
      sourceId: id(3),
      targetId: id(4),
      label: 'Reference',
    },
  ],
  slots: [
    {
      ...entity(8),
      boardId: id(1),
      label: 'Final',
      x: 500,
      y: 200,
      width: 240,
      height: 180,
      rowId: null,
      columnId: null,
      templateKey: null,
      revision: 2,
      currentPin: null,
      deletedAt: null,
    },
  ],
});
const callbacks = () => ({
  busy: false,
  selectedSlot: null,
  onChoose: vi.fn(),
  onHistory: vi.fn(),
  onAssign: vi.fn<ComponentProps<typeof BoardCanvas>['onAssign']>(
    async () => true,
  ),
  onSave: vi.fn<ComponentProps<typeof BoardCanvas>['onSave']>(async () => true),
  onAddPin: vi.fn(async () => true),
  onViewport: vi.fn(async () => true),
  onAddSlot: vi.fn(),
});
const pointer = (x: number, y: number) =>
  new MouseEvent('mousemove', { clientX: x, clientY: y });
function node(n = 4): Node {
  return canvas.props.nodes!.find((entry) => entry.id === id(n))!;
}
function start(n = 4, multiple = false) {
  act(() =>
    canvas.props.onNodeDragStart?.(
      pointer(380, 390),
      node(n),
      multiple ? [node(n), node(3)] : [node(n)],
    ),
  );
}
function stop(x = 1220, y = 550, n = 4, multiple = false) {
  const moved = { ...node(n), position: { x: 450, y: 140 } };
  act(() =>
    canvas.props.onNodesChange?.([
      { id: moved.id, type: 'position', position: moved.position },
    ]),
  );
  act(() =>
    canvas.props.onNodeDragStop?.(
      pointer(x, y),
      moved,
      multiple ? [moved, node(3)] : [moved],
    ),
  );
}
beforeEach(async () => {
  canvas.screenToFlowPosition.mockClear();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(100, 50, 1600, 900),
  );
  await i18n.changeLanguage('en');
});

it('copies the grouped historical pin into the flow-space target without saving moved layout or edges', () => {
  const saved = document(),
    props = callbacks();
  render(<BoardCanvas document={saved} {...props} />);
  start();
  stop();
  expect(canvas.screenToFlowPosition).toHaveBeenCalledWith({ x: 1220, y: 550 });
  expect(props.onAssign).toHaveBeenCalledExactlyOnceWith(
    saved.slots[0],
    { assetId: id(5), versionId: id(6) },
    2,
  );
  expect(props.onSave).not.toHaveBeenCalled();
  expect(node().position).toEqual({ x: 30, y: 50 });
  expect(saved.items[1]?.versionId).toBe(id(6));
  expect(saved.edges).toHaveLength(1);
});

it('uses the target revision seen at drag start even if a refreshed board contains a newer assignment', () => {
  const saved = document(),
    props = callbacks();
  const view = render(<BoardCanvas document={saved} {...props} />);
  start();
  const changed = structuredClone(saved);
  changed.slots[0]!.revision = 3;
  changed.slots[0]!.currentPin = { assetId: id(9), versionId: id(10) };
  view.rerender(<BoardCanvas document={changed} {...props} />);
  stop();
  expect(props.onAssign).toHaveBeenCalledExactlyOnceWith(
    changed.slots[0],
    { assetId: id(5), versionId: id(6) },
    2,
  );
  expect(props.onSave).not.toHaveBeenCalled();
});

it('does not turn a rejected assignment into an ordinary move', async () => {
  const props = callbacks();
  props.onAssign.mockResolvedValue(false);
  render(<BoardCanvas document={document()} {...props} />);
  start();
  stop();
  await act(async () => {});
  expect(props.onAssign).toHaveBeenCalledOnce();
  expect(props.onSave).not.toHaveBeenCalled();
  expect(node().position).toEqual({ x: 30, y: 50 });
});

it.each(['board', 'source'] as const)(
  'cancels assignment when the %s identity changes during the gesture',
  (change) => {
    const saved = document(),
      props = callbacks();
    const view = render(<BoardCanvas document={saved} {...props} />);
    start();
    const changed = structuredClone(saved);
    if (change === 'board') changed.board.id = id(20);
    else changed.items[1]!.versionId = id(21);
    view.rerender(<BoardCanvas document={changed} {...props} />);
    stop();
    expect(props.onAssign).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'unconfirmed change was not applied',
    );
  },
);

it.each(['outside', 'overlap', 'multiple', 'group', 'text', 'slot'] as const)(
  'keeps %s drops as ordinary moves without assigning a slot',
  (kind) => {
    const saved = document(),
      props = callbacks();
    if (kind === 'overlap')
      saved.slots.push({ ...saved.slots[0]!, id: id(12) });
    if (kind === 'text')
      saved.items[1] = {
        ...saved.items[1]!,
        kind: 'text',
        assetId: null,
        versionId: null,
      };
    render(<BoardCanvas document={saved} {...props} />);
    const source = kind === 'group' ? 3 : kind === 'slot' ? 8 : 4;
    start(source, kind === 'multiple');
    stop(kind === 'outside' ? 1800 : 1220, 550, source, kind === 'multiple');
    expect(props.onAssign).not.toHaveBeenCalled();
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.onSave.mock.calls[0]?.[0]).toMatchObject({
      edges: saved.edges.map(({ id, sourceId, targetId, label }) => ({
        id,
        sourceId,
        targetId,
        label,
      })),
    });
  },
);

it.each(['start', 'stop'] as const)(
  'moves a selected parent without assigning its clicked asset child when drag nodes collapse at %s',
  (phase) => {
    const props = callbacks();
    render(<BoardCanvas document={document()} {...props} />);
    act(() =>
      canvas.props.onNodeDragStart?.(
        pointer(380, 390),
        node(),
        phase === 'start' ? [node(3)] : [node()],
      ),
    );
    act(() =>
      canvas.props.onNodesChange?.([
        { id: id(3), type: 'position', position: { x: 400, y: 400 } },
      ]),
    );
    act(() =>
      canvas.props.onNodeDragStop?.(pointer(1220, 550), node(), [node(3)]),
    );
    expect(props.onAssign).not.toHaveBeenCalled();
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.onSave.mock.calls[0]?.[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: id(3), x: 400, y: 400 }),
        expect.objectContaining({ id: id(4), x: 430, y: 450 }),
      ]),
    );
  },
);

it('keeps a release outside the visible canvas as movement even when its flow position hits an offscreen slot', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(100, 50, 800, 900),
  );
  const props = callbacks();
  render(<BoardCanvas document={document()} {...props} />);
  start();
  stop();
  expect(props.onAssign).not.toHaveBeenCalled();
  expect(props.onSave).toHaveBeenCalledOnce();
});
