import type { ScanSummary } from '@cura/shared';

export const scanLibraryId = '00000000-0000-4000-8000-000000000001';
export const scanRootId = '00000000-0000-4000-8000-000000000002';
export function scanSummary(patch: Partial<ScanSummary> = {}): ScanSummary {
  return {
    scanId: '00000000-0000-4000-8000-000000000003',
    libraryId: scanLibraryId,
    rootId: scanRootId,
    status: 'completed',
    phase: 'finished',
    recursive: true,
    startedAt: '2026-10-05T00:00:00.000Z',
    finishedAt: '2026-10-05T00:00:01.000Z',
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:01.000Z',
    filesFound: 0,
    supportedFound: 0,
    existingGenericFound: 0,
    unsupportedSkipped: 0,
    processed: 0,
    succeeded: 0,
    readErrors: 0,
    symlinksSkipped: 0,
    specialEntriesSkipped: 0,
    extensions: [],
    otherExtensionFiles: 0,
    errors: [],
    omittedErrors: 0,
    ...patch,
  };
}
