import * as C from '@cura/shared';
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
    ).map((row) => C.GenerationJobSchema.parse(JSON.parse(row.payload))),
  };
}
