import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as C from '@cura/shared';
import { request, assetUrl } from '../catalog/api';
import './i18n';
import './fcpxml.css';
const initial = (): C.FcpxmlInput => ({
  name: 'Timeline',
  timebase: '25',
  width: 1920,
  height: 1080,
  clips: [],
});
const phase = (job: C.FcpxmlJob) =>
  job.status === 'queued' ? 0 : job.status === 'running' ? 1 : 2;
function reconcileFcpxmlJobs(
  current: C.FcpxmlJob[],
  incoming: C.FcpxmlJob[],
  libraryId: string,
) {
  const values = new Map(
    current.filter((j) => j.libraryId === libraryId).map((j) => [j.id, j]),
  );
  for (const next of incoming) {
    if (next.libraryId !== libraryId) continue;
    const old = values.get(next.id);
    if (
      !old ||
      phase(next) > phase(old) ||
      (phase(next) === phase(old) &&
        next.progress >= old.progress &&
        next.updatedAt >= old.updatedAt)
    )
      values.set(next.id, next);
  }
  return [...values.values()].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}
export function FcpxmlWorkspace({
  libraryId,
  onBack,
}: {
  libraryId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation('fcpxml');
  const [timeline, setTimeline] = useState(initial),
    [query, setQuery] = useState(''),
    [loadingAssets, setLoadingAssets] = useState(true),
    [offset, setOffset] = useState(0),
    [page, setPage] = useState<{ items: C.Asset[]; total: number }>({
      items: [],
      total: 0,
    }),
    [assetId, setAssetId] = useState(''),
    [versions, setVersions] = useState<C.AssetVersion[]>([]),
    [versionId, setVersionId] = useState(''),
    [sourceVersions, setSourceVersions] = useState<
      Record<string, C.AssetVersion>
    >({}),
    [boards, setBoards] = useState<C.Board[]>([]),
    [boardId, setBoardId] = useState(''),
    [jobs, setJobs] = useState<C.FcpxmlJob[]>([]),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submitting = useRef(false),
    currentLibrary = useRef(libraryId);
  currentLibrary.current = libraryId;
  const report = useCallback(
    (reason: unknown) => {
      if (!(reason instanceof Error && reason.name === 'AbortError'))
        setError(reason instanceof Error ? reason.message : t('error'));
    },
    [t],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoadingAssets(true);
    void request<{ items: C.Asset[]; total: number }>(
      `/api/libraries/${libraryId}/assets?limit=100&offset=${offset}&q=${encodeURIComponent(query)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setPage(result);
      })
      .catch(report)
      .finally(() => {
        if (!controller.signal.aborted) setLoadingAssets(false);
      });
    return () => controller.abort();
  }, [libraryId, query, offset, report]);
  useEffect(() => {
    setVersions([]);
    setVersionId('');
    if (!assetId) return;
    const controller = new AbortController();
    void request<C.AssetVersion[]>(`/api/assets/${assetId}/versions`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          setVersions(result);
          setVersionId(result[0]?.id ?? '');
        }
      })
      .catch(report);
    return () => controller.abort();
  }, [assetId, report]);
  useEffect(() => {
    const controller = new AbortController();
    void request<C.Board[]>(`/api/libraries/${libraryId}/boards`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setBoards(result);
      })
      .catch(report);
    return () => controller.abort();
  }, [libraryId, report]);
  useEffect(() => {
    const controller = new AbortController();
    void request<C.FcpxmlJob[]>(`/api/libraries/${libraryId}/fcpxml`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted)
          setJobs((current) => reconcileFcpxmlJobs(current, result, libraryId));
      })
      .catch(report);
    return () => controller.abort();
  }, [libraryId, revision, report]);
  const sourceAssets = [...new Set(timeline.clips.map((clip) => clip.assetId))]
    .sort()
    .join(',');
  useEffect(() => {
    const controller = new AbortController();
    const ids = sourceAssets ? sourceAssets.split(',') : [];
    // Bound concurrent metadata reads when importing a large board.
    let next = 0;
    const load = async () => {
      while (next < ids.length && !controller.signal.aborted) {
        const id = ids[next++]!;
        try {
          const versions = await request<C.AssetVersion[]>(
            `/api/assets/${id}/versions`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted)
            setSourceVersions((current) => ({
              ...current,
              ...Object.fromEntries(versions.map((v) => [v.id, v])),
            }));
        } catch (reason) {
          report(reason);
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, ids.length) }, load));
    return () => controller.abort();
  }, [sourceAssets, report]);
  useEffect(() => {
    if (
      !jobs.some(
        (j) =>
          j.libraryId === libraryId &&
          (j.status === 'queued' || j.status === 'running'),
      )
    )
      return;
    const timer = setTimeout(() => setRevision((r) => r + 1), 400);
    return () => clearTimeout(timer);
  }, [jobs, libraryId]);
  const changeClip = (id: string, patch: Partial<C.FcpxmlClip>) =>
    setTimeline((current) => ({
      ...current,
      clips: current.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  const selectAsset = (id: string) => {
    setAssetId(id);
    setVersions([]);
    setVersionId('');
  };
  const resetPicker = () => {
    selectAsset('');
    setPage({ items: [], total: 0 });
    setLoadingAssets(true);
  };
  const add = () => {
    const version = versions.find((v) => v.id === versionId);
    if (
      !version ||
      version.assetId !== assetId ||
      loadingAssets ||
      !page.items.some((asset) => asset.id === assetId)
    )
      return;
    const rate =
      Number(timeline.timebase.split('/')[0]) /
      Number(timeline.timebase.split('/')[1] ?? 1);
    setTimeline((current) => ({
      ...current,
      clips: [
        ...current.clips,
        {
          id: crypto.randomUUID(),
          assetId,
          versionId,
          label: version.name,
          durationFrames: Math.round(rate * 5),
          inFrames: 0,
        },
      ],
    }));
  };
  const inspect = async (clip: C.FcpxmlClip) => {
    try {
      setError('');
      const timing = await request<C.FcpxmlVideoTiming>(
        `/api/versions/${clip.versionId}/fcpxml-source`,
      );
      changeClip(clip.id, { videoTiming: timing });
    } catch (reason) {
      report(reason);
    }
  };
  const move = (index: number, direction: number) =>
    setTimeline((current) => {
      const clips = [...current.clips];
      const next = index + direction;
      if (next < 0 || next >= clips.length) return current;
      [clips[index], clips[next]] = [clips[next]!, clips[index]!];
      return { ...current, clips };
    });
  const importBoard = async () => {
    if (!boardId || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const document = await request<C.BoardDocument>(`/api/boards/${boardId}`);
      const pins = [
        ...document.items
          .filter((item) => item.assetId && item.versionId)
          .map((item) => ({
            id: item.id,
            assetId: item.assetId!,
            versionId: item.versionId!,
            label: item.label,
            createdAt: item.createdAt,
          })),
        ...document.slots
          .filter((slot) => slot.currentPin)
          .map((slot) => ({
            id: slot.id,
            ...slot.currentPin!,
            label: slot.label,
            createdAt: slot.createdAt,
          })),
      ].sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
      if (pins.length + timeline.clips.length > 1000)
        throw new Error(t('limits'));
      const frames = Math.round(
        (5 * Number(timeline.timebase.split('/')[0])) /
          Number(timeline.timebase.split('/')[1] ?? 1),
      );
      setTimeline((current) => ({
        ...current,
        clips: [
          ...current.clips,
          ...pins.map((pin) => ({
            id: crypto.randomUUID(),
            assetId: pin.assetId,
            versionId: pin.versionId,
            label: pin.label.slice(0, 300),
            durationFrames: frames,
            inFrames: 0,
          })),
        ],
      }));
    } catch (reason) {
      report(reason);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const start = async () => {
    if (submitting.current) return;
    const parsed = C.CreateFcpxmlSchema.safeParse(timeline);
    if (!parsed.success) {
      setError(t('invalid'));
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const job = await request<C.FcpxmlJob>(
        `/api/libraries/${libraryId}/fcpxml`,
        { method: 'POST', body: parsed.data },
      );
      if (currentLibrary.current === libraryId)
        setJobs((current) => reconcileFcpxmlJobs(current, [job], libraryId));
    } catch (reason) {
      report(reason);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const total = timeline.clips.reduce((sum, c) => sum + c.durationFrames, 0),
    [n, d = '1'] = timeline.timebase.split('/');
  return (
    <main className="fcpxml-workspace">
      <header>
        <button onClick={onBack}>{t('back')}</button>
        <h1>{t('title')}</h1>
      </header>
      <p>{t('hint')}</p>
      <p className="fcpxml-muted">{t('scope')}</p>
      {error && <p role="alert">{error}</p>}
      <div className="fcpxml-settings">
        <label>
          {t('name')}
          <input
            value={timeline.name}
            maxLength={300}
            onChange={(e) => setTimeline({ ...timeline, name: e.target.value })}
          />
        </label>
        <label>
          {t('timebase')}
          <select
            aria-label={t('timebase')}
            value={timeline.timebase}
            onChange={(e) =>
              setTimeline({
                ...timeline,
                timebase: e.target.value as C.FcpxmlTimebase,
              })
            }
          >
            {C.FcpxmlTimebaseSchema.options.map((rate) => (
              <option key={rate}>{rate}</option>
            ))}
          </select>
        </label>
        {(['width', 'height'] as const).map((field) => (
          <label key={field}>
            {t(field)}
            <input
              type="number"
              min={16}
              max={8192}
              value={timeline[field]}
              onChange={(e) =>
                setTimeline({ ...timeline, [field]: Number(e.target.value) })
              }
            />
          </label>
        ))}
      </div>
      <div className="fcpxml-columns">
        <aside>
          <label>
            {t('search')}
            <input
              value={query}
              onChange={(e) => {
                resetPicker();
                setQuery(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label>
            {t('asset')}
            <select
              aria-label={t('asset')}
              value={assetId}
              disabled={loadingAssets || busy}
              onChange={(e) => selectAsset(e.target.value)}
            >
              <option value="">{t('noAsset')}</option>
              {page.items.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {C.assetDisplayName(asset)}
                </option>
              ))}
            </select>
          </label>
          <p>
            {t('selection', { shown: page.items.length, total: page.total })}
          </p>
          <div className="fcpxml-actions">
            <button
              disabled={loadingAssets || offset === 0}
              onClick={() => {
                resetPicker();
                setOffset((v) => Math.max(0, v - 100));
              }}
            >
              {t('previous')}
            </button>
            <button
              disabled={loadingAssets || offset + 100 >= page.total}
              onClick={() => {
                resetPicker();
                setOffset((v) => v + 100);
              }}
            >
              {t('next')}
            </button>
          </div>
          <label>
            {t('version')}
            <select
              aria-label={t('version')}
              value={versionId}
              disabled={!assetId || loadingAssets || busy}
              onChange={(e) => setVersionId(e.target.value)}
            >
              <option value="">{t('noVersion')}</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  V{version.ordinal} · {version.name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={
              !versionId ||
              loadingAssets ||
              busy ||
              timeline.clips.length >= 1000
            }
            onClick={add}
          >
            {t('add')}
          </button>
          <hr />
          <label>
            {t('board')}
            <select
              aria-label={t('board')}
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
            >
              <option value="">{t('noBoard')}</option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!boardId || busy}
            onClick={() => void importBoard()}
          >
            {t('importBoard')}
          </button>
          <p className="fcpxml-muted">{t('boardHint')}</p>
        </aside>
        <section aria-label={t('title')}>
          <div className="fcpxml-actions">
            <p>
              {t('total', {
                count: timeline.clips.length,
                frames: total,
                seconds: ((total * Number(d)) / Number(n)).toFixed(3),
              })}
            </p>
            <button
              disabled={busy || !timeline.clips.length}
              onClick={() =>
                setTimeline((current) => ({ ...current, clips: [] }))
              }
            >
              {t('clear')}
            </button>
          </div>
          {!timeline.clips.length && <p>{t('empty')}</p>}
          <ol className="fcpxml-clips">
            {timeline.clips.map((clip, index) => (
              <li key={clip.id} data-clip-id={clip.id}>
                <section aria-label={t('clip', { number: index + 1 })}>
                  <h2>{t('clip', { number: index + 1 })}</h2>
                  <div className="fcpxml-clip">
                    <img
                      src={assetUrl(clip.versionId, 'thumbnail')}
                      alt=""
                      loading="lazy"
                    />
                    <div>
                      <small>{clip.versionId}</small>
                      <label>
                        {t('label')}
                        <input
                          value={clip.label}
                          maxLength={300}
                          onChange={(e) =>
                            changeClip(clip.id, { label: e.target.value })
                          }
                        />
                      </label>
                      <div className="fcpxml-settings">
                        <label>
                          {t('duration')}
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={clip.durationFrames}
                            onChange={(e) =>
                              changeClip(clip.id, {
                                durationFrames: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          {t('inPoint')}
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={clip.inFrames}
                            onChange={(e) =>
                              changeClip(clip.id, {
                                inFrames: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </div>
                      {clip.videoTiming && (
                        <p>
                          {t('sourceVerified', {
                            rate: clip.videoTiming.frameRate,
                            frames: clip.videoTiming.durationFrames,
                            width: clip.videoTiming.width,
                            height: clip.videoTiming.height,
                            audio: t(clip.videoTiming.audio),
                          })}
                        </p>
                      )}
                      {sourceVersions[clip.versionId]?.type.startsWith(
                        'video/',
                      ) && (
                        <>
                          <p>{!clip.videoTiming ? t('sourceNeeded') : ''}</p>
                          <button onClick={() => void inspect(clip)}>
                            {t('source')}
                          </button>
                        </>
                      )}
                      {sourceVersions[clip.versionId]?.type.startsWith(
                        'image/',
                      ) && <p>{t('still')}</p>}
                    </div>
                  </div>
                  <div className="fcpxml-actions">
                    <button
                      aria-label={t('up', { number: index + 1 })}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      aria-label={t('down', { number: index + 1 })}
                      disabled={index === timeline.clips.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      aria-label={t('remove', { number: index + 1 })}
                      onClick={() =>
                        setTimeline((current) => ({
                          ...current,
                          clips: current.clips.filter((c) => c.id !== clip.id),
                        }))
                      }
                    >
                      {t('remove', { number: index + 1 })}
                    </button>
                  </div>
                </section>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <div className="fcpxml-actions">
        <button
          disabled={busy || !timeline.clips.length}
          onClick={() => void start()}
        >
          {t('export')}
        </button>
        <p>{t('limits')}</p>
      </div>
      <p>{t('portable')}</p>
      <h2>{t('history')}</h2>
      <button onClick={() => setRevision((r) => r + 1)}>{t('refresh')}</button>
      {jobs
        .filter((job) => job.libraryId === libraryId)
        .map((job) => (
          <section
            className="fcpxml-job"
            key={job.id}
            aria-label={t('job', { name: job.request.name })}
          >
            <h3>{job.request.name}</h3>
            <p role="status">{t(job.status)}</p>
            <progress value={job.progress} max={1} />
            <button disabled={busy} onClick={() => setTimeline(job.request)}>
              {t('load')}
            </button>
            {job.error && <p>{job.error}</p>}
            {job.problems.map((problem, index) => (
              <p key={index}>
                {problem.clipId
                  ? `${job.request.clips.findIndex((c) => c.id === problem.clipId) + 1}. `
                  : ''}
                {problem.message}
              </p>
            ))}
            {job.status === 'completed' && (
              <div className="fcpxml-actions">
                <a href={`/api/fcpxml/${job.id}/xml`} download>
                  {t('xml')}
                </a>
                <a href={`/api/fcpxml/${job.id}/package`} download>
                  {t('zip')}
                </a>
              </div>
            )}
          </section>
        ))}
    </main>
  );
}
