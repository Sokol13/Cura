import type { SupabaseClient } from '@supabase/supabase-js';
import * as S from '@cura/shared';
import { SyncError } from './errors.js';
export class SyncCloud {
  constructor(private readonly client: () => SupabaseClient) {}
  private async rpc<T>(
    name: string,
    input: Record<string, unknown>,
    schema: { parse: (value: unknown) => T },
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted)
      throw new SyncError('Sync was cancelled', 'SYNC_CANCELLED', 499);
    let request = this.client().rpc(name, input);
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) {
      if (signal?.aborted)
        throw new SyncError('Sync was cancelled', 'SYNC_CANCELLED', 499);
      if (error.message === 'CURA_SYNC_CONFLICT')
        throw new SyncError(
          'Remote metadata changed; merging retained local work',
          'SYNC_CONFLICT',
          409,
        );
      if (error.message === 'CURA_SYNC_FORBIDDEN')
        throw new SyncError(
          'Cloud library access was revoked or this role cannot perform this action',
          'SYNC_FORBIDDEN',
          403,
        );
      if (error.message === 'CURA_SYNC_LIMIT')
        throw new SyncError(
          'Cloud metadata exceeds the supported 10000-record or 16 MiB transaction limit',
          'SYNC_LIMIT',
          413,
        );
      if (error.message.startsWith('CURA_SYNC_'))
        throw new SyncError(
          'Cloud rejected an invalid synchronization operation',
          error.message.slice(5),
          400,
        );
      if (error.code === 'PGRST301' || error.code === 'PGRST303')
        throw new SyncError(
          'Cloud authentication expired; sign in again',
          'SYNC_AUTH_EXPIRED',
          401,
        );
      throw new SyncError(
        'Cloud is unavailable; local changes remain on this device',
        'SYNC_OFFLINE',
        503,
      );
    }
    try {
      return schema.parse(data);
    } catch {
      throw new SyncError(
        'Cloud returned invalid or unsupported metadata',
        'SYNC_INVALID_RESPONSE',
        502,
      );
    }
  }
  async list(signal?: AbortSignal): Promise<S.SyncRemoteLibrary[]> {
    return (
      await this.rpc(
        'cura_sync_libraries',
        {},
        S.SyncLibrariesEnvelopeSchema,
        signal,
      )
    ).libraries;
  }
  async create(
    libraryId: string,
    name: string,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<S.SyncRemoteLibrary> {
    return (
      await this.rpc(
        'cura_sync_create_library',
        { p_library_id: libraryId, p_name: name, p_operation_id: operationId },
        S.SyncLibraryEnvelopeSchema,
        signal,
      )
    ).library;
  }
  async manifest(
    libraryId: string,
    signal?: AbortSignal,
  ): Promise<S.SyncManifest> {
    const value = await this.rpc(
      'cura_sync_manifest',
      { p_library_id: libraryId },
      S.SyncManifestSchema,
      signal,
    );
    if (
      value.library.id !== libraryId ||
      value.sequence !== value.library.head ||
      new Set(value.records.map((row) => `${row.kind}:${row.key}`)).size !==
        value.records.length ||
      value.records.some(
        (row) => row.payload && row.payload.libraryId !== libraryId,
      )
    )
      throw new SyncError(
        'Cloud manifest has inconsistent identity',
        'SYNC_INVALID_RESPONSE',
        502,
      );
    return value;
  }
  async pull(
    libraryId: string,
    after: string,
    signal?: AbortSignal,
  ): Promise<S.SyncPull> {
    const value = await this.rpc(
      'cura_sync_pull',
      { p_library_id: libraryId, p_after: after, p_limit: 20 },
      S.SyncPullSchema,
      signal,
    );
    if (
      BigInt(value.cursor) < BigInt(after) ||
      (value.commits.length
        ? BigInt(value.commits[0]!.sequence) <= BigInt(after)
        : value.cursor !== after) ||
      value.commits.some((commit) =>
        commit.changes.some(
          (row) => row.payload && row.payload.libraryId !== libraryId,
        ),
      )
    )
      throw new SyncError(
        'Cloud cursor or library identity is inconsistent',
        'SYNC_INVALID_RESPONSE',
        502,
      );
    return value;
  }
  async commit(
    libraryId: string,
    operationId: string,
    changes: S.SyncChange[],
    signal?: AbortSignal,
  ): Promise<S.SyncCommit> {
    return this.rpc(
      'cura_sync_commit',
      {
        p_library_id: libraryId,
        p_operation_id: operationId,
        p_changes: changes,
      },
      S.SyncCommitSchema,
      signal,
    );
  }
  async members(
    libraryId: string,
    signal?: AbortSignal,
  ): Promise<S.SyncMember[]> {
    const value = await this.rpc(
      'cura_sync_members',
      { p_library_id: libraryId },
      S.SyncMembersEnvelopeSchema,
      signal,
    );
    return value.members.map((member) => ({ ...member, libraryId }));
  }
  async setMember(
    libraryId: string,
    userId: string,
    role: 'editor' | 'viewer' | null,
    signal?: AbortSignal,
  ): Promise<S.SyncMember[]> {
    const value = await this.rpc(
      'cura_sync_set_member',
      { p_library_id: libraryId, p_user_id: userId, p_role: role },
      S.SyncMembersEnvelopeSchema,
      signal,
    );
    return value.members.map((member) => ({ ...member, libraryId }));
  }
}
