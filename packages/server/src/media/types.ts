import type { PreviewFailure } from '@cura/shared';

export interface GenerationMetadata {
  prompt: string;
  negativePrompt: string;
  model: string;
  seed: string;
  source: string;
  params: Record<string, unknown>;
}

export interface ProcessedDiagnostic {
  operation: 'metadata' | 'thumbnail';
  code:
    | 'METADATA_PARSE_WARNINGS'
    | 'EXIF_PARSE_FAILED'
    | 'EXIF_SIZE_LIMIT'
    | 'PSD_NATIVE_PREVIEW_UNAVAILABLE'
    | 'NATIVE_THUMBNAIL_FAILED'
    | 'THUMBNAIL_SIZE_LIMIT';
  count?: number;
}
export const MEDIA_FAILURE_CODES = [
  'EACCES',
  'EPERM',
  'ENOENT',
  'ENOTDIR',
  'EIO',
  'EBUSY',
  'ENOSPC',
  'EMFILE',
  'ENFILE',
  'ELOOP',
  'ENAMETOOLONG',
  'EBADF',
  'ENOMEM',
  'ESTALE',
  'ETIMEDOUT',
  'EINVAL',
  'ROOT_CHANGED',
  'SOURCE_UNAVAILABLE',
  'FILE_CHANGED',
  'UNSAFE_CACHE',
  'MEDIA_QUEUE_FULL',
  'MEDIA_CLOSED',
  'ROOT_REMOVING',
  'SCAN_SAVE_FAILED',
] as const;
export interface MediaDiagnostic {
  level: 'warn' | 'error';
  operation: 'scan' | 'metadata' | 'thumbnail' | 'media';
  code:
    | ProcessedDiagnostic['code']
    | PreviewFailure['error']
    | (typeof MEDIA_FAILURE_CODES)[number]
    | 'MEDIA_OPERATION_FAILED'
    | 'MEDIA_WORKER_FAILED'
    | 'SCAN_PARTIAL'
    | 'SCAN_FAILED'
    | 'SCAN_INTERRUPTED'
    | 'SCAN_RECOVERED_INTERRUPTED'
    | 'PSD_PREVIEW_RECOVERY'
    | 'INBOX_MIGRATION_FAILED';
  libraryId?: string;
  rootId?: string;
  assetId?: string;
  versionId?: string;
  count?: number;
}

export interface ProcessedFile {
  hash: string;
  size: number;
  type: string;
  width: number | null;
  height: number | null;
  colors: string[];
  phash: string;
  exif: Record<string, unknown>;
  generation: GenerationMetadata;
  snapshotPath: string;
  thumbnailPath: string | null;
  diagnostics?: ProcessedDiagnostic[];
}
