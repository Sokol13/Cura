import type { GenerateRequest, GenerationJob } from '@cura/shared';
import type { CatalogStore } from '../catalog-store.js';
import type { MediaService } from '../media/service.js';
import { publicGenerationError } from './errors.js';
import { ProcessStore, ProcessError } from './store.js';
import { MockGenerationProvider, type GenerationProvider } from './provider.js';

export class GenerationService {
  private readonly running = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private closed = false;
  constructor(
    private readonly store: ProcessStore,
    private readonly catalog: CatalogStore,
    private readonly media: MediaService,
    private readonly provider: GenerationProvider = new MockGenerationProvider(),
  ) {
    // An interrupted mock task is explicit; retrying deterministic output deduplicates.
    const rows = store.database.sqlite
      .prepare(
        "SELECT id FROM generation_jobs WHERE json_extract(payload,'$.status') IN ('queued','running')",
      )
      .all() as { id: string }[];
    for (const { id } of rows)
      store.updateJob(id, {
        status: 'failed',
        error:
          'Generation was interrupted by a server restart. Retry this local mock request.',
      });
  }
  start(libraryId: string, request: GenerateRequest): GenerationJob {
    if (this.closed || this.running.size >= 4)
      throw new ProcessError(
        'Generation queue is busy. Retry shortly.',
        503,
        'GENERATION_BUSY',
      );
    const job = this.store.createJob(libraryId, request);
    const controller = new AbortController();
    const promise = new Promise<void>((resolve) => setImmediate(resolve))
      .then(async () => {
        try {
          controller.signal.throwIfAborted();
          this.store.updateJob(job.id, { status: 'running' });
          const outputs = await this.provider.generate(job.request, {
            signal: controller.signal,
            progress: (progress) => {
              this.store.updateJob(job.id, { progress: progress * 0.75 });
            },
          });
          const assetIds: string[] = [];
          for (const [index, output] of outputs.entries()) {
            controller.signal.throwIfAborted();
            const imported = await this.media.upload(
              libraryId,
              output.name,
              output.bytes,
            );
            this.catalog.updateAsset(imported.id, {
              prompt: job.request.prompt,
              negativePrompt: job.request.negativePrompt,
              model: job.request.model,
              seed: output.seed,
              source: 'mock',
              params: {
                ...imported.params,
                provider: this.provider.id,
                mock: true,
              },
            });
            assetIds.push(imported.id);
            this.store.updateJob(job.id, {
              assetIds,
              progress: 0.75 + ((index + 1) / outputs.length) * 0.25,
            });
          }
          controller.signal.throwIfAborted();
          this.store.updateJob(job.id, { status: 'completed', progress: 1 });
        } catch (error) {
          this.store.updateJob(job.id, {
            status: controller.signal.aborted ? 'cancelled' : 'failed',
            error: controller.signal.aborted
              ? null
              : publicGenerationError(error),
          });
        }
      })
      .finally(() => {
        this.running.delete(job.id);
      });
    this.running.set(job.id, { controller, promise });
    return job;
  }
  cancel(id: string): GenerationJob {
    const job = this.store.job(id);
    if (job.status === 'queued' || job.status === 'running')
      this.running.get(id)?.controller.abort();
    return this.store.job(id);
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const task of this.running.values()) task.controller.abort();
    await Promise.allSettled(
      [...this.running.values()].map((task) => task.promise),
    );
  }
}
