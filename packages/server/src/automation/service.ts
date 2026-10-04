import { randomUUID } from 'node:crypto';
import { relative } from 'node:path';
import * as C from '@cura/shared';
import type { AppDatabase } from '../database.js';
import type { CatalogStore } from '../catalog-store.js';
import type { MediaService } from '../media/service.js';
import type { UserPaths } from '../paths.js';
import { AutomationError, errorCode } from './errors.js';
import { AutomationRepository, now, page } from './repository.js';
import {
  configuredProviders,
  type VisionProvider,
  type VisionResult,
  type HTTPTextProvider,
} from './provider.js';
import { runAutomationWorker } from './worker-client.js';
import { AutomationContent } from './content.js';
export interface AutomationOptions {
  database: AppDatabase;
  store: CatalogStore;
  media: MediaService;
  paths: UserPaths;
  providers?: VisionProvider[];
  textProvider?: HTTPTextProvider;
  schedule?: boolean;
}
const canonical = (value: C.AutomationFieldValue) =>
  Array.isArray(value) ? [...new Set(value)].sort() : value;
const equal = (a: C.AutomationFieldValue, b: C.AutomationFieldValue) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export class AutomationService {
  readonly repo: AutomationRepository;
  readonly content: AutomationContent;
  private readonly providers: VisionProvider[];
  private readonly textProvider: HTTPTextProvider | undefined;
  private readonly running = new Map<
    string,
    {
      controller: AbortController;
      promise: Promise<void>;
      ruleId: string | null;
    }
  >();
  private closed = false;
  private timer: NodeJS.Timeout | undefined;
  private ticking: Promise<void> | undefined;
  constructor(readonly options: AutomationOptions) {
    this.repo = new AutomationRepository(options.database);
    const configured = configuredProviders();
    this.providers = options.providers ?? configured.vision;
    this.textProvider = options.textProvider ?? configured.text;
    this.content = new AutomationContent(
      options,
      this.repo,
      this.textProvider,
      (job, task) => this.launch(job, task),
      () => this.ensureCapacity(),
    );
    for (const job of this.repo.all('automation_jobs'))
      if (['queued', 'running'].includes(job.status))
        this.saveJob({ ...job, status: 'failed', errorCode: 'INTERRUPTED' });
    if (options.schedule !== false) {
      this.timer = setInterval(() => this.scheduleTick(), 60000);
      this.timer.unref();
      setImmediate(() => {
        if (!this.closed) this.scheduleTick();
      });
    }
  }
  providersInfo(): C.AutomationProviderInfo[] {
    const infos = this.providers.map((p) => p.info);
    if (!infos.some((p) => p.id === 'http-vision'))
      infos.push({
        id: 'http-vision',
        label: 'Configured vision model',
        kind: 'http-vision',
        mode: 'json',
        configured: false,
        capabilities: ['vision-proposals'],
      });
    infos.push(
      this.textProvider?.info ?? {
        id: 'http-text',
        label: 'Configured text model',
        kind: 'http-text',
        mode: 'json',
        configured: false,
        capabilities: ['script-analysis'],
      },
    );
    return C.AutomationProvidersSchema.parse(infos);
  }
  private ensureCapacity() {
    if (this.closed) throw new AutomationError('AUTOMATION_CLOSED', 503);
    if (this.running.size >= 2)
      throw new AutomationError('AUTOMATION_BUSY', 503);
  }
  private saveJob(job: C.AutomationJob) {
    return this.repo.put('automation_jobs', { ...job, updatedAt: now() });
  }
  job(libraryId: string, id: string) {
    this.options.store.getLibrary(libraryId);
    return this.repo.get('automation_jobs', libraryId, id);
  }
  jobs(libraryId: string, query: unknown = {}) {
    this.options.store.getLibrary(libraryId);
    return page(this.repo.all('automation_jobs', libraryId), query);
  }
  private launch(
    job: C.AutomationJob,
    task: (signal: AbortSignal) => Promise<void>,
  ): C.AutomationJob {
    this.ensureCapacity();
    this.repo.put('automation_jobs', job);
    const controller = new AbortController();
    const promise = new Promise<void>((resolve) => setImmediate(resolve))
      .then(async () => {
        try {
          controller.signal.throwIfAborted();
          this.saveJob({
            ...this.job(job.libraryId, job.id),
            status: 'running',
          });
          await task(controller.signal);
          controller.signal.throwIfAborted();
          const latest = this.job(job.libraryId, job.id);
          const failed =
            latest.kind !== 'archive' &&
            latest.results.length > 0 &&
            latest.results.every((r) => r.errorCode);
          this.saveJob({
            ...latest,
            status: failed ? 'failed' : 'completed',
            errorCode: failed ? 'ALL_ITEMS_FAILED' : null,
          });
        } catch (error) {
          this.saveJob({
            ...this.job(job.libraryId, job.id),
            status: controller.signal.aborted ? 'cancelled' : 'failed',
            errorCode: controller.signal.aborted ? null : errorCode(error),
          });
        }
      })
      .finally(() => this.running.delete(job.id));
    this.running.set(job.id, { controller, promise, ruleId: job.ruleId });
    return job;
  }
  private newJob(
    libraryId: string,
    kind: C.AutomationJob['kind'],
    providerId: string,
    pins: C.FinalPin[],
    ruleId: string | null = null,
  ): C.AutomationJob {
    const date = now();
    return {
      id: randomUUID(),
      libraryId,
      kind,
      providerId,
      pins,
      status: 'queued',
      total: pins.length,
      processed: 0,
      results: [],
      errorCode: null,
      ruleId,
      scriptId: null,
      createdAt: date,
      updatedAt: date,
    };
  }
  analyze(
    libraryId: string,
    input: C.AutomationAnalyzeRequest,
  ): C.AutomationJob {
    this.ensureCapacity();
    this.options.store.getLibrary(libraryId);
    const request = C.AutomationAnalyzeRequestSchema.parse(input);
    const provider = this.providers.find(
      (p) => p.info.id === request.providerId,
    );
    if (!provider) throw new AutomationError('PROVIDER_UNAVAILABLE', 400);
    const assets = [...new Set(request.assetIds)].map((id) =>
      this.ownedAsset(libraryId, id),
    );
    if (assets.some((a) => a.deletedAt))
      throw new AutomationError('ASSET_IN_TRASH', 409);
    const job = this.newJob(
      libraryId,
      'analysis',
      provider.info.id,
      assets.map((a) => ({ assetId: a.id, versionId: a.currentVersionId })),
    );
    return this.launch(job, async (signal) => {
      for (const asset of assets) {
        signal.throwIfAborted();
        let result: C.AutomationJob['results'][number] = {
          assetId: asset.id,
          versionId: asset.currentVersionId,
          proposalId: null,
          errorCode: null,
        };
        try {
          let image: Buffer | undefined;
          let inputKind: 'metadata' | 'original-raster' | 'version-preview' =
            'metadata';
          if (provider.info.kind === 'http-vision') {
            const file = this.options.store.getVersionFile(
              asset.currentVersionId,
            );
            const original = /^image\/(png|jpeg|webp|gif|avif)$/u.test(
              file.type,
            );
            const path = original ? file.snapshotPath : file.thumbnailPath;
            if (!path) throw new AutomationError('VISION_INPUT_UNAVAILABLE');
            const root = original
              ? this.options.paths.data
              : this.options.paths.cache;
            image = Buffer.from(
              await runAutomationWorker<Uint8Array>(
                {
                  op: 'image',
                  root,
                  relativePath: relative(root, path),
                  ...(original ? { expectedHash: asset.hash } : {}),
                },
                signal,
              ),
            );
            inputKind = original ? 'original-raster' : 'version-preview';
          }
          const value = await provider.analyze(
            {
              name: asset.name,
              prompt: asset.prompt,
              model: asset.model,
              source: asset.source,
              ...(image ? { image } : {}),
              sourceHash: asset.hash,
              inputKind,
            },
            signal,
          );
          signal.throwIfAborted();
          const proposal = this.createProposal(job, asset, value);
          result = { ...result, proposalId: proposal.id };
        } catch (error) {
          signal.throwIfAborted();
          result = { ...result, errorCode: errorCode(error) };
        }
        const latest = this.job(libraryId, job.id);
        this.saveJob({
          ...latest,
          processed: latest.processed + 1,
          results: [...latest.results, result],
        });
      }
    });
  }
  private ownedAsset(libraryId: string, id: string) {
    const asset = this.options.store.getAsset(id);
    if (asset.libraryId !== libraryId)
      throw new AutomationError('NOT_FOUND', 404);
    return asset;
  }
  private createProposal(
    job: C.AutomationJob,
    asset: C.Asset,
    result: VisionResult,
  ): C.AutomationProposalView {
    return this.options.database.sqlite.transaction(() => {
      const date = now(),
        id = randomUUID();
      const common = {
        libraryId: job.libraryId,
        proposalId: id,
        assetId: asset.id,
        versionId: asset.currentVersionId,
        createdAt: date,
        updatedAt: date,
        status: 'pending' as const,
        appliedAt: null,
        undoneAt: null,
      };
      const tags = asset.tags.map((t) => ({ id: t.id, name: t.name }));
      const changes: C.AutomationChange[] = [
        {
          ...common,
          id: randomUUID(),
          field: 'tagIds',
          beforeValue: tags.map((t) => t.id).sort(),
          afterValue: null,
          suggestedTagNames: [
            ...new Set(
              result.suggestions.tags.map((t) => t.normalize('NFC').trim()),
            ),
          ],
          beforeTagLabels: tags,
          afterTagLabels: [],
        },
        {
          ...common,
          id: randomUUID(),
          field: 'displayName',
          beforeValue: asset.displayName ?? null,
          afterValue: C.proposeDisplayName(result.suggestions.name, asset.name),
          suggestedTagNames: [],
          beforeTagLabels: [],
          afterTagLabels: [],
        },
      ];
      const proposal = this.repo.put('automation_proposals', {
        id,
        libraryId: job.libraryId,
        jobId: job.id,
        assetId: asset.id,
        versionId: asset.currentVersionId,
        sourceName: asset.name,
        sourceHash: asset.hash,
        caption: result.suggestions.caption,
        provenance: result.provenance,
        changeIds: changes.map((c) => c.id),
        createdAt: date,
        updatedAt: date,
      });
      changes.forEach((c) => this.repo.put('automation_changes', c));
      return { ...proposal, changes };
    })();
  }
  proposals(libraryId: string, query: unknown = {}) {
    this.options.store.getLibrary(libraryId);
    const { jobId, status, offset, limit } =
      C.AutomationProposalQuerySchema.parse(query);
    const values = this.repo
      .all('automation_proposals', libraryId)
      .filter((p) => !jobId || p.jobId === jobId)
      .map((p) => this.proposal(libraryId, p.id))
      .filter((p) => !status || p.changes.some((c) => c.status === status));
    return page(values, { offset, limit });
  }
  private proposal(libraryId: string, id: string): C.AutomationProposalView {
    const p = this.repo.get('automation_proposals', libraryId, id);
    return {
      ...p,
      changes: p.changeIds.map((changeId) =>
        this.repo.get('automation_changes', libraryId, changeId),
      ),
    };
  }
  apply(libraryId: string, input: C.AutomationApplyRequest) {
    return this.change(libraryId, input, false);
  }
  undo(libraryId: string, input: C.AutomationApplyRequest) {
    return this.change(libraryId, input, true);
  }
  private change(
    libraryId: string,
    input: C.AutomationApplyRequest,
    undo: boolean,
  ): C.AutomationApplyResult {
    const request = C.AutomationApplyRequestSchema.parse(input);
    this.options.store.getLibrary(libraryId);
    return this.options.database.sqlite.transaction(() => {
      const conflicts: C.AutomationApplyResult['conflicts'] = [],
        proposals: C.AutomationProposalView[] = [];
      for (const item of request.items) {
        const p = this.proposal(libraryId, item.proposalId);
        const job = this.job(libraryId, p.jobId);
        if (['queued', 'running'].includes(job.status))
          throw new AutomationError('JOB_NOT_FINISHED', 409);
        for (const selected of item.changes) {
          const c = p.changes.find((change) => change.id === selected.changeId);
          if (!c) throw new AutomationError('NOT_FOUND', 404);
          const asset = this.ownedAsset(libraryId, p.assetId);
          const conflict = (code: string) =>
            conflicts.push({ proposalId: p.id, changeId: c.id, code });
          if (
            item.expectedVersionId !== p.versionId ||
            asset.currentVersionId !== p.versionId
          ) {
            conflict('VERSION_CHANGED');
            continue;
          }
          if (asset.deletedAt) {
            conflict('ASSET_IN_TRASH');
            continue;
          }
          const live: C.AutomationFieldValue =
            c.field === 'tagIds'
              ? asset.tags.map((t) => t.id).sort()
              : c.field === 'displayName'
                ? (asset.displayName ?? null)
                : (asset.archivedAt ?? null);
          const expected = undo ? c.afterValue : c.beforeValue;
          if (
            (undo && c.status === 'undone') ||
            (!undo && c.status === 'applied')
          ) {
            if (!equal(live, undo ? c.beforeValue : c.afterValue))
              conflict('FIELD_CHANGED');
            continue;
          }
          if (undo && c.status !== 'applied') {
            conflict('NOT_APPLIED');
            continue;
          }
          if (!equal(selected.expectedValue, live) || !equal(expected, live)) {
            conflict('FIELD_CHANGED');
            continue;
          }
          let target = undo ? c.beforeValue : c.afterValue;
          let afterTagLabels = c.afterTagLabels;
          if (c.field === 'tagIds') {
            if (undo) {
              const known = new Set(
                this.options.store.listTags(libraryId).map((t) => t.id),
              );
              if (
                !Array.isArray(target) ||
                target.some((id) => !known.has(id))
              ) {
                conflict('TAG_REMOVED');
                continue;
              }
            } else {
              const known = this.options.store.listTags(libraryId);
              const selectedTags = c.suggestedTagNames.map(
                (name) =>
                  known.find(
                    (t) =>
                      t.name.normalize('NFC').toLocaleLowerCase() ===
                      name.toLocaleLowerCase(),
                  ) ??
                  (() => {
                    const tag = this.options.store.createTag(libraryId, {
                      name,
                    });
                    known.push(tag);
                    return tag;
                  })(),
              );
              const all = [...asset.tags, ...selectedTags];
              afterTagLabels = [
                ...new Map(
                  all.map((t) => [t.id, { id: t.id, name: t.name }]),
                ).values(),
              ];
              target = afterTagLabels.map((t) => t.id).sort();
            }
          } else if (
            c.field === 'displayName' &&
            !undo &&
            typeof target === 'string'
          ) {
            const names = this.assetIds(libraryId)
              .filter((id) => id !== asset.id)
              .map((id) => C.assetDisplayName(this.options.store.getAsset(id)));
            target = C.proposeDisplayName(target, asset.name, names);
          }
          try {
            if (c.field === 'tagIds')
              this.options.store.updateAsset(asset.id, {
                tagIds: target as string[],
              });
            else if (c.field === 'displayName')
              this.options.store.updateAsset(asset.id, {
                displayName: target as string | null,
              });
            else
              this.options.store.updateAsset(asset.id, {
                archivedAt: target as string | null,
              });
          } catch (error) {
            if (
              error &&
              typeof error === 'object' &&
              'code' in error &&
              String(error.code).includes('FINAL')
            ) {
              conflict('FINAL_SELECTION');
              continue;
            }
            throw error;
          }
          this.repo.put('automation_changes', {
            ...c,
            afterValue: undo ? c.afterValue : target,
            afterTagLabels,
            status: undo ? 'undone' : 'applied',
            appliedAt: undo ? c.appliedAt : now(),
            undoneAt: undo ? now() : null,
            updatedAt: now(),
          });
          this.options.media.notify({
            type: 'asset',
            libraryId,
            assetId: asset.id,
          });
        }
        proposals.push(this.proposal(libraryId, p.id));
      }
      return { proposals, conflicts };
    })();
  }
  cancel(libraryId: string, id: string) {
    const job = this.job(libraryId, id);
    if (['queued', 'running'].includes(job.status)) {
      this.running.get(id)?.controller.abort();
      return this.saveJob({ ...job, status: 'cancelled', errorCode: null });
    }
    return job;
  }
  private assetIds(libraryId: string): string[] {
    return (
      this.options.database.sqlite
        .prepare('SELECT id FROM assets WHERE library_id=? ORDER BY id')
        .all(libraryId) as { id: string }[]
    ).map((r) => r.id);
  }
  rules(libraryId: string, query: unknown = {}) {
    this.options.store.getLibrary(libraryId);
    return page(this.repo.all('archive_rules', libraryId), query);
  }
  createRule(libraryId: string, input: unknown) {
    this.options.store.getLibrary(libraryId);
    const data = C.ArchiveRuleInputSchema.parse(input);
    this.validateRuleRefs(libraryId, data.filters);
    const date = now();
    return this.repo.put('archive_rules', {
      ...data,
      id: randomUUID(),
      libraryId,
      revision: 0,
      lastJobId: null,
      createdAt: date,
      updatedAt: date,
    });
  }
  updateRule(libraryId: string, id: string, input: unknown) {
    const data = C.ArchiveRuleUpdateSchema.parse(input);
    const rule = this.repo.get('archive_rules', libraryId, id);
    if (rule.revision !== data.expectedRevision)
      throw new AutomationError('REVISION_CHANGED', 409);
    const { expectedRevision: _, ...patch } = data;
    void _;
    if (patch.filters) this.validateRuleRefs(libraryId, patch.filters);
    return this.repo.put('archive_rules', {
      ...rule,
      name: data.name ?? rule.name,
      enabled: data.enabled ?? rule.enabled,
      filters: data.filters ?? rule.filters,
      revision: rule.revision + 1,
      updatedAt: now(),
    });
  }
  deleteRule(libraryId: string, id: string, input: unknown) {
    const { expectedRevision } = C.AutomationRevisionRequestSchema.parse(input);
    const rule = this.repo.get('archive_rules', libraryId, id);
    if (rule.revision !== expectedRevision)
      throw new AutomationError('REVISION_CHANGED', 409);
    this.repo.remove('archive_rules', libraryId, id);
    return { deleted: true as const };
  }
  private validateRuleRefs(
    libraryId: string,
    filters: C.ArchiveRule['filters'],
  ) {
    const tags = new Set(
      this.options.store.listTags(libraryId).map((t) => t.id),
    );
    if (filters.tagIds.some((id) => !tags.has(id)))
      throw new AutomationError('INVALID_TAG');
    if (
      filters.folderId &&
      !this.options.store
        .listFolders(libraryId)
        .some((f) => f.id === filters.folderId)
    )
      throw new AutomationError('INVALID_FOLDER');
  }
  // Read only candidate identity/display fields here. Hydrating every complete asset
  // and version through Zod made even a 1000-record queue request block the API.
  private candidateQuery(rule: C.ArchiveRule) {
    const where = [
      'a.library_id=?',
      'a.deleted_at IS NULL',
      "json_extract(a.payload,'$.archivedAt') IS NULL",
      "json_extract(a.payload,'$.rating') <= ?",
      'julianday(v.created_at) <= julianday(?)',
    ];
    const params: Array<string | number> = [
      rule.libraryId,
      rule.filters.maxRating,
      new Date(
        Date.now() - rule.filters.olderThanDays * 86400000,
      ).toISOString(),
    ];
    if (rule.filters.folderId) {
      where.push('a.folder_id=?');
      params.push(rule.filters.folderId);
    }
    for (const tagId of rule.filters.tagIds) {
      where.push(
        'EXISTS(SELECT 1 FROM asset_tags t WHERE t.asset_id=a.id AND t.tag_id=?)',
      );
      params.push(tagId);
    }
    return {
      from: `FROM assets a JOIN asset_versions v ON v.id=json_extract(a.payload,'$.currentVersionId') WHERE ${where.join(' AND ')}`,
      params,
    };
  }
  private candidateRows(
    rule: C.ArchiveRule,
    options: {
      ids?: string[];
      protected?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const { from, params } = this.candidateQuery(rule);
    const final =
      'EXISTS(SELECT 1 FROM final_selections f WHERE f.asset_id=a.id)';
    let extra = '';
    if (options.ids) {
      if (!options.ids.length) return [];
      extra += ` AND a.id IN (${options.ids.map(() => '?').join(',')})`;
      params.push(...options.ids);
    }
    if (options.protected !== undefined) {
      extra += ` AND ${final}=?`;
      params.push(options.protected ? 1 : 0);
    }
    params.push(options.limit ?? 10001, options.offset ?? 0);
    return this.options.database.sqlite
      .prepare(
        `SELECT a.id AS assetId,v.id AS versionId,
      COALESCE(json_extract(a.payload,'$.displayName'),json_extract(a.payload,'$.name')) AS name,
      ${final} AS protectedByFinal ${from}${extra} ORDER BY a.id LIMIT ? OFFSET ?`,
      )
      .all(...params) as Array<{
      assetId: string;
      versionId: string;
      name: string;
      protectedByFinal: number;
    }>;
  }
  private candidateCount(rule: C.ArchiveRule) {
    const { from, params } = this.candidateQuery(rule);
    return this.options.database.sqlite
      .prepare(
        `SELECT
      COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM final_selections f WHERE f.asset_id=a.id) THEN 0 ELSE 1 END),0) AS eligibleTotal,
      COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM final_selections f WHERE f.asset_id=a.id) THEN 1 ELSE 0 END),0) AS protectedTotal ${from}`,
      )
      .get(...params) as { eligibleTotal: number; protectedTotal: number };
  }
  previewRule(
    libraryId: string,
    id: string,
    input: unknown,
    query: unknown = {},
  ) {
    const { expectedRevision } = C.AutomationRevisionRequestSchema.parse(input);
    const rule = this.repo.get('archive_rules', libraryId, id);
    if (rule.revision !== expectedRevision)
      throw new AutomationError('REVISION_CHANGED', 409);
    const { offset, limit } = C.AutomationPageQuerySchema.parse(query);
    const entry = (
      row: ReturnType<AutomationService['candidateRows']>[number],
    ): C.ArchivePreview['eligible'][number] => ({
      assetId: row.assetId,
      versionId: row.versionId,
      name: row.name,
      reason: row.protectedByFinal ? 'final-selection' : 'eligible',
    });
    return {
      ...this.candidateCount(rule),
      eligible: this.candidateRows(rule, {
        protected: false,
        offset,
        limit,
      }).map(entry),
      protected: this.candidateRows(rule, {
        protected: true,
        offset,
        limit,
      }).map(entry),
    };
  }

  runRule(libraryId: string, id: string, input: unknown): C.AutomationJob {
    this.ensureCapacity();
    const { expectedRevision } = C.AutomationRevisionRequestSchema.parse(input);
    const rule = this.repo.get('archive_rules', libraryId, id);
    if (rule.revision !== expectedRevision)
      throw new AutomationError('REVISION_CHANGED', 409);
    const candidates = this.candidateRows(rule);
    if (candidates.length > 10000)
      throw new AutomationError('RULE_TOO_MANY_ASSETS', 413);
    const job = this.newJob(
      libraryId,
      'archive',
      'archive-rule',
      candidates.map((p) => ({
        assetId: p.assetId,
        versionId: p.versionId,
      })),
      id,
    );
    job.archiveRuleSnapshot = {
      name: rule.name,
      revision: rule.revision,
      filters: rule.filters,
    };
    return this.launch(job, async (signal) => {
      // A chunk commits its archive writes, exact history and progress together.
      // Yield between chunks so HTTP cancellation and final-owner changes can run.
      const batchSize = 20;
      for (
        let offset = 0;
        offset < Math.max(1, job.pins.length);
        offset += batchSize
      ) {
        signal.throwIfAborted();
        const batch = job.pins.slice(offset, offset + batchSize);
        const changed: string[] = [];
        this.options.database.sqlite.transaction(() => {
          const current = this.repo.get('archive_rules', libraryId, id);
          if (current.revision !== expectedRevision)
            throw new AutomationError('REVISION_CHANGED', 409);
          const fresh = new Map(
            this.candidateRows(current, {
              ids: batch.map((pin) => pin.assetId),
            }).map((candidate) => [candidate.assetId, candidate]),
          );
          const results: C.AutomationJob['results'] = [];
          for (const pin of batch) {
            const asset = this.ownedAsset(libraryId, pin.assetId);
            let code: string | null = null;
            if (asset.currentVersionId !== pin.versionId)
              code = 'VERSION_CHANGED';
            else if (!fresh.has(pin.assetId)) code = 'NO_LONGER_ELIGIBLE';
            else if (fresh.get(pin.assetId)!.protectedByFinal)
              code = 'FINAL_SELECTION';
            if (code) {
              results.push({ ...pin, proposalId: null, errorCode: code });
              continue;
            }
            const date = now(),
              proposalId = randomUUID(),
              changeId = randomUUID();
            this.options.store.updateAsset(asset.id, { archivedAt: date });
            this.repo.put('automation_proposals', {
              id: proposalId,
              libraryId,
              jobId: job.id,
              ...pin,
              sourceName: asset.name,
              sourceHash: asset.hash,
              caption: '',
              provenance: {
                providerId: 'archive-rule',
                kind: 'archive-rule',
                mode: 'rules',
                model: null,
                rawText: '',
                derivation: 'archive-rule-v1',
                inputKind: 'metadata',
                sourceHash: asset.hash,
              },
              changeIds: [changeId],
              createdAt: date,
              updatedAt: date,
            });
            this.repo.put('automation_changes', {
              id: changeId,
              libraryId,
              proposalId,
              ...pin,
              field: 'archivedAt',
              beforeValue: null,
              afterValue: date,
              suggestedTagNames: [],
              beforeTagLabels: [],
              afterTagLabels: [],
              status: 'applied',
              appliedAt: date,
              undoneAt: null,
              createdAt: date,
              updatedAt: date,
            });
            results.push({ ...pin, proposalId, errorCode: null });
            changed.push(asset.id);
          }
          const latest = this.job(libraryId, job.id);
          this.saveJob({
            ...latest,
            processed: latest.processed + results.length,
            results: [...latest.results, ...results],
          });
          this.repo.put('archive_rules', {
            ...current,
            lastJobId: job.id,
            updatedAt: now(),
          });
        })();
        for (const assetId of changed)
          this.options.media.notify({ type: 'asset', libraryId, assetId });
        if (offset + batchSize < job.pins.length)
          await new Promise<void>((resolve) => setImmediate(resolve));
      }
    });
  }
  private scheduleTick() {
    if (this.closed || this.ticking) return;
    this.ticking = this.tick().finally(() => {
      this.ticking = undefined;
    });
  }
  private async tick() {
    for (const rule of this.repo.all('archive_rules')) {
      if (this.closed || this.running.size >= 2) break;
      if (!rule.enabled || this.runningHasRule(rule.id)) continue;
      try {
        // An existence check avoids both a full hydration scan and no-op jobs.
        if (this.candidateRows(rule, { protected: false, limit: 1 }).length)
          this.runRule(rule.libraryId, rule.id, {
            expectedRevision: rule.revision,
          });
      } catch {
        /* Explicit runs report errors; the next interval retries eligible rules. */
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  private runningHasRule(ruleId: string) {
    return [...this.running.values()].some((task) => task.ruleId === ruleId);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    for (const task of this.running.values()) task.controller.abort();
    await Promise.allSettled([...this.running.values()].map((t) => t.promise));
    await this.ticking;
    await this.content.close();
  }
}
