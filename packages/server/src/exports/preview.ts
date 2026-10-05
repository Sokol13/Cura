import { createHash } from 'node:crypto';
import * as C from '@cura/shared';
import type { ExportSnapshot } from './snapshot.js';

/** Confirmation concerns asset membership and dependency reasons, not mutable metadata. */
export function exportPreview(snapshot: ExportSnapshot): C.ExportPreview {
  const { manifest } = snapshot;
  const includedAssetIds = [
    ...new Set(manifest.assets.map((asset) => asset.id)),
  ].sort();
  const requestedAssetIds =
    manifest.scope === 'library'
      ? includedAssetIds
      : [...new Set(manifest.requestedAssetIds)].sort();
  const includedDependencyAssetIds = [
    ...new Set(manifest.includedDependencyAssetIds),
  ].sort();
  const reasonsById = new Map(
    snapshot.dependencies.map((value) => [value.assetId, value.reasons]),
  );
  const dependencies = includedDependencyAssetIds.map((assetId) => ({
    assetId,
    reasons: [...new Set(reasonsById.get(assetId) ?? [])].sort(),
  }));
  const counts = new Map<C.ExportDependencyReason, number>();
  for (const dependency of dependencies)
    for (const reason of dependency.reasons)
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const previewToken = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        libraryId: manifest.library.id,
        scope: manifest.scope,
        requestedAssetIds,
        includedAssetIds,
        dependencies,
      }),
    )
    .digest('hex');
  return C.ExportPreviewSchema.parse({
    libraryId: manifest.library.id,
    scope: manifest.scope,
    requestedAssetIds,
    includedDependencyAssetIds,
    requestedAssetCount: requestedAssetIds.length,
    dependencyAssetCount: includedDependencyAssetIds.length,
    totalAssetCount: includedAssetIds.length,
    reasons: C.ExportDependencyReasonSchema.options.flatMap((reason) =>
      counts.has(reason) ? [{ reason, count: counts.get(reason)! }] : [],
    ),
    previewToken,
  });
}
