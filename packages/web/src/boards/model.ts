import type { BoardEdgeInput, BoardItemInput } from '@cura/shared';

type PositionedNode = {
  id: string;
  parentId?: string;
  position: { x: number; y: number };
};
export function absolutePosition(
  id: string,
  nodes: PositionedNode[],
): { x: number; y: number } {
  const node = nodes.find((entry) => entry.id === id);
  if (!node) return { x: 0, y: 0 };
  const visited = new Set([id]);
  const position = { ...node.position };
  let parentId = node.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodes.find((entry) => entry.id === parentId);
    if (!parent) break;
    position.x += parent.position.x;
    position.y += parent.position.y;
    parentId = parent.parentId;
  }
  return position;
}
export function toFlowNodes(items: BoardItemInput[]): PositionedNode[] {
  const result: PositionedNode[] = [];
  const visited = new Set<string>();
  const visit = (item: BoardItemInput) => {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    const parent = items.find((entry) => entry.id === item.groupId);
    if (parent) visit(parent);
    result.push({
      id: item.id,
      position: { x: item.x - (parent?.x ?? 0), y: item.y - (parent?.y ?? 0) },
      ...(parent ? { parentId: parent.id } : {}),
    });
  };
  items.forEach(visit);
  return result;
}
export function groupItems(
  items: BoardItemInput[],
  selected: Set<string>,
  id: string,
  label: string,
): BoardItemInput[] {
  const roots = items.filter(
    (item) => selected.has(item.id) && !selected.has(item.groupId ?? ''),
  );
  if (!roots.length) return items;
  const x = Math.min(...roots.map((item) => item.x)) - 24;
  const y = Math.min(...roots.map((item) => item.y)) - 44;
  const right = Math.max(...roots.map((item) => item.x + item.width)) + 24;
  const bottom = Math.max(...roots.map((item) => item.y + item.height)) + 24;
  const rootIds = new Set(roots.map((item) => item.id));
  return [
    {
      id,
      kind: 'group',
      x,
      y,
      width: right - x,
      height: bottom - y,
      groupId: null,
      label,
      text: '',
      assetId: null,
      versionId: null,
    },
    ...items.map((item) =>
      rootIds.has(item.id) ? { ...item, groupId: id } : item,
    ),
  ];
}
export function removeItems(
  items: BoardItemInput[],
  edges: BoardEdgeInput[],
  selected: Set<string>,
) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return {
    items: items
      .filter((item) => !selected.has(item.id))
      .map((item) => {
        let groupId = item.groupId;
        while (groupId && selected.has(groupId))
          groupId = byId.get(groupId)?.groupId ?? null;
        return { ...item, groupId };
      }),
    edges: edges.filter(
      (edge) => !selected.has(edge.sourceId) && !selected.has(edge.targetId),
    ),
  };
}
export function itemInput(item: BoardItemInput): BoardItemInput {
  const {
    id,
    kind,
    x,
    y,
    width,
    height,
    groupId,
    label,
    text,
    assetId,
    versionId,
  } = item;
  return {
    id,
    kind,
    x,
    y,
    width,
    height,
    groupId,
    label,
    text,
    assetId,
    versionId,
  };
}
export function edgeInput(edge: BoardEdgeInput): BoardEdgeInput {
  const { id, sourceId, targetId, label } = edge;
  return { id, sourceId, targetId, label };
}
