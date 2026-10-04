import { useCallback } from 'react';
import { AssetSchema, type BoardPin } from '@cura/shared';
import { request } from '../catalog/api';
import { edgeInput, itemInput } from './model';
import type { useBoardDocument } from './useBoardDocument';

// Resolve the asset name asynchronously, then append against the document that
// the serialized mutation actually owns. Never submit a captured full layout.
export function useBoardAssetAdder(
  boardId: string | null,
  mutate: ReturnType<typeof useBoardDocument>['mutate'],
) {
  return useCallback(
    async (pin: BoardPin, position: { x: number; y: number }) => {
      if (!boardId) return false;
      const asset = AssetSchema.parse(
        await request(`/api/assets/${pin.assetId}`),
      );
      return mutate(`/api/boards/${boardId}/layout`, 'PUT', (current) => ({
        expectedRevision: current.board.revision,
        items: [
          ...current.items.map(itemInput),
          {
            id: crypto.randomUUID(),
            kind: 'asset',
            ...position,
            width: 240,
            height: 220,
            groupId: null,
            label: asset.name,
            text: '',
            assetId: pin.assetId,
            versionId: pin.versionId,
          },
        ],
        edges: current.edges.map(edgeInput),
      }));
    },
    [boardId, mutate],
  );
}
