export class SyncError extends Error {
  constructor(
    message: string,
    readonly code = 'SYNC_ERROR',
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}
export function invalidGraph(message: string): never {
  throw new SyncError(message, 'SYNC_INVALID_GRAPH', 409);
}
