import { describe, expect, it } from 'vitest';
import type { BoardItemInput } from '@cura/shared';
import {
  absolutePosition,
  groupItems,
  removeItems,
  toFlowNodes,
} from './model';
const item = (
  id: string,
  x: number,
  y: number,
  groupId: string | null = null,
): BoardItemInput => ({
  id,
  kind: 'text',
  x,
  y,
  width: 120,
  height: 80,
  groupId,
  label: id,
  text: 'Note',
  assetId: null,
  versionId: null,
});
describe('board coordinate model', () => {
  it('keeps a selected descendant inside its selected ancestor when regrouping', () => {
    const items = [
      { ...item('outer', 100, 50), kind: 'group' as const },
      { ...item('inner', 120, 80, 'outer'), kind: 'group' as const },
      item('note', 145, 110, 'inner'),
      item('other', 350, 200),
    ];
    const result = groupItems(
      items,
      new Set(['outer', 'note', 'other']),
      'new',
      'Group',
    );
    expect(result.find((entry) => entry.id === 'note')?.groupId).toBe('inner');
  });
  it('round-trips nested absolute storage coordinates through relative canvas positions', () => {
    const nodes = toFlowNodes([
      { ...item('outer', 100, 50), kind: 'group' },
      { ...item('inner', 120, 80, 'outer'), kind: 'group' },
      item('note', 145, 110, 'inner'),
    ]);
    expect(nodes.map((node) => node.id)).toEqual(['outer', 'inner', 'note']);
    expect(nodes[2]?.position).toEqual({ x: 25, y: 30 });
    expect(absolutePosition('note', nodes)).toEqual({ x: 145, y: 110 });
    expect(
      absolutePosition(
        'note',
        nodes.map((node) =>
          node.id === 'outer'
            ? { ...node, position: { x: 200, y: 150 } }
            : node,
        ),
      ),
    ).toEqual({ x: 245, y: 210 });
  });
  it('groups selected roots while preserving nested relationships and absolute coordinates', () => {
    const items = [
      { ...item('group', 100, 100), kind: 'group' as const },
      item('child', 120, 130, 'group'),
      item('other', 300, 200),
    ];
    const grouped = groupItems(
      items,
      new Set(['group', 'child', 'other']),
      'new',
      'References',
    );
    expect(grouped.find((entry) => entry.id === 'child')).toEqual(items[1]);
    expect(grouped.find((entry) => entry.id === 'group')?.groupId).toBe('new');
    expect(grouped.find((entry) => entry.id === 'other')?.groupId).toBe('new');
    expect(grouped.find((entry) => entry.id === 'new')).toMatchObject({
      kind: 'group',
      label: 'References',
      x: 76,
      y: 56,
      width: 368,
      height: 248,
    });
  });
  it('removes a group without deleting its children or leaving dangling connections', () => {
    const result = removeItems(
      [
        { ...item('group', 100, 100), kind: 'group' },
        item('child', 120, 130, 'group'),
        item('other', 300, 200),
      ],
      [
        { id: 'edge', sourceId: 'group', targetId: 'other', label: '' },
        { id: 'keep', sourceId: 'child', targetId: 'other', label: '' },
      ],
      new Set(['group']),
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      id: 'child',
      x: 120,
      y: 130,
      groupId: null,
    });
    expect(result.edges.map((edge) => edge.id)).toEqual(['keep']);
  });
});
