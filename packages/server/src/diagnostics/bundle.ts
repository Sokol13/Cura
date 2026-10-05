import { readFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import * as S from '@cura/shared';
import type { CatalogStore } from '../catalog-store.js';
import type { UserPaths } from '../paths.js';
import { runDatabaseIntegrity } from './integrity.js';

export interface DiagnosticsProviders {
  diagnosticLogs?: () => Promise<S.DiagnosticLogsSnapshot>;
  mediaQueueSnapshot?: () => S.MediaQueueDiagnostics | undefined;
  integrityCheck?: (
    databasePath: string,
  ) => Promise<S.DatabaseIntegrityDiagnostics>;
}
const packageVersion: unknown = (
  JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>
).version;
function collected<T>(
  read: () => T,
  code: string,
): { value: T | null; capture: S.DiagnosticCapture } {
  try {
    return { value: read(), capture: { status: 'ok' } };
  } catch {
    return { value: null, capture: { status: 'unavailable', code } };
  }
}

function rootScans(store: CatalogStore): {
  value: S.DiagnosticRootScan[];
  capture: S.DiagnosticCapture;
} {
  try {
    let partial = false;
    const value = store.diagnosticRoots().map((root): S.DiagnosticRootScan => {
      try {
        const summary = store.scanStore.get(root.rootId);
        const latestScanSummary = summary
          ? S.RedactedScanSummarySchema.parse({
              ...summary,
              errors: summary.errors.map((error) => ({
                ...error,
                relativePath: null,
              })),
            })
          : null;
        return { ...root, latestScanSummary, capture: { status: 'ok' } };
      } catch {
        partial = true;
        return {
          ...root,
          latestScanSummary: null,
          capture: { status: 'unavailable', code: 'SCAN_SUMMARY_INVALID' },
        };
      }
    });
    return {
      value,
      capture: partial
        ? { status: 'partial', code: 'SCAN_SUMMARY_INVALID' }
        : { status: 'ok' },
    };
  } catch {
    return {
      value: [],
      capture: { status: 'unavailable', code: 'SCAN_SUMMARIES_UNAVAILABLE' },
    };
  }
}

async function readLogs(
  provider: DiagnosticsProviders['diagnosticLogs'],
): Promise<S.DiagnosticLogsSnapshot> {
  if (!provider)
    return {
      entries: [],
      capture: { status: 'unavailable', code: 'DIAGNOSTICS_NOT_CONFIGURED' },
    };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const source: unknown = await Promise.race([
      Promise.resolve().then(provider),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Diagnostic logs unavailable')),
          5000,
        );
      }),
    ]);
    if (
      !source ||
      typeof source !== 'object' ||
      !('entries' in source) ||
      !Array.isArray(source.entries) ||
      !('capture' in source)
    )
      throw new Error('Invalid diagnostics');
    const capture = S.DiagnosticCaptureSchema.parse(source.capture);
    let dropped = source.entries.length > 200;
    const entries = source.entries
      .flatMap((entry: unknown) => {
        const parsed = S.DiagnosticLogSchema.safeParse(entry);
        if (parsed.success) return [parsed.data];
        dropped = true;
        return [];
      })
      .slice(-200);
    return S.DiagnosticLogsSnapshotSchema.parse({
      entries,
      capture:
        dropped && capture.status === 'ok'
          ? { status: 'partial', code: 'LOGS_SANITIZED' }
          : capture,
    });
  } catch {
    return {
      entries: [],
      capture: { status: 'unavailable', code: 'LOGS_CAPTURE_FAILED' },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function buildDiagnosticsBundle(
  store: CatalogStore,
  paths: UserPaths,
  providers: DiagnosticsProviders = {},
): Promise<Uint8Array> {
  const createdAt = new Date().toISOString();
  // The queue is captured immediately; collecting it never queues a worker job.
  const queue = collected(
    () => S.MediaQueueDiagnosticsSchema.parse(providers.mediaQueueSnapshot?.()),
    providers.mediaQueueSnapshot
      ? 'QUEUE_CAPTURE_FAILED'
      : 'DIAGNOSTICS_NOT_CONFIGURED',
  );
  const stats = collected(
    () => S.DiagnosticStatsSchema.parse(store.stats()),
    'STATS_CAPTURE_FAILED',
  );
  const previews = collected(
    () => S.PreviewStateCountsSchema.parse(store.previewStateCounts()),
    'PREVIEW_COUNTS_FAILED',
  );
  const scans = rootScans(store);
  const integrity = (async (): Promise<S.DatabaseIntegrityDiagnostics> => {
    try {
      return S.DatabaseIntegrityDiagnosticsSchema.parse(
        await (providers.integrityCheck ?? runDatabaseIntegrity)(
          join(paths.data, 'cura.sqlite'),
        ),
      );
    } catch {
      return {
        status: 'error',
        checkedAt: new Date().toISOString(),
        durationMs: 0,
        integrityCheck: 'not-run',
        foreignKeyCheck: 'not-run',
        issues: [],
        truncated: false,
        code: 'INTEGRITY_WORKER_FAILED',
      };
    }
  })();
  const [logs, checks] = await Promise.all([
    readLogs(providers.diagnosticLogs),
    integrity,
  ]);
  const safeToken = (value: unknown) => {
    const parsed = S.DiagnosticsSystemSchema.shape.release.safeParse(value);
    return parsed.success ? parsed.data : 'unknown';
  };
  const diagnostics = S.DiagnosticsSchema.parse({
    schemaVersion: 1,
    createdAt,
    pathsRedacted: true,
    version: safeToken(packageVersion),
    platform:
      S.DiagnosticsSystemSchema.shape.platform.safeParse(platform()).data ??
      'unknown',
    release: safeToken(release()),
    arch:
      S.DiagnosticsSystemSchema.shape.arch.safeParse(arch()).data ?? 'unknown',
    node: safeToken(process.versions.node),
    stats: stats.value,
    rootScanSummaries: scans.value,
    mediaQueue: queue.value,
    previewStates: previews.value,
    integrity: checks,
    capture: {
      stats: stats.capture,
      scans: scans.capture,
      queue: queue.capture,
      previewStates: previews.capture,
      logs: logs.capture,
    },
  });
  return zipSync({
    'diagnostics.json': strToU8(JSON.stringify(diagnostics, null, 2)),
    'logs.json': strToU8(JSON.stringify(logs.entries, null, 2)),
  });
}
