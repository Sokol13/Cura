import * as C from '@cura/shared';
import { randomUUID } from 'node:crypto';
import { publicGenerationError } from './errors.js';
import { setFinalSelection } from './final-selections.js';
import type { AppDatabase } from '../database.js';

type Row = Record<string, unknown>;
const camel = (row: Row): Row =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
export class ProcessError extends Error {
  constructor(
    message: string,
    readonly statusCode = 404,
    readonly code = 'PROCESS_NOT_FOUND',
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}
export class ProcessStore {
  constructor(readonly database: AppDatabase) {}
  requireLibrary(libraryId: string): void {
    if (
      !this.database.sqlite
        .prepare('SELECT id FROM libraries WHERE id=?')
        .get(libraryId)
    )
      throw new ProcessError('Library not found');
  }
  generations(libraryId: string): C.RecordedGeneration[] {
    this.requireLibrary(libraryId);
    return (
      this.database.sqlite
        .prepare(
          'SELECT * FROM recorded_generations WHERE library_id=? ORDER BY created_at,id',
        )
        .all(libraryId) as Row[]
    ).map((row) => C.RecordedGenerationSchema.parse(camel(row)));
  }
  selections(libraryId: string): C.FinalSelection[] {
    this.requireLibrary(libraryId);
    return (
      this.database.sqlite
        .prepare(
          'SELECT * FROM final_selections WHERE library_id=? ORDER BY created_at,id',
        )
        .all(libraryId) as Row[]
    ).map((row) => C.FinalSelectionSchema.parse(camel(row)));
  }
  timeline(assetId: string): C.ProcessTimeline {
    const asset = this.database.sqlite
      .prepare('SELECT library_id FROM assets WHERE id=?')
      .get(assetId) as { library_id: string } | undefined;
    if (!asset) throw new ProcessError('Asset not found');
    const selections = this.selections(asset.library_id);
    const versions = (
      this.database.sqlite
        .prepare(
          'SELECT payload FROM asset_versions WHERE asset_id=? ORDER BY ordinal,id',
        )
        .all(assetId) as { payload: string }[]
    ).map((row) => C.AssetVersionSchema.parse(JSON.parse(row.payload)));
    return C.ProcessTimelineSchema.parse({
      assetId,
      entries: versions.map((version) => ({
        version,
        generationId: version.generationId,
        finalSelections: selections.filter(
          (selection) => selection.versionId === version.id,
        ),
      })),
    });
  }
  setManualSelection(
    assetId: string,
    input: C.ManualSelectionRequest,
  ): C.ProcessTimeline {
    const data = C.ManualSelectionRequestSchema.parse(input);
    return this.database.sqlite.transaction(() => {
      const asset = this.database.sqlite
        .prepare(
          "SELECT library_id,json_extract(payload,'$.currentVersionId') AS version_id FROM assets WHERE id=?",
        )
        .get(assetId) as { library_id: string; version_id: string } | undefined;
      if (!asset) throw new ProcessError('Asset not found');
      const previous = this.database.sqlite
        .prepare(
          "SELECT version_id FROM final_selections WHERE library_id=? AND owner_kind='manual' AND owner_id=?",
        )
        .get(asset.library_id, assetId) as { version_id: string } | undefined;
      if (
        asset.version_id !== data.versionId ||
        (previous?.version_id ?? null) !== data.expectedSelectionVersionId
      )
        throw new ProcessError(
          'The asset or manual selection changed. Review the refreshed timeline before selecting a version.',
          409,
          'PROCESS_SELECTION_CONFLICT',
        );
      setFinalSelection(
        this.database,
        { libraryId: asset.library_id, ownerKind: 'manual', ownerId: assetId },
        data.selected ? { assetId, versionId: data.versionId } : null,
      );
      if (
        (previous?.version_id ?? null) !==
        (data.selected ? data.versionId : null)
      ) {
        const date = new Date().toISOString();
        this.database.sqlite
          .prepare('INSERT INTO activity VALUES (?,?,?,?,?,?,?)')
          .run(
            randomUUID(),
            asset.library_id,
            assetId,
            'process.manual-selection',
            JSON.stringify({
              versionId: data.versionId,
              selected: data.selected,
              previousVersionId: previous?.version_id ?? null,
            }),
            date,
            date,
          );
      }
      return this.timeline(assetId);
    })();
  }
  statistics(libraryId: string): C.ProcessStatistics {
    const generations = this.generations(libraryId);
    const selected = new Set(
      (
        this.database.sqlite
          .prepare(
            "SELECT DISTINCT json_extract(v.payload,'$.generationId') AS id FROM final_selections f JOIN asset_versions v ON v.id=f.version_id WHERE f.library_id=?",
          )
          .all(libraryId) as { id: string }[]
      ).map((row) => row.id),
    );
    const grouped = (field: 'model' | 'source') => {
      const groups = new Map<
        string,
        {
          key: string;
          outputs: number;
          selectedOutputs: number;
          hitRate: number;
        }
      >();
      for (const generation of generations) {
        const key = generation[field].normalize('NFC').trim().toLowerCase();
        const group = groups.get(key) ?? {
          key,
          outputs: 0,
          selectedOutputs: 0,
          hitRate: 0,
        };
        group.outputs++;
        if (selected.has(generation.id)) group.selectedOutputs++;
        group.hitRate = group.selectedOutputs / group.outputs;
        groups.set(key, group);
      }
      return [...groups.values()].sort(
        (a, b) => b.outputs - a.outputs || a.key.localeCompare(b.key),
      );
    };
    const selectedOutputs = generations.filter((generation) =>
      selected.has(generation.id),
    ).length;
    return C.ProcessStatisticsSchema.parse({
      libraryId,
      outputs: generations.length,
      selectedOutputs,
      hitRate: generations.length ? selectedOutputs / generations.length : 0,
      models: grouped('model'),
      sources: grouped('source'),
      countingMethod: 'distinct-recorded-generations',
      legacyBackfilledOutputs: generations.filter(
        (generation) => generation.origin === 'legacy-backfill',
      ).length,
    });
  }
  jobs(libraryId: string): C.GenerationJob[] {
    this.requireLibrary(libraryId);
    return (
      this.database.sqlite
        .prepare(
          'SELECT payload FROM generation_jobs WHERE library_id=? ORDER BY created_at DESC,id',
        )
        .all(libraryId) as { payload: string }[]
    ).map((row) => C.GenerationJobSchema.parse(JSON.parse(row.payload)));
  }
  job(id: string): C.GenerationJob {
    const row = this.database.sqlite
      .prepare('SELECT payload FROM generation_jobs WHERE id=?')
      .get(id) as { payload: string } | undefined;
    if (!row) throw new ProcessError('Generation job not found');
    return C.GenerationJobSchema.parse(JSON.parse(row.payload));
  }
  createJob(libraryId: string, request: C.GenerateRequest): C.GenerationJob {
    this.requireLibrary(libraryId);
    const date = new Date().toISOString();
    const job = C.GenerationJobSchema.parse({
      id: randomUUID(),
      libraryId,
      provider: 'mock',
      status: 'queued',
      progress: 0,
      request: C.GenerateRequestSchema.parse(request),
      assetIds: [],
      error: null,
      createdAt: date,
      updatedAt: date,
    });
    this.database.sqlite
      .prepare('INSERT INTO generation_jobs VALUES (?,?,?,?,?)')
      .run(job.id, libraryId, JSON.stringify(job), date, date);
    return job;
  }
  updateJob(
    id: string,
    patch: Partial<
      Pick<C.GenerationJob, 'status' | 'progress' | 'assetIds' | 'error'>
    >,
  ): C.GenerationJob {
    const job = C.GenerationJobSchema.parse({
      ...this.job(id),
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    this.database.sqlite
      .prepare('UPDATE generation_jobs SET payload=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(job), job.updatedAt, id);
    return job;
  }
}

export function readProcessExport(database: AppDatabase, libraryId: string) {
  const store = new ProcessStore(database);
  return {
    generations: store.generations(libraryId),
    finalSelections: store.selections(libraryId),
    jobs: (
      database.sqlite
        .prepare(
          'SELECT payload FROM generation_jobs WHERE library_id=? ORDER BY created_at,id',
        )
        .all(libraryId) as { payload: string }[]
    ).map((row) => {
      const job = C.GenerationJobSchema.parse(JSON.parse(row.payload));
      // Sanitize historical operational errors too; request/provenance fields remain exact.
      return {
        ...job,
        error: job.error === null ? null : publicGenerationError(job.error),
      };
    }),
  };
}
