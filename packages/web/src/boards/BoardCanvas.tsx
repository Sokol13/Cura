import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import {
  Background,
  Handle,
  MarkerType,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type OnConnect,
  type OnNodeDrag,
} from '@xyflow/react';
import {
  BoardPinSchema,
  type BoardDocument,
  type BoardItemInput,
  type BoardPin,
  type BoardSlot,
  type BoardViewport,
  type SaveBoardLayout,
} from '@cura/shared';
import { useTranslation } from 'react-i18next';
import { assetUrl } from '../catalog/api';
import { OrganizationDialog } from '../catalog/OrganizationDialog';
import { SlotCard } from './SlotCard';
import { useSlotPresentation } from './template-presentation';
import {
  absolutePosition,
  edgeInput,
  groupItems,
  itemInput,
  removeItems,
  toFlowNodes,
} from './model';
import '@xyflow/react/dist/style.css';

type Layout = Omit<SaveBoardLayout, 'expectedRevision'>;
type CanvasProps = {
  document: BoardDocument;
  busy: boolean;
  selectedSlot: string | null;
  onChoose: (slot: BoardSlot) => void;
  onAssign: (
    slot: BoardSlot,
    pin: BoardPin,
    expectedRevision?: number,
  ) => Promise<boolean>;
  onHistory: (slot: BoardSlot) => void;
  onSave: (layout: Layout) => Promise<boolean>;
  onAddPin: (
    pin: BoardPin,
    position: { x: number; y: number },
  ) => Promise<boolean>;
  onViewport: (viewport: BoardViewport) => Promise<boolean>;
  onAddSlot: () => void;
  ref?: Ref<BoardCanvasHandle>;
};
export type BoardCanvasHandle = { addPin: (pin: BoardPin) => Promise<void> };
type CuraNode = Node<
  { item: BoardItemInput | null; slot: BoardSlot | null },
  'curaItem' | 'curaSlot'
>;
type AssetDrag = {
  boardId: string;
  libraryId: string;
  itemId: string;
  pin: BoardPin;
  slotRevisions: Map<string, number>;
};
type CanvasContextValue = Pick<
  CanvasProps,
  'busy' | 'selectedSlot' | 'onChoose' | 'onAssign' | 'onHistory'
> & { persist: () => void };
const CanvasContext = createContext<CanvasContextValue | null>(null);

function ItemNode({ data, selected }: NodeProps<CuraNode>) {
  const context = useContext(CanvasContext);
  const item = data.item;
  if (!item || !context) return null;
  return (
    <div className={`board-canvas-item board-${item.kind}`}>
      <NodeResizer
        isVisible={Boolean(selected) && !context.busy}
        minWidth={80}
        minHeight={60}
        color="var(--accent)"
        onResizeEnd={context.persist}
      />
      <Handle type="target" position={Position.Left} />
      {item.kind === 'asset' && item.versionId && (
        <img
          src={assetUrl(item.versionId, 'thumbnail')}
          alt=""
          draggable={false}
        />
      )}
      <strong>{item.label}</strong>
      {item.kind === 'text' && <p>{item.text}</p>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
function SlotNode({ data, selected }: NodeProps<CuraNode>) {
  const context = useContext(CanvasContext);
  if (!data.slot || !context) return null;
  return (
    <>
      <NodeResizer
        isVisible={Boolean(selected) && !context.busy}
        minWidth={180}
        minHeight={160}
        color="var(--accent)"
        onResizeEnd={context.persist}
      />
      <SlotCard
        slot={data.slot}
        busy={context.busy}
        selected={context.selectedSlot === data.slot.id}
        onChoose={context.onChoose}
        onAssign={context.onAssign}
        onHistory={context.onHistory}
      />
    </>
  );
}
const nodeTypes = { curaItem: ItemNode, curaSlot: SlotNode };

export function BoardCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasContent {...props} />
    </ReactFlowProvider>
  );
}
function CanvasContent({
  document,
  busy,
  selectedSlot,
  onChoose,
  onAssign,
  onHistory,
  onSave,
  onAddPin,
  onViewport,
  onAddSlot,
  ref,
}: CanvasProps) {
  const { t } = useTranslation('boards');
  const presentSlot = useSlotPresentation();
  const flow = useReactFlow<CuraNode>();
  const container = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<CuraNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [editing, setEditing] = useState<BoardItemInput | 'new' | null>(null);
  const [edgeEditing, setEdgeEditing] = useState<Edge | null>(null);
  const [error, setError] = useState('');
  const assetDrag = useRef<AssetDrag | null>(null);
  const [pendingViewport, setPendingViewport] = useState<BoardViewport | null>(
    null,
  );
  const selectedIds = new Set(
    nodes.filter((node) => node.selected).map((node) => node.id),
  );
  const selectedItems = document.items.filter((item) =>
    selectedIds.has(item.id),
  );
  const selectedEdges = edges.filter((edge) => edge.selected);
  const selectedItem =
    selectedItems.length === 1 ? selectedItems[0] : undefined;
  useEffect(() => {
    setNodes((previous) => {
      const selected = new Set(
        previous.filter((node) => node.selected).map((node) => node.id),
      );
      const positions = toFlowNodes(document.items);
      return [
        ...positions.map((position): CuraNode => {
          const item = document.items.find(
            (entry) => entry.id === position.id,
          )!;
          return {
            ...position,
            type: 'curaItem',
            ariaLabel: item.label,
            data: { item, slot: null },
            style: { width: item.width, height: item.height },
            selected: selected.has(item.id),
            zIndex: item.kind === 'group' ? -1 : 0,
          };
        }),
        ...document.slots.map(
          (slot): CuraNode => ({
            id: slot.id,
            type: 'curaSlot',
            ariaLabel: presentSlot(slot).label,
            position: { x: slot.x, y: slot.y },
            data: { item: null, slot },
            style: { width: slot.width, height: slot.height },
            selected: selected.has(slot.id),
          }),
        ),
      ];
    });
    setEdges(
      document.edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        label: edge.label,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: 'var(--accent)' },
      })),
    );
  }, [document, presentSlot]);
  const layout = useCallback(
    (changedNodes = flow.getNodes()): Layout => ({
      items: document.items.map((item) => {
        const node = changedNodes.find((entry) => entry.id === item.id);
        const position = absolutePosition(item.id, changedNodes);
        return {
          ...itemInput(item),
          ...position,
          width: node?.measured?.width ?? item.width,
          height: node?.measured?.height ?? item.height,
        };
      }),
      edges: document.edges.map(edgeInput),
      slotLayouts: document.slots.map((slot) => {
        const node = changedNodes.find((entry) => entry.id === slot.id);
        return {
          id: slot.id,
          x: node?.position.x ?? slot.x,
          y: node?.position.y ?? slot.y,
          width: node?.measured?.width ?? slot.width,
          height: node?.measured?.height ?? slot.height,
        };
      }),
    }),
    [document, flow],
  );
  const persist = useCallback(() => {
    if (!busy) void onSave(layout());
  }, [busy, onSave, layout]);
  useEffect(() => {
    if (!pendingViewport || busy) return;
    const timer = setTimeout(() => {
      setPendingViewport(null);
      void onViewport(pendingViewport);
    }, 250);
    return () => clearTimeout(timer);
  }, [pendingViewport, busy, onViewport]);
  const center = () => {
    const rect = container.current?.getBoundingClientRect();
    return flow.screenToFlowPosition({
      x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2 - 120,
      y: (rect?.top ?? 0) + (rect?.height ?? 500) / 2 - 100,
    });
  };
  const addPin = async (pin: BoardPin, position = center()) => {
    if (busy) return;
    try {
      if (await onAddPin(pin, position)) setError('');
    } catch {
      setError(t('saveError'));
    }
  };
  useImperativeHandle(ref, () => ({ addPin }));
  const remove = async () => {
    if (busy) return;
    const result = removeItems(
      document.items.map(itemInput),
      document.edges
        .filter(
          (edge) => !selectedEdges.some((selected) => selected.id === edge.id),
        )
        .map(edgeInput),
      selectedIds,
    );
    await onSave(result);
  };
  const connect: OnConnect = (connection) => {
    if (
      busy ||
      !connection.source ||
      !connection.target ||
      connection.source === connection.target
    )
      return;
    void onSave({
      items: document.items.map(itemInput),
      edges: [
        ...document.edges.map(edgeInput),
        {
          id: crypto.randomUUID(),
          sourceId: connection.source,
          targetId: connection.target,
          label: '',
        },
      ],
    });
  };
  const group = () =>
    onSave({
      items: groupItems(
        document.items.map(itemInput),
        selectedIds,
        crypto.randomUUID(),
        t('groupLabel'),
      ),
      edges: document.edges.map(edgeInput),
    });
  const ungroup = () =>
    onSave(
      removeItems(
        document.items.map(itemInput),
        document.edges.map(edgeInput),
        new Set(
          selectedItems
            .filter((item) => item.kind === 'group')
            .map((item) => item.id),
        ),
      ),
    );
  const startDrag: OnNodeDrag<CuraNode> = (_event, node, dragged) => {
    assetDrag.current = null;
    const item = document.items.find((entry) => entry.id === node.id);
    if (
      busy ||
      dragged.length !== 1 ||
      dragged[0]?.id !== node.id ||
      item?.kind !== 'asset' ||
      !item.assetId ||
      !item.versionId
    )
      return;
    assetDrag.current = {
      boardId: document.board.id,
      libraryId: document.board.libraryId,
      itemId: item.id,
      pin: { assetId: item.assetId, versionId: item.versionId },
      slotRevisions: new Map(
        document.slots.map((slot) => [slot.id, slot.revision]),
      ),
    };
  };
  const stopDrag: OnNodeDrag<CuraNode> = (event, node, dragged) => {
    const intent = assetDrag.current;
    assetDrag.current = null;
    if (intent && intent.itemId === node.id) {
      const source = document.items.find((item) => item.id === intent.itemId);
      const restorePosition = () => {
        const saved = toFlowNodes(document.items).find(
          (item) => item.id === intent.itemId,
        );
        if (saved)
          setNodes((previous) =>
            previous.map((item) =>
              item.id === saved.id
                ? { ...item, position: saved.position, dragging: false }
                : item,
            ),
          );
      };
      if (
        intent.boardId !== document.board.id ||
        intent.libraryId !== document.board.libraryId ||
        source?.kind !== 'asset' ||
        source.assetId !== intent.pin.assetId ||
        source.versionId !== intent.pin.versionId
      ) {
        restorePosition();
        setError(t('conflict'));
        return;
      }
      if (busy) {
        restorePosition();
        return;
      }
      const pointer =
        'changedTouches' in event ? event.changedTouches[0] : event;
      const bounds = container.current?.getBoundingClientRect();
      if (
        pointer &&
        bounds &&
        dragged.length === 1 &&
        dragged[0]?.id === node.id &&
        pointer.clientX >= bounds.left &&
        pointer.clientX <= bounds.right &&
        pointer.clientY >= bounds.top &&
        pointer.clientY <= bounds.bottom
      ) {
        const point = flow.screenToFlowPosition({
          x: pointer.clientX,
          y: pointer.clientY,
        });
        const targets = document.slots.filter(
          (slot) =>
            !slot.deletedAt &&
            point.x >= slot.x &&
            point.x <= slot.x + slot.width &&
            point.y >= slot.y &&
            point.y <= slot.y + slot.height,
        );
        // Overlapping slots are ambiguous; keep the ordinary move in that case.
        if (targets.length === 1) {
          const target = targets[0]!;
          const expectedRevision = intent.slotRevisions.get(target.id);
          restorePosition();
          if (expectedRevision === undefined) setError(t('conflict'));
          else {
            setError('');
            void onAssign(target, intent.pin, expectedRevision).catch(() =>
              setError(t('saveError')),
            );
          }
          // Copy the pin only: saving the dragged layout would move the source
          // and race the assignment's board revision.
          return;
        }
      }
    }
    if (!busy)
      void onSave(
        layout(
          flow.getNodes().map((entry) => (entry.id === node.id ? node : entry)),
        ),
      );
  };
  return (
    <div className="board-canvas-workspace">
      <div className="board-toolbar">
        <button disabled={busy} onClick={() => setEditing('new')}>
          <span aria-hidden="true">＋</span> {t('addText')}
        </button>
        <button disabled={busy} onClick={onAddSlot}>
          <span aria-hidden="true">▧</span> {t('addSlot')}
        </button>
        <span className="board-toolbar-divider" />
        <button
          disabled={busy || selectedItems.length < 2}
          onClick={() => void group()}
        >
          {t('group')}
        </button>
        <button
          disabled={
            busy || !selectedItems.some((item) => item.kind === 'group')
          }
          onClick={() => void ungroup()}
        >
          {t('ungroup')}
        </button>
        <button
          disabled={busy || !selectedItem}
          onClick={() => selectedItem && setEditing(selectedItem)}
        >
          {t('editSelection')}
        </button>
        <button
          disabled={busy || (!selectedItems.length && !selectedEdges.length)}
          onClick={() => void remove()}
        >
          {t('deleteSelection')}
        </button>
      </div>
      <div
        className="board-flow"
        ref={container}
        aria-label={t('canvas')}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          event.preventDefault();
          try {
            const pin = BoardPinSchema.parse(
              JSON.parse(
                event.dataTransfer.getData('application/x-cura-asset-pin'),
              ),
            );
            void addPin(
              pin,
              flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
            );
          } catch {
            setError(t('unsupportedDrop'));
          }
        }}
        onKeyUp={(event) => {
          if (
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
              event.key,
            ) &&
            event.target instanceof Element &&
            event.target.classList.contains('react-flow__node')
          )
            persist();
        }}
        onKeyDown={(event) => {
          if (
            (event.key === 'Delete' || event.key === 'Backspace') &&
            !(
              event.target instanceof HTMLInputElement ||
              event.target instanceof HTMLTextAreaElement ||
              event.target instanceof HTMLSelectElement
            ) &&
            (selectedItems.length || selectedEdges.length)
          ) {
            event.preventDefault();
            void remove();
          }
        }}
      >
        <CanvasContext.Provider
          value={{ busy, selectedSlot, onChoose, onAssign, onHistory, persist }}
        >
          <ReactFlow<CuraNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            ariaLabelConfig={{
              'node.a11yDescription.default': t('nodeHelp'),
              'node.a11yDescription.keyboardDisabled': t('nodeStaticHelp'),
              'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) =>
                t('nodeMoved', {
                  direction: t(`direction_${direction}`),
                  x: Math.round(x),
                  y: Math.round(y),
                }),
              'edge.a11yDescription.default': t('edgeHelp'),
              'controls.ariaLabel': t('canvas'),
              'controls.zoomIn.ariaLabel': t('zoomIn'),
              'controls.zoomOut.ariaLabel': t('zoomOut'),
              'controls.fitView.ariaLabel': t('fit'),
              'controls.interactive.ariaLabel': t('interactive'),
              'minimap.ariaLabel': t('minimap'),
              'handle.ariaLabel': t('connectionHandle'),
            }}
            defaultViewport={document.board.viewport}
            minZoom={0.05}
            maxZoom={8}
            nodesDraggable={!busy}
            nodesConnectable={!busy}
            deleteKeyCode={null}
            selectionKeyCode="Shift"
            multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
            onNodesChange={(changes) =>
              setNodes((previous) => applyNodeChanges(changes, previous))
            }
            onEdgesChange={(changes) =>
              setEdges((previous) => applyEdgeChanges(changes, previous))
            }
            onNodeDragStart={startDrag}
            onNodeDragStop={stopDrag}
            onConnect={connect}
            onNodeDoubleClick={(_event, node) => {
              if (node.data.item) setEditing(node.data.item);
            }}
            onEdgeDoubleClick={(_event, edge) => setEdgeEditing(edge)}
            onMoveEnd={(event, viewport) => {
              if (event) setPendingViewport(viewport);
            }}
            onlyRenderVisibleElements
            proOptions={{ hideAttribution: true }}
          >
            <Background color="var(--border)" gap={24} />
            <MiniMap
              ariaLabel={t('minimap')}
              pannable
              zoomable
              nodeColor="var(--accent)"
              maskColor="color-mix(in srgb, var(--bg), transparent 20%)"
            />
          </ReactFlow>
        </CanvasContext.Provider>
        <div className="board-canvas-controls">
          <button
            aria-label={t('zoomOut')}
            onClick={() => {
              void flow.zoomOut();
              setTimeout(() => setPendingViewport(flow.getViewport()), 0);
            }}
          >
            −
          </button>
          <button
            aria-label={t('fit')}
            onClick={() => {
              void flow
                .fitView({ padding: 0.15 })
                .then(() => setPendingViewport(flow.getViewport()));
            }}
          >
            ⊡
          </button>
          <button
            aria-label={t('zoomIn')}
            onClick={() => {
              void flow.zoomIn();
              setTimeout(() => setPendingViewport(flow.getViewport()), 0);
            }}
          >
            ＋
          </button>
        </div>
        <div className="board-canvas-hint">
          {t('canvasHint')} <span>{t('connectHint')}</span>
        </div>
        {error && (
          <div className="board-inline-error" role="alert">
            {error}
            <button onClick={() => setError('')}>{t('close')}</button>
          </div>
        )}
      </div>
      {editing && (
        <ItemEditor
          item={
            editing === 'new'
              ? {
                  id: crypto.randomUUID(),
                  kind: 'text',
                  ...center(),
                  width: 260,
                  height: 180,
                  groupId: null,
                  label: t('text'),
                  text: t('untitledText'),
                  assetId: null,
                  versionId: null,
                }
              : itemInput(editing)
          }
          onClose={() => setEditing(null)}
          onSave={async (item) => {
            if (
              await onSave({
                items:
                  editing === 'new'
                    ? [...document.items.map(itemInput), item]
                    : document.items.map((existing) =>
                        existing.id === item.id ? item : itemInput(existing),
                      ),
                edges: document.edges.map(edgeInput),
              })
            )
              setEditing(null);
            else throw new Error(t('changeNotSaved'));
          }}
        />
      )}
      {edgeEditing && (
        <EdgeEditor
          edge={edgeEditing}
          onClose={() => setEdgeEditing(null)}
          onSave={async (label) => {
            if (
              await onSave({
                items: document.items.map(itemInput),
                edges: document.edges.map((edge) =>
                  edge.id === edgeEditing.id
                    ? { ...edgeInput(edge), label }
                    : edgeInput(edge),
                ),
              })
            )
              setEdgeEditing(null);
            else throw new Error(t('changeNotSaved'));
          }}
        />
      )}
    </div>
  );
}

function ItemEditor({
  item,
  onSave,
  onClose,
}: {
  item: BoardItemInput;
  onSave: (item: BoardItemInput) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation('boards');
  const [value, setValue] = useState(item);
  return (
    <OrganizationDialog
      title={t('editSelection')}
      onClose={onClose}
      submitLabel={t('save')}
      onSubmit={() => onSave(value)}
    >
      <label>
        {t('label')}
        <input
          maxLength={10000}
          value={value.label}
          onChange={(event) =>
            setValue({ ...value, label: event.target.value })
          }
        />
      </label>
      {item.kind === 'text' && (
        <label>
          {t('text')}
          <textarea
            rows={6}
            maxLength={100000}
            value={value.text}
            onChange={(event) =>
              setValue({ ...value, text: event.target.value })
            }
          />
        </label>
      )}
      <div className="board-dimension-fields">
        {(['width', 'height'] as const).map((field) => (
          <label key={field}>
            {t(field)}
            <input
              type="number"
              required
              min={80}
              max={20000}
              value={value[field]}
              onChange={(event) =>
                setValue({
                  ...value,
                  [field]: event.target.valueAsNumber || 80,
                })
              }
            />
          </label>
        ))}
      </div>
    </OrganizationDialog>
  );
}
function EdgeEditor({
  edge,
  onSave,
  onClose,
}: {
  edge: Edge;
  onSave: (label: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation('boards');
  const [label, setLabel] = useState(
    typeof edge.label === 'string' ? edge.label : '',
  );
  return (
    <OrganizationDialog
      title={t('editConnection')}
      onClose={onClose}
      submitLabel={t('save')}
      onSubmit={() => onSave(label)}
    >
      <label>
        {t('edgeLabel')}
        <input
          value={label}
          maxLength={10000}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
    </OrganizationDialog>
  );
}
