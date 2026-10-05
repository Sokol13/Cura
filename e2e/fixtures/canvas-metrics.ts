/// <reference lib="dom" />
import { type CDPSession, type Page } from '@playwright/test';

export interface FrameEvidence {
  durationMs: number;
  frames: number[];
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  longTasks: Array<{ startMs: number; durationMs: number }>;
  activity: Array<{
    second: number;
    mutations: number;
    resizeCallbacks: number;
    resizeEntries: number;
  }>;
  visibility: string;
  reactCommitCount: null;
  reactCommitCounter: string;
}
declare global {
  interface Window {
    __curaWarmupStage?: string;
    __curaCanvasMeasurement?: { stop: () => FrameEvidence };
  }
}
export async function deadline<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds} ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function settleCanvas(page: Page) {
  await deadline(
    page.evaluate(async () => {
      window.__curaWarmupStage = 'fonts';
      await document.fonts.ready;
      window.__curaWarmupStage = 'images';
      // Offscreen lazy tray images intentionally have no fetched source yet.
      // Decode every measured board image and every other viewport image.
      await Promise.all(
        [...document.images]
          .filter((image) => {
            const rect = image.getBoundingClientRect();
            return (
              image.closest(
                '.board-flow, .board-matrix, .board-history-content',
              ) ||
              (rect.width > 0 &&
                rect.height > 0 &&
                rect.right > 0 &&
                rect.bottom > 0 &&
                rect.left < innerWidth &&
                rect.top < innerHeight)
            );
          })
          .map((image) => image.decode()),
      );
      window.__curaWarmupStage = 'geometry';
      const roots = document.querySelectorAll(
        '.board-flow, .board-matrix, .board-history-content',
      );
      if (!roots.length)
        throw new Error('No canvas, matrix or history content');
      let changed = performance.now();
      const mutation = new MutationObserver(() => {
        changed = performance.now();
      });
      const resize = new ResizeObserver(() => {
        changed = performance.now();
      });
      for (const root of roots) {
        mutation.observe(root, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        resize.observe(root);
        root
          .querySelectorAll('.react-flow__node, .board-slot')
          .forEach((node) => resize.observe(node));
      }
      try {
        await new Promise<void>((resolve, reject) => {
          const start = performance.now();
          const tick = () => {
            const now = performance.now();
            if (now - changed >= 500) resolve();
            else if (now - start >= 8000)
              reject(
                new Error(
                  'Canvas geometry/DOM did not settle within 8 seconds',
                ),
              );
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      } finally {
        mutation.disconnect();
        resize.disconnect();
      }
    }),
    10000,
    'Canvas warm-up',
  );
}
/** null starts a capture-load window; a duration returns an untouched idle sample. */
export async function measureFrames(
  page: Page,
  durationMs: number | null,
): Promise<FrameEvidence | null> {
  return page.evaluate(async (duration) => {
    if (window.__curaCanvasMeasurement)
      throw new Error('Overlapping frame measurements');
    if (!PerformanceObserver.supportedEntryTypes.includes('longtask'))
      throw new Error('Long Task API unavailable');
    const frames: number[] = [],
      longTasks: FrameEvidence['longTasks'] = [];
    const activity = new Map<number, FrameEvidence['activity'][number]>();
    let started = Infinity,
      previous: number | undefined,
      raf = 0,
      running = true;
    const bucket = (
      second = Math.max(0, Math.floor((performance.now() - started) / 1000)),
    ) => {
      const value = activity.get(second) ?? {
        second,
        mutations: 0,
        resizeCallbacks: 0,
        resizeEntries: 0,
      };
      activity.set(second, value);
      return value;
    };
    const observer = new PerformanceObserver((records) => {
      for (const entry of records.getEntries())
        if (entry.startTime >= started)
          longTasks.push({
            startMs: entry.startTime - started,
            durationMs: entry.duration,
          });
    });
    observer.observe({ type: 'longtask', buffered: false });
    const mutation = new MutationObserver((records) => {
      if (Number.isFinite(started)) bucket().mutations += records.length;
    });
    const resize = new ResizeObserver((entries) => {
      if (Number.isFinite(started)) {
        const value = bucket();
        value.resizeCallbacks++;
        value.resizeEntries += entries.length;
      }
    });
    for (const root of document.querySelectorAll(
      '.board-flow, .board-matrix, .board-history-content',
    )) {
      mutation.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      resize.observe(root);
      root
        .querySelectorAll('.react-flow__node, .board-slot')
        .forEach((node) => resize.observe(node));
    }
    // Initial ResizeObserver deliveries belong to setup, before the measured epoch.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    mutation.takeRecords();
    started = performance.now();
    const tick = (time: number) => {
      if (!running) return;
      if (previous !== undefined) frames.push(time - previous);
      previous = time;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const stop = (): FrameEvidence => {
      running = false;
      cancelAnimationFrame(raf);
      for (const entry of observer.takeRecords())
        if (entry.startTime >= started)
          longTasks.push({
            startMs: entry.startTime - started,
            durationMs: entry.duration,
          });
      bucket().mutations += mutation.takeRecords().length;
      observer.disconnect();
      mutation.disconnect();
      resize.disconnect();
      delete window.__curaCanvasMeasurement;
      const durationMs = performance.now() - started;
      for (let second = 0; second <= Math.floor(durationMs / 1000); second++)
        bucket(second);
      const ordered = [...frames].sort((a, b) => a - b);
      return {
        durationMs,
        frames,
        p50Ms: ordered[Math.floor(ordered.length * 0.5)] ?? 0,
        p95Ms: ordered[Math.floor(ordered.length * 0.95)] ?? 0,
        maxMs: Math.max(0, ...frames),
        longTasks,
        activity: [...activity.values()].sort((a, b) => a.second - b.second),
        visibility: document.visibilityState,
        reactCommitCount: null,
        reactCommitCounter:
          'Production build has no exposed commit counter; no React hook was injected.',
      };
    };
    window.__curaCanvasMeasurement = { stop };
    if (duration === null) return null;
    return new Promise<FrameEvidence>((resolve) =>
      setTimeout(() => resolve(stop()), duration),
    );
  }, durationMs);
}
export async function stopFrames(page: Page) {
  return page.evaluate(() => window.__curaCanvasMeasurement?.stop() ?? null);
}
export async function cdpMetrics(session: CDPSession) {
  const result = (await deadline(
    session.send('Performance.getMetrics'),
    3000,
    'CDP metrics',
  )) as { metrics: Array<{ name: string; value: number }> };
  const names = new Set([
    'LayoutCount',
    'RecalcStyleCount',
    'TaskDuration',
    'ScriptDuration',
    'LayoutDuration',
    'RecalcStyleDuration',
    'JSHeapUsedSize',
  ]);
  return Object.fromEntries(
    result.metrics
      .filter((metric) => names.has(metric.name))
      .map((metric) => [metric.name, metric.value]),
  );
}
export function metricDelta(
  before: Record<string, number>,
  after: Record<string, number>,
) {
  return Object.fromEntries(
    Object.entries(after).map(([name, value]) => [
      name,
      value - (before[name] ?? 0),
    ]),
  );
}
export async function canvasDom(page: Page) {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < innerWidth &&
        rect.top < innerHeight
      );
    };
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const slots = [...document.querySelectorAll('.board-slot')];
    const images = [
      ...document.querySelectorAll<HTMLImageElement>(
        '.board-flow img, .board-matrix img, .board-history-content img',
      ),
    ];
    return {
      nodes: nodes.length,
      viewportIntersectingNodes: nodes.filter(visible).length,
      slots: slots.length,
      viewportIntersectingSlots: slots.filter(visible).length,
      images: images.length,
      decodedImages: images.filter(
        (image) => image.complete && image.naturalWidth > 0,
      ).length,
      viewportIntersectingImages: images.filter(visible).length,
      uniqueImageUrls: new Set(images.map((image) => image.currentSrc)).size,
      dpr: devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
      visibility: document.visibilityState,
    };
  });
}
