const filesystemMessages: Record<string, string> = {
  ENOTDIR:
    'Generation could not save its output because a library directory is unavailable. Check local library storage, then retry.',
  ENOENT:
    'Generation could not save its output because a library directory is unavailable. Check local library storage, then retry.',
  EACCES:
    'Generation could not save its output. Check local library folder permissions, then retry.',
  EPERM:
    'Generation could not save its output. Check local library folder permissions, then retry.',
  EBUSY:
    'Generation could not save its output because a file is in use. Close the application using it, then retry.',
  ENOSPC:
    'Generation could not save its output because local storage is full. Free disk space, then retry.',
};
const fallback =
  'Generation failed. Check local file access and available disk space, then retry.';
const publicMessages = new Set([
  ...Object.values(filesystemMessages),
  fallback,
  'Simulated mock-provider failure. No external service was contacted.',
  'Generation was interrupted by a server restart. Retry this local mock request.',
  'Generation queue is busy. Retry shortly.',
]);
/** Operational failures may contain private filesystem paths. Authored metadata is never passed here. */
export function publicGenerationError(error: unknown): string {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';
  if (publicMessages.has(message)) return message;
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : /^(ENOTDIR|ENOENT|EACCES|EPERM|EBUSY|ENOSPC)(?=[:\s,])/.exec(
          message,
        )?.[1];
  return (code ? filesystemMessages[code] : undefined) ?? fallback;
}
