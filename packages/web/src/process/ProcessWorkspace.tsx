import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GenerateRequestSchema,
  type Asset,
  type GenerationJob,
  type ProcessStatistics,
  type ProcessTimeline,
} from '@cura/shared';
import { assetUrl, request } from '../catalog/api';
import './i18n';
import './process.css';

type AssetPage = { items: Asset[]; total: number };
const active = (job: GenerationJob) =>
  job.status === 'queued' || job.status === 'running';
const percentage = (rate: number) => `${(rate * 100).toFixed(1)}%`;
export function ProcessWorkspace({
  libraryId,
  onBack,
}: {
  libraryId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation('process');
  const [tab, setTab] = useState<'timeline' | 'generator'>('timeline');
  const [statistics, setStatistics] = useState<ProcessStatistics>();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState('');
  const [timeline, setTimeline] = useState<ProcessTimeline>();
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [form, setForm] = useState({
    prompt: '',
    negativePrompt: '',
    model: 'cura-mock-v1',
    seed: '42',
    width: 512,
    height: 384,
    count: 1,
    mockOutcome: 'complete',
  });
  const report = useCallback(
    (reason: unknown) => {
      if (!(reason instanceof Error && reason.name === 'AbortError'))
        setError(reason instanceof Error ? reason.message : t('error'));
    },
    [t],
  );
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const [stats, loadedJobs] = await Promise.all([
        request<ProcessStatistics>(
          `/api/libraries/${libraryId}/process`,
          signal ? { signal } : {},
        ),
        request<GenerationJob[]>(
          `/api/libraries/${libraryId}/generations`,
          signal ? { signal } : {},
        ),
      ]);
      setStatistics(stats);
      setJobs(loadedJobs);
    },
    [libraryId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch(report);
    return () => controller.abort();
  }, [refresh, report, revision]);
  useEffect(() => {
    const controller = new AbortController();
    void request<AssetPage>(
      `/api/libraries/${libraryId}/assets?limit=200&q=${encodeURIComponent(query)}`,
      { signal: controller.signal },
    )
      .then((page) => {
        setAssets(page.items);
        setAssetId((current) => current || page.items[0]?.id || '');
      })
      .catch(report);
    return () => controller.abort();
  }, [libraryId, query, revision, report]);
  useEffect(() => {
    if (!assetId) {
      setTimeline(undefined);
      return;
    }
    const controller = new AbortController();
    setTimeline(undefined);
    void request<ProcessTimeline>(`/api/assets/${assetId}/process`, {
      signal: controller.signal,
    })
      .then(setTimeline)
      .catch(report);
    return () => controller.abort();
  }, [assetId, revision, report]);
  const hasActive = jobs.some(active);
  useEffect(() => {
    if (!hasActive) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void refresh(controller.signal)
        .then(() => setRevision((value) => value + 1))
        .catch(report);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [jobs, hasActive, refresh, report]);
  const mutate = async (operation: () => Promise<unknown>) => {
    setError('');
    setBusy(true);
    try {
      await operation();
      await refresh();
      setRevision((value) => value + 1);
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void mutate(async () => {
      const parsed = GenerateRequestSchema.parse(form);
      const job = await request<GenerationJob>(
        `/api/libraries/${libraryId}/generations`,
        { method: 'POST', body: parsed },
      );
      setJobs((current) => [job, ...current]);
    });
  };
  const currentVersion = timeline?.entries.at(-1);
  const manualCurrent = currentVersion?.finalSelections.some(
    (selection) => selection.ownerKind === 'manual',
  );
  const groups = (title: string, rows: ProcessStatistics['models']) => (
    <section>
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('group')}</th>
            <th>{t('recorded')}</th>
            <th>{t('chosen')}</th>
            <th>{t('hitRate')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.key || t('unknown')}</td>
              <td>{row.outputs}</td>
              <td>{row.selectedOutputs}</td>
              <td>{percentage(row.hitRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
  return (
    <main className="process-workspace">
      <header className="process-header">
        <button onClick={onBack}>← {t('back')}</button>
        <h1>{t('title')}</h1>
        <button onClick={() => setRevision((value) => value + 1)}>
          {t('refresh')}
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {statistics && (
        <>
          <div className="process-metrics">
            <strong>{t('outputs', { count: statistics.outputs })}</strong>
            <strong>
              {t('selected', { count: statistics.selectedOutputs })}
            </strong>
            <div>
              <strong>{percentage(statistics.hitRate)}</strong>
              <span>{t('hitRate')}</span>
            </div>
          </div>
          <p className="process-muted">{t('counting')}</p>
          {statistics.legacyBackfilledOutputs > 0 && (
            <p>{t('legacy', { count: statistics.legacyBackfilledOutputs })}</p>
          )}
          <div className="process-groups">
            {groups(t('models'), statistics.models)}
            {groups(t('sources'), statistics.sources)}
          </div>
        </>
      )}
      <nav className="process-tabs" aria-label={t('title')}>
        <button
          aria-pressed={tab === 'timeline'}
          onClick={() => setTab('timeline')}
        >
          {t('timeline')}
        </button>
        <button
          aria-pressed={tab === 'generator'}
          onClick={() => setTab('generator')}
        >
          {t('generator')}
        </button>
      </nav>
      {tab === 'timeline' ? (
        <section>
          <div className="process-controls">
            <label>
              {t('search')}
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              {t('choose')}
              <select
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
              >
                {!assets.some((asset) => asset.id === assetId) && assetId && (
                  <option value={assetId}>
                    {currentVersion?.version.name ?? t('loading')}
                  </option>
                )}
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            {currentVersion && (
              <button
                disabled={busy}
                onClick={() =>
                  void mutate(() =>
                    request(`/api/assets/${assetId}`, {
                      method: 'PATCH',
                      body: { finalized: !manualCurrent },
                    }),
                  )
                }
              >
                {t(manualCurrent ? 'unfinalize' : 'finalize')}
              </button>
            )}
          </div>
          {!assetId && <p>{t('empty')}</p>}
          <ol className="process-timeline">
            {timeline?.entries.map(({ version, finalSelections }, index) => (
              <li key={version.id}>
                <img src={assetUrl(version.id, 'file')} alt={version.name} />
                <div>
                  <h2>
                    V{version.ordinal} · {version.name}
                  </h2>
                  <p className="process-muted">
                    {new Date(version.createdAt).toLocaleString()}{' '}
                    {index === timeline.entries.length - 1 &&
                      `· ${t('current')}`}
                  </p>
                  <div className="process-pins">
                    {finalSelections.map((selection) => (
                      <span key={selection.id}>
                        {t(
                          selection.ownerKind === 'manual' ? 'manual' : 'slot',
                        )}
                      </span>
                    ))}
                  </div>
                  <dl>
                    {(
                      [
                        'prompt',
                        'negativePrompt',
                        'model',
                        'source',
                        'seed',
                      ] as const
                    ).map((key) => (
                      <div key={key}>
                        <dt>
                          {t(key === 'negativePrompt' ? 'negative' : key)}
                        </dt>
                        <dd>{version[key] || '—'}</dd>
                      </div>
                    ))}
                  </dl>
                  <details>
                    <summary>{t('parameters')}</summary>
                    <pre>{JSON.stringify(version.params, null, 2)}</pre>
                  </details>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className="process-generator">
          <form onSubmit={submit}>
            <h2>{t('generator')}</h2>
            <p>{t('mockHint')}</p>
            <label>
              {t('prompt')}
              <textarea
                required
                value={form.prompt}
                onChange={(event) =>
                  setForm({ ...form, prompt: event.target.value })
                }
              />
            </label>
            <label>
              {t('negative')}
              <textarea
                value={form.negativePrompt}
                onChange={(event) =>
                  setForm({ ...form, negativePrompt: event.target.value })
                }
              />
            </label>
            <div className="process-form-grid">
              {(['model', 'seed'] as const).map((key) => (
                <label key={key}>
                  {t(key)}
                  <input
                    required
                    value={form[key]}
                    onChange={(event) =>
                      setForm({ ...form, [key]: event.target.value })
                    }
                  />
                </label>
              ))}
              {(['width', 'height', 'count'] as const).map((key) => (
                <label key={key}>
                  {t(key)}
                  <input
                    type="number"
                    required
                    min={key === 'count' ? 1 : 64}
                    max={key === 'count' ? 4 : 1024}
                    value={form[key]}
                    onChange={(event) =>
                      setForm({ ...form, [key]: Number(event.target.value) })
                    }
                  />
                </label>
              ))}
              <label>
                {t('behavior')}
                <select
                  value={form.mockOutcome}
                  onChange={(event) =>
                    setForm({ ...form, mockOutcome: event.target.value })
                  }
                >
                  <option value="complete">{t('complete')}</option>
                  <option value="fail">{t('fail')}</option>
                </select>
              </label>
            </div>
            <button disabled={busy} type="submit">
              {t('generate')}
            </button>
          </form>
          <div>
            <h2>{t('jobs')}</h2>
            {jobs.length === 0 && <p>{t('noJobs')}</p>}
            {jobs.map((job) => (
              <section
                className="process-job"
                aria-label={t('job', { prompt: job.request.prompt })}
                key={job.id}
              >
                <h3>{job.request.prompt}</h3>
                <p>{t(job.status)}</p>
                <progress value={job.progress} max={1} />
                {job.error && <p role="status">{job.error}</p>}
                {active(job) && (
                  <button
                    onClick={() =>
                      void mutate(() =>
                        request(`/api/generations/${job.id}/cancel`, {
                          method: 'POST',
                        }),
                      )
                    }
                  >
                    {t('cancel')}
                  </button>
                )}
                {job.assetIds.map((id, index) => (
                  <button
                    key={id}
                    onClick={() => {
                      setAssetId(id);
                      setTab('timeline');
                    }}
                  >
                    {t('result', { count: index + 1 })}
                  </button>
                ))}
              </section>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
