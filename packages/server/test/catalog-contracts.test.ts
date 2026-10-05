import { describe, expect, it } from 'vitest';
import * as shared from '@cura/shared';

describe('catalog contracts', () => {
  it('publishes strict query and exact generation metadata contracts', () => {
    expect(shared).toHaveProperty('AssetQuerySchema');
    expect(shared).toHaveProperty('GenerationSchema');
    const metadata = {
      prompt: '',
      negativePrompt: '',
      model: '',
      source: '',
      seed: '18446744073709551615',
      params: {},
    };
    expect(shared.GenerationSchema.parse(metadata).seed).toBe(metadata.seed);
    expect(
      shared.GenerationSchema.safeParse({
        ...metadata,
        seed: 18446744073709551615n,
      }).success,
    ).toBe(false);
    expect(
      shared.GenerationSchema.safeParse({ ...metadata, seed: 123 }).success,
    ).toBe(false);
  });
  it('bounds coercible query values and rejects unknown filters and metadata fields', () => {
    expect(
      shared.AssetQuerySchema.parse({
        rating: '5',
        trash: 'false',
        limit: '200',
      }),
    ).toMatchObject({ rating: 5, trash: false, limit: 200, offset: 0 });
    for (const input of [
      { limit: 201 },
      { limit: 0 },
      { offset: -1 },
      { rating: 6 },
      { trash: 'yes' },
      { unknown: 'field' },
    ])
      expect(shared.AssetQuerySchema.safeParse(input).success).toBe(false);
    expect(
      shared.UpdateAssetSchema.safeParse({ snapshotPath: '/private/file' })
        .success,
    ).toBe(false);
    expect(
      shared.CreateAnnotationSchema.safeParse({
        versionId: crypto.randomUUID(),
        x: 1.1,
        y: 0.5,
        text: 'outside',
      }).success,
    ).toBe(false);
    expect(
      shared.CreateLibrarySchema.parse({ name: '角色-e\u0301' }).name,
    ).toBe('角色-é');
  });
  it('requires safe upload filenames and persists typed settings defaults', () => {
    for (const name of ['../image.png', '..', 'a/b.png', 'a\\b.png'])
      expect(shared.UploadQuerySchema.safeParse({ name }).success).toBe(false);
    expect(shared.SettingsSchema.parse({})).toEqual({
      activeLibraryId: null,
      language: 'zh-CN',
      theme: 'dark',
      layout: 'grid',
      sidebarWidth: 240,
      inspectorWidth: 320,
    });
  });
});

it('defaults root removal to trash, rejects unknown modes and parses the optional missing-source filter', () => {
  expect(shared.RemoveRootQuerySchema.parse({})).toEqual({ mode: 'trash' });
  expect(shared.RemoveRootQuerySchema.parse({ mode: 'offline' })).toEqual({
    mode: 'offline',
  });
  for (const input of [
    { mode: 'delete-originals' },
    { mode: 'trash', path: '/private' },
    { mode: null },
  ])
    expect(shared.RemoveRootQuerySchema.safeParse(input).success).toBe(false);
  expect(shared.AssetQuerySchema.parse({ missing: 'true' }).missing).toBe(true);
  expect(shared.AssetQuerySchema.parse({ missing: 'false' }).missing).toBe(
    false,
  );
  expect(shared.AssetQuerySchema.parse({}).missing).toBeUndefined();
  expect(shared.AssetQuerySchema.safeParse({ missing: 'yes' }).success).toBe(
    false,
  );
  const result = {
    ok: true,
    rootId: crypto.randomUUID(),
    libraryId: crypto.randomUUID(),
    affected: 2,
    trashed: 1,
    offline: 0,
    keptAvailable: 1,
  };
  expect(shared.RemoveRootResultSchema.parse(result)).toEqual(result);
  expect(
    shared.RemoveRootResultSchema.safeParse({ ...result, trashed: -1 }).success,
  ).toBe(false);
});
