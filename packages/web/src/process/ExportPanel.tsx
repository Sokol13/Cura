import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ExportPreviewSchema,
  type ExportJob,
  type ExportPreview,
  type ExportRequest,
  type ExportDependencyReason,
} from '@cura/shared';
import { ApiError, request } from '../catalog/api';
import './i18n';
import './process.css';
// Export jobs are retained server-side. A list started before a POST may omit that
// job, and a queued POST response may arrive after the list already reports it done.
function reconcileJobs(
  current: ExportJob[],
  incoming: ExportJob[],
  libraryId: string,
): ExportJob[] {
  const jobs = new Map(
    current
      .filter((job) => job.libraryId === libraryId)
      .map((job) => [job.id, job]),
  );
  const phase = (job: ExportJob) =>
    job.status === 'queued' ? 0 : job.status === 'running' ? 1 : 2;
  for (const next of incoming) {
    if (next.libraryId !== libraryId) continue;
    const previous = jobs.get(next.id);
    if (
      previous &&
      (phase(previous) > phase(next) ||
        (phase(previous) === phase(next) &&
          (previous.progress > next.progress ||
            (previous.progress === next.progress &&
              previous.updatedAt > next.updatedAt))))
    )
      continue;
    jobs.set(next.id, next);
  }
  return [...jobs.values()].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
  );
}
interface ExportPanelProps {
  libraryId: string;
  assetIds?: string[];
}
interface PreviewOrigin {
  input: ExportRequest;
  revision: number;
}
const reasonLabels: Record<ExportDependencyReason, string> = {
  board: 'exportReasonBoard',
  brand: 'exportReasonBrand',
  automation: 'exportReasonAutomation',
  fcpxml: 'exportReasonFcpxml',
  'sync-conflict': 'exportReasonConflict',
  'similar-to': 'exportReasonSimilar',
  'generation-output': 'exportReasonGeneration',
};
export function ExportPanel(props: ExportPanelProps) {
  // A library revisit gets a new lifetime, even when an old request ignores abort.
  return <LibraryExportPanel key={props.libraryId} {...props} />;
}
function LibraryExportPanel({ libraryId, assetIds = [] }: ExportPanelProps) {
  const { t } = useTranslation('process');
  const selectionKey = [...new Set(assetIds)].sort().join(',');
  const [chosenScope, setScope] = useState<ExportRequest['scope']>(
    selectionKey ? 'selection' : 'library',
  );
  const scope = selectionKey ? chosenScope : 'library';
  const input = useMemo<ExportRequest>(
    () => ({
      scope,
      assetIds: scope === 'selection' ? selectionKey.split(',') : [],
    }),
    [scope, selectionKey],
  );
  const [previewRevision, setPreviewRevision] = useState(0);
  const origin = useMemo<PreviewOrigin>(
    () => ({ input, revision: previewRevision }),
    [input, previewRevision],
  );
  const currentOrigin = useRef<PreviewOrigin | null>(origin);
  currentOrigin.current = origin;
  const mounted = useRef(false);
  const submitting = useRef<PreviewOrigin | null>(null);
  const [submission, setSubmission] = useState<PreviewOrigin | null>(null);
  const [result, setResult] = useState<{
    origin: PreviewOrigin;
    value?: ExportPreview;
    error?: unknown;
  } | null>(null);
  const [creationError, setCreationError] = useState<{
    origin: PreviewOrigin;
    reason: unknown;
  } | null>(null);
  const [staleInput, setStaleInput] = useState<ExportRequest | null>(null);
  const [jobs, setJobs] = useState<ExportJob[]>([]),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const activeResult = result?.origin === origin ? result : null;
  const preview = activeResult?.value;
  const busy = submission === origin;
  const previewError = activeResult?.error;
  const displayError = (reason: unknown) =>
    reason instanceof ApiError && reason.code === 'EXPORT_PREVIEW_MISMATCH'
      ? t('exportPreviewMismatch')
      : reason instanceof Error
        ? reason.message
        : t('error');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted && currentOrigin.current === origin;
    void request<unknown>(`/api/libraries/${libraryId}/exports/preview`, {
      method: 'POST',
      body: origin.input,
      signal: controller.signal,
    })
      .then((response) => {
        if (!current()) return;
        const parsed = ExportPreviewSchema.safeParse(response);
        if (
          !parsed.success ||
          parsed.data.libraryId !== libraryId ||
          parsed.data.scope !== origin.input.scope ||
          (origin.input.scope === 'selection' &&
            [...parsed.data.requestedAssetIds].sort().join(',') !==
              origin.input.assetIds?.join(','))
        ) {
          throw new ApiError('EXPORT_PREVIEW_MISMATCH', '');
        }
        setResult({ origin, value: parsed.data });
      })
      .catch((reason: unknown) => {
        if (current()) setResult({ origin, error: reason });
      });
    return () => controller.abort();
  }, [libraryId, origin]);
  useEffect(() => {
    const controller = new AbortController();
    void request<ExportJob[]>(`/api/libraries/${libraryId}/exports`, {
      signal: controller.signal,
    })
      .then((loaded) => {
        if (!controller.signal.aborted)
          setJobs((current) => reconcileJobs(current, loaded, libraryId));
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : t('error'));
      });
    return () => controller.abort();
  }, [libraryId, revision, t]);
  useEffect(() => {
    if (
      !jobs.some((job) => job.status === 'queued' || job.status === 'running')
    )
      return;
    const timer = window.setTimeout(
      () => setRevision((value) => value + 1),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [jobs]);
  const refreshPreview = () => {
    // Invalidate before React repaints, including back-to-back native events.
    currentOrigin.current = null;
    setPreviewRevision((value) => value + 1);
  };
  const start = async () => {
    if (
      !preview ||
      currentOrigin.current !== origin ||
      submitting.current === origin
    )
      return;
    submitting.current = origin;
    setSubmission(origin);
    setCreationError(null);
    setStaleInput(null);
    const current = () => mounted.current && currentOrigin.current === origin;
    try {
      const job = await request<ExportJob>(
        `/api/libraries/${libraryId}/exports`,
        {
          method: 'POST',
          body: { ...origin.input, expectedPreviewToken: preview.previewToken },
        },
      );
      // Jobs belong to the library even when the preview selection has changed.
      if (mounted.current)
        setJobs((previous) => reconcileJobs(previous, [job], libraryId));
    } catch (reason) {
      if (!current()) return;
      if (
        reason instanceof ApiError &&
        reason.status === 409 &&
        reason.code === 'EXPORT_PREVIEW_STALE'
      ) {
        setStaleInput(origin.input);
        refreshPreview();
      } else setCreationError({ origin, reason });
    } finally {
      if (submitting.current === origin) submitting.current = null;
      if (current()) setSubmission(null);
    }
  };
  const selectedLabel = t('exportSelected', {
    count: preview?.requestedAssetCount ?? input.assetIds?.length ?? 0,
  });
  let confirmation = scope === 'library' ? t('exportLibrary') : selectedLabel;
  if (scope === 'selection' && preview && preview.dependencyAssetCount > 0) {
    const allBoard =
      preview.reasons.find((reason) => reason.reason === 'board')?.count ===
      preview.dependencyAssetCount;
    confirmation = t(
      allBoard ? 'exportWithBoardAssets' : 'exportWithDependencies',
      {
        selected: selectedLabel,
        count: preview.dependencyAssetCount,
      },
    );
  }
  return (
    <section className="process-export">
      <h2>{t('portableExport')}</h2>
      <p>{t('exportHint')}</p>
      <p className="process-muted">{t('exportSelectionHint')}</p>
      <div className="process-controls export-confirmation">
        <label>
          {t('exportScope')}
          <select
            value={scope}
            onChange={(event) => {
              currentOrigin.current = null;
              setScope(event.target.value as ExportRequest['scope']);
            }}
          >
            <option value="selection" disabled={!selectionKey}>
              {t('selection')}
            </option>
            <option value="library">{t('wholeLibrary')}</option>
          </select>
        </label>
        <button disabled={!preview || busy} onClick={() => void start()}>
          {confirmation}
        </button>
      </div>
      {!activeResult && <p role="status">{t('exportPreviewLoading')}</p>}
      {preview && (
        <div className="export-preview" aria-live="polite">
          <p>{t('exportAssetTotal', { count: preview.totalAssetCount })}</p>
          {preview.reasons.length > 0 && (
            <>
              <ul>
                {preview.reasons.map((reason) => (
                  <li key={reason.reason}>
                    {t('exportReasonCount', {
                      reason: t(reasonLabels[reason.reason]!),
                      count: reason.count,
                    })}
                  </li>
                ))}
              </ul>
              <p className="process-muted">{t('exportReasonOverlap')}</p>
            </>
          )}
        </div>
      )}
      {staleInput === input && <p role="alert">{t('exportPreviewStale')}</p>}
      {previewError !== undefined && (
        <>
          <p role="alert">{displayError(previewError)}</p>
          <button onClick={refreshPreview}>{t('exportPreviewRetry')}</button>
        </>
      )}
      {creationError?.origin === origin && (
        <p role="alert">{displayError(creationError.reason)}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {jobs
        .filter((job) => job.libraryId === libraryId)
        .map((job) => (
          <section
            className="process-job"
            key={job.id}
            aria-label={t('exportJob', {
              scope: t(
                job.request.scope === 'library' ? 'wholeLibrary' : 'selection',
              ),
            })}
          >
            <h3>
              {t(
                job.request.scope === 'library' ? 'wholeLibrary' : 'selection',
              )}{' '}
              · {new Date(job.createdAt).toLocaleString()}
            </h3>
            <p>{t(job.status)}</p>
            <progress value={job.progress} max={1} />
            {job.error && <p role="status">{job.error}</p>}
            {job.exceptions.map((exception, index) => (
              <p key={index}>{exception.message}</p>
            ))}
            {job.status === 'completed' && (
              <>
                <p>
                  {t('archiveSize', {
                    size: (job.bytes / 1024 / 1024).toFixed(2),
                  })}
                </p>
                <a
                  href={`/api/exports/${job.id}/file`}
                  download={job.filename ?? 'cura-export.zip'}
                >
                  {t('downloadArchive')}
                </a>
              </>
            )}
          </section>
        ))}
    </section>
  );
}
