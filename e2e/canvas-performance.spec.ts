/// <reference lib="dom" />
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test, type Request } from '@playwright/test';
import { PreviewCandidatesSchema } from '../packages/shared/src/index.js';
import {
  canvasPerformanceFixture,
  readPerformanceBoard,
} from './fixtures/canvas-performance.js';
import {
  canvasDom,
  cdpMetrics,
  deadline,
  measureFrames,
  metricDelta,
  settleCanvas,
  stopFrames,
  type FrameEvidence,
} from './fixtures/canvas-metrics.js';

// Trace recording starts a screencast even when traces are retained only on failure.
// This spec retains its own raw samples and explicit captures instead.
test.use({
  viewport: { width: 1500, height: 1000 },
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  actionTimeout: 5000,
  navigationTimeout: 10000,
});
test.describe.configure({ retries: 0 });
let fixture: Awaited<ReturnType<typeof canvasPerformanceFixture>>;
test.beforeAll(async ({ request }) => {
  fixture = await canvasPerformanceFixture(request);
});

const scenarios = [
  { name: 'populated canvas', board: 'canvas', history: false, dpr: 1 },
  { name: 'slot history comparison', board: 'canvas', history: true, dpr: 1 },
  { name: 'filled 10 by 10 matrix', board: 'matrix', history: false, dpr: 1 },
  {
    name: 'populated canvas at fractional DPR',
    board: 'canvas',
    history: false,
    dpr: 1.25,
  },
] as const;
for (const scenario of scenarios)
  test.describe(`${scenario.name} DPR ${scenario.dpr}`, () => {
    test.use({ deviceScaleFactor: scenario.dpr });
    test('idle frames and repeated CDP screenshots stay responsive', async ({
      page,
      context,
      request,
      browser,
    }, testInfo) => {
      test.setTimeout(90000);
      type Phase = 'setup' | 'idle' | 'capture' | 'finished';
      let phase: Phase = 'setup';
      const requests: Array<{
        phase: Phase;
        method: string;
        path: string;
        status?: number;
        failed?: string;
      }> = [];
      const pending = new Map<Request, (typeof requests)[number]>();
      const activePreviews = new Set<Request>();
      let maximumPreviewConcurrency = 0;
      const browserErrors: string[] = [];
      const consoleErrors: Array<{ phase: Phase; text: string; url: string }> =
        [];
      const evidence: Record<string, unknown> = {
        scenario,
        fixture: fixture.counts,
        requests,
        browserErrors,
        consoleErrors,
        screenshots: [],
        gates: {
          idleP95MsLessThan: 34,
          idleMaxMsLessThan: 100,
          longTaskMsLessThan: 100,
          screenshotDeadlineMs: 3000,
        },
      };
      const screenshots: Array<{
        index: number;
        milliseconds: number;
        bytes?: number;
        width?: number;
        height?: number;
        sha256?: string;
        error?: string;
        rendererAfterFailure?: string;
      }> = [];
      evidence.screenshots = screenshots;
      const retained: Array<{ name: string; bytes: Buffer }> = [];
      page.on('request', (event) => {
        const entry = {
          phase,
          method: event.method(),
          path: new URL(event.url()).pathname,
        };
        requests.push(entry);
        pending.set(event, entry);
        if (entry.path.endsWith('/previews')) {
          activePreviews.add(event);
          if (phase !== 'setup')
            maximumPreviewConcurrency = Math.max(
              maximumPreviewConcurrency,
              activePreviews.size,
            );
        }
      });
      page.on('response', (event) => {
        const entry = pending.get(event.request());
        if (entry) entry.status = event.status();
      });
      page.on('requestfinished', (event) => {
        pending.delete(event);
        activePreviews.delete(event);
      });
      page.on('requestfailed', (event) => {
        const entry = pending.get(event);
        if (entry)
          entry.failed = event.failure()?.errorText ?? 'request failed';
        pending.delete(event);
        activePreviews.delete(event);
      });
      page.on('pageerror', (error) => browserErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const entry = {
          phase,
          text: message.text(),
          url: message.location().url,
        };
        consoleErrors.push(entry);
        // Chromium requests the absent favicon independently of the application.
        if (
          !(
            phase === 'setup' &&
            /\/favicon\.ico$/.test(entry.url) &&
            entry.text.includes('404')
          )
        )
          browserErrors.push(entry.text);
      });
      const session = await context.newCDPSession(page);
      try {
        const git = (...args: string[]) =>
          execFileSync('git', args, { encoding: 'utf8' }).trim();
        const harness = await Promise.all(
          [
            './canvas-performance.spec.ts',
            './fixtures/canvas-performance.ts',
            './fixtures/canvas-metrics.ts',
          ].map((file) => readFile(new URL(file, import.meta.url))),
        );
        evidence.environment = {
          commit: git('rev-parse', 'HEAD'),
          productionTrees: Object.fromEntries(
            ['packages/web', 'packages/server', 'packages/shared'].map(
              (path) => [path, git('rev-parse', `HEAD:${path}`)],
            ),
          ),
          harnessSha256: createHash('sha256')
            .update(Buffer.concat(harness))
            .digest('hex'),
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          browser: browser.version(),
          headless: testInfo.project.use.headless !== false,
          dpr: scenario.dpr,
          fractionalDprIsEmulated: scenario.dpr !== 1,
          physicalWindowsRun: process.platform === 'win32',
          reportedUserBoardReproduction: null,
          reproductionBoundary:
            'Generated fixture; controlled DPR does not reproduce the reported user board or native Windows display scaling.',
          runtimeWorkingTreeChanges: git(
            'status',
            '--porcelain',
            '--untracked-files=all',
            '--',
            'packages/web',
            'packages/server',
            'packages/shared',
            'pnpm-lock.yaml',
          ),
        };
        expect(
          (evidence.environment as { runtimeWorkingTreeChanges: string })
            .runtimeWorkingTreeChanges,
          'Measured runtime source must match the recorded HEAD trees',
        ).toBe('');
        const browserSession = await browser.newBrowserCDPSession();
        try {
          const info = (await deadline(
            browserSession.send('SystemInfo.getInfo'),
            3000,
            'GPU metadata',
          )) as {
            gpu: {
              devices: unknown[];
              auxAttributes?: { glRenderer?: string; glVendor?: string };
              featureStatus?: unknown;
            };
          };
          evidence.gpu = {
            devices: info.gpu.devices,
            renderer: info.gpu.auxAttributes?.glRenderer,
            vendor: info.gpu.auxAttributes?.glVendor,
            featureStatus: info.gpu.featureStatus,
          };
        } catch {
          evidence.gpu = { available: false };
        } finally {
          await deadline(
            browserSession.detach(),
            1000,
            'GPU session cleanup',
          ).catch(() => {});
        }
        const settings = await request.patch('/api/settings', {
          data: {
            activeLibraryId: fixture.libraryId,
            language: 'en',
            theme: 'dark',
          },
        });
        expect(settings.ok()).toBe(true);
        const board = fixture[scenario.board];
        await page.goto(`/?workspace=boards&board=${board.board.id}`);
        await page.bringToFront();
        await expect(
          page.getByRole('heading', { name: board.board.name, exact: true }),
        ).toBeVisible();
        if (scenario.board === 'canvas') {
          await page
            .getByRole('button', { name: 'Fit board', exact: true })
            .click();
          await expect(page.locator('.react-flow__node')).toHaveCount(100);
          if (scenario.history) {
            await page
              .getByRole('button', {
                name: 'History for Performance slot 0',
                exact: true,
              })
              .click();
            await expect(page.locator('.board-history-pane')).toHaveCount(2);
            await expect(page.locator('.board-slot-history li')).toHaveCount(3);
          }
        } else
          await expect(
            page.locator('.board-matrix-cell .board-slot'),
          ).toHaveCount(100);
        await page.mouse.move(0, 0);
        try {
          await settleCanvas(page);
        } catch (error) {
          evidence.warmupFailure = await deadline(
            page.evaluate(() => ({
              stage: window.__curaWarmupStage,
              fonts: document.fonts.status,
              visibility: document.visibilityState,
              images: [...document.images].map((image) => ({
                src: image.getAttribute('src'),
                currentSrc: image.currentSrc,
                loading: image.loading,
                complete: image.complete,
                width: image.naturalWidth,
                rect: image.getBoundingClientRect().toJSON(),
              })),
            })),
            1000,
            'Warm-up diagnostics',
          ).catch(String);
          throw error;
        }
        await expect.poll(() => pending.size).toBe(0);
        const previews = await request.get(
          `/api/libraries/${fixture.libraryId}/previews`,
        );
        expect(previews.ok()).toBe(true);
        expect(
          PreviewCandidatesSchema.parse(await previews.json()).items,
        ).toEqual([]);
        evidence.dom = await canvasDom(page);
        expect(
          (evidence.dom as Awaited<ReturnType<typeof canvasDom>>).dpr,
        ).toBe(scenario.dpr);
        expect(
          (evidence.dom as Awaited<ReturnType<typeof canvasDom>>).visibility,
        ).toBe('visible');
        const before = await readPerformanceBoard(request, board.board.id);
        await deadline(
          session.send('Performance.enable'),
          3000,
          'CDP metrics setup',
        );
        const beforeIdle = await cdpMetrics(session);
        phase = 'idle';
        const idle = await deadline(
          measureFrames(page, 15000),
          20000,
          'Untouched idle measurement',
        );
        if (!idle) throw new Error('Missing idle frame sample');
        phase = 'setup';
        evidence.idle = idle;
        evidence.idleCdp = metricDelta(beforeIdle, await cdpMetrics(session));
        // Assert after retaining capture evidence too; an idle failure is never discarded.
        const afterIdle = await readPerformanceBoard(request, board.board.id);
        evidence.boardRevision = {
          before: before.board.revision,
          afterIdle: afterIdle.board.revision,
        };
        const beforeCapture = await cdpMetrics(session);
        await deadline(
          measureFrames(page, null),
          3000,
          'Capture measurement setup',
        );
        phase = 'capture';
        const captureStart = performance.now();
        for (let index = 0; index < 10; index++) {
          await delay(
            Math.max(0, captureStart + index * 1000 - performance.now()),
          );
          const started = performance.now();
          const attempt: (typeof screenshots)[number] = {
            index: index + 1,
            milliseconds: 0,
          };
          screenshots.push(attempt);
          try {
            const result = (await deadline(
              session.send('Page.captureScreenshot', {
                format: 'png',
                fromSurface: true,
                captureBeyondViewport: false,
              }),
              3000,
              `CDP screenshot ${index + 1}`,
            )) as { data: string };
            const milliseconds = performance.now() - started;
            const bytes = Buffer.from(result.data, 'base64');
            expect(bytes.subarray(0, 8).toString('hex')).toBe(
              '89504e470d0a1a0a',
            );
            if (index === 0 || index === 9)
              retained.push({ name: `capture-${index + 1}.png`, bytes });
            const width = bytes.readUInt32BE(16),
              height = bytes.readUInt32BE(20);
            Object.assign(attempt, {
              milliseconds,
              bytes: bytes.length,
              width,
              height,
              sha256: createHash('sha256').update(bytes).digest('hex'),
            });
            // A separate raw CDP session captures the 1500x1000 surface.
            // This is independent of the page's emulated devicePixelRatio;
            // a four-corner control verifies full viewport coverage at 1/1.25.
            expect(width).toBe(1500);
            expect(height).toBe(1000);
            expect(milliseconds).toBeLessThan(3000);
          } catch (error) {
            Object.assign(attempt, {
              milliseconds: performance.now() - started,
              error: String(error),
              rendererAfterFailure: 'not checked',
            });
            try {
              await deadline(
                session.send('Runtime.evaluate', {
                  expression: 'performance.now()',
                  returnByValue: true,
                }),
                1000,
                'Renderer heartbeat after screenshot failure',
              );
              attempt.rendererAfterFailure = 'responsive';
            } catch {
              attempt.rendererAfterFailure = 'unresponsive within 1000 ms';
            }
            void page.close().catch(() => {});
            throw error;
          }
        }
        phase = 'finished';
        const capture = await deadline(
          stopFrames(page),
          3000,
          'Capture measurement finish',
        );
        evidence.captureLoad = capture;
        evidence.captureCdp = metricDelta(
          beforeCapture,
          await cdpMetrics(session),
        );
        evidence.maximumPreviewConcurrency = maximumPreviewConcurrency;
        const after = await readPerformanceBoard(request, board.board.id);
        evidence.finalBoardRevision = after.board.revision;
        expect(afterIdle.board.revision).toBe(before.board.revision);
        expect(after.board.revision).toBe(before.board.revision);
        expect(screenshots).toHaveLength(10);
        expect(idle.visibility).toBe('visible');
        expect(idle.durationMs).toBeGreaterThanOrEqual(15000);
        expect(idle.frames.length).toBeGreaterThan(300);
        expect(idle.p95Ms, 'untouched idle p95').toBeLessThan(34);
        expect(idle.maxMs, 'untouched idle maximum').toBeLessThan(100);
        expect(
          idle.longTasks.filter((entry) => entry.durationMs >= 100),
        ).toEqual([]);
        const idleRequests = requests.filter((entry) => entry.phase === 'idle');
        expect(idleRequests.filter((entry) => entry.method !== 'GET')).toEqual(
          [],
        );
        expect(
          idleRequests.filter((entry) => !entry.path.endsWith('/previews')),
        ).toEqual([]);
        expect(
          idleRequests.filter((entry) => entry.path.endsWith('/previews'))
            .length,
        ).toBeLessThanOrEqual(Math.ceil(idle.durationMs / 2000) + 1);
        expect(
          idleRequests.filter((entry) => entry.failed || entry.status !== 200),
        ).toEqual([]);
        expect(maximumPreviewConcurrency).toBeLessThanOrEqual(1);
        expect(browserErrors).toEqual([]);
      } catch (error) {
        evidence.failure = { phase, message: String(error) };
        throw error;
      } finally {
        phase = 'finished';
        if (!page.isClosed()) {
          await deadline(stopFrames(page), 1000, 'Measurement cleanup').catch(
            () => {
              void page.close().catch(() => {});
            },
          );
        }
        await deadline(session.detach(), 1000, 'CDP session cleanup').catch(
          () => {},
        );
        for (const capture of retained)
          await testInfo.attach(capture.name, {
            body: capture.bytes,
            contentType: 'image/png',
          });
        const evidencePath = testInfo.outputPath('canvas-performance.json');
        await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
        await testInfo.attach('canvas-performance.json', {
          path: evidencePath,
          contentType: 'application/json',
        });
        const idle = evidence.idle as FrameEvidence | undefined;
        console.info(
          'CANVAS_PERFORMANCE',
          JSON.stringify({
            scenario,
            idle: idle
              ? {
                  frames: idle.frames.length,
                  p50Ms: idle.p50Ms,
                  p95Ms: idle.p95Ms,
                  maxMs: idle.maxMs,
                  longTasks: idle.longTasks,
                }
              : null,
            screenshots: screenshots.map(({ index, milliseconds, error }) => ({
              index,
              milliseconds,
              error,
            })),
            failure: evidence.failure ?? null,
          }),
        );
      }
    });
  });
