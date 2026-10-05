import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import * as C from '@cura/shared';
it('separates confirmation transport from persisted export requests while preserving selection validation', () => {
  const request = {
    scope: 'selection',
    assetIds: [randomUUID()],
    expectedPreviewToken: 'a'.repeat(64),
  };
  expect(C.ExportCreateRequestSchema.parse(request)).toEqual(request);
  expect(C.ExportRequestSchema.safeParse(request).success).toBe(false);
  expect(
    C.ExportCreateRequestSchema.safeParse({ ...request, assetIds: [] }).success,
  ).toBe(false);
  expect(
    C.ExportCreateRequestSchema.safeParse({ ...request, scope: 'library' })
      .success,
  ).toBe(false);
  expect(
    C.ExportCreateRequestSchema.safeParse({
      ...request,
      expectedPreviewToken: 'arbitrary',
    }).success,
  ).toBe(false);
  expect(C.ExportCreateRequestSchema.parse({})).toEqual({
    scope: 'library',
    assetIds: [],
  });
});
it('validates actual deduplicated asset counts and overlapping reason counts', () => {
  const requested = randomUUID(),
    dependency = randomUUID();
  const preview = {
    libraryId: randomUUID(),
    scope: 'selection',
    requestedAssetIds: [requested],
    includedDependencyAssetIds: [dependency],
    requestedAssetCount: 1,
    dependencyAssetCount: 1,
    totalAssetCount: 2,
    reasons: [
      { reason: 'board', count: 1 },
      { reason: 'brand', count: 1 },
    ],
    previewToken: 'a'.repeat(64),
  };
  expect(C.ExportPreviewSchema.parse(preview)).toEqual(preview);
  expect(
    C.ExportPreviewSchema.safeParse({ ...preview, totalAssetCount: 3 }).success,
  ).toBe(false);
  expect(
    C.ExportPreviewSchema.safeParse({
      ...preview,
      requestedAssetIds: [requested, requested],
      requestedAssetCount: 2,
      totalAssetCount: 3,
    }).success,
  ).toBe(false);
  expect(
    C.ExportPreviewSchema.safeParse({
      ...preview,
      includedDependencyAssetIds: [requested],
    }).success,
  ).toBe(false);
  expect(
    C.ExportPreviewSchema.safeParse({
      ...preview,
      reasons: [{ reason: 'board', count: 2 }],
    }).success,
  ).toBe(false);
  expect(
    C.ExportPreviewSchema.safeParse({
      ...preview,
      reasons: [
        { reason: 'board', count: 1 },
        { reason: 'board', count: 1 },
      ],
    }).success,
  ).toBe(false);
});
