import { randomUUID } from 'node:crypto';
import { extname, relative } from 'node:path';
import * as C from '@cura/shared';
import type { AutomationOptions } from './service.js';
import { AutomationRepository, now, page } from './repository.js';
import { AutomationError } from './errors.js';
import { runAutomationWorker } from './worker-client.js';
import type { ParsedScript } from './script.js';
import type { HTTPTextProvider } from './provider.js';
export class AutomationContent {
  private readonly operations = new Set<Promise<unknown>>();
  private readonly controller = new AbortController();
  private closed = false;
  constructor(
    private readonly options: AutomationOptions,
    private readonly repo: AutomationRepository,
    private readonly textProvider: HTTPTextProvider | undefined,
    private readonly launch: (
      job: C.AutomationJob,
      task: (signal: AbortSignal) => Promise<void>,
    ) => C.AutomationJob,
    private readonly ensureCapacity: () => void,
  ) {}
  private operation<T>(task: () => Promise<T>): Promise<T> {
    if (this.closed) throw new AutomationError('AUTOMATION_CLOSED', 503);
    if (this.operations.size >= 2)
      throw new AutomationError('AUTOMATION_BUSY', 503);
    const promise = task().finally(() => this.operations.delete(promise));
    this.operations.add(promise);
    return promise;
  }
  scripts(libraryId: string, query: unknown = {}) {
    this.options.store.getLibrary(libraryId);
    return page(this.repo.all('script_breakdowns', libraryId), query);
  }
  script(libraryId: string, id: string) {
    return this.repo.get('script_breakdowns', libraryId, id);
  }
  importScript(
    libraryId: string,
    name: string,
    bytes: Buffer,
  ): Promise<C.ScriptBreakdown> {
    return this.operation(async () => {
      this.options.store.getLibrary(libraryId);
      C.UploadQuerySchema.parse({ name });
      if (!['.txt', '.md', '.fountain'].includes(extname(name).toLowerCase()))
        throw new AutomationError('SCRIPT_UNSUPPORTED_FORMAT');
      const parsed = await runAutomationWorker<ParsedScript>(
        { op: 'script', bytes },
        this.controller.signal,
      );
      this.controller.signal.throwIfAborted();
      const asset = await this.options.media.upload(libraryId, name, bytes);
      this.controller.signal.throwIfAborted();
      const date = now();
      return this.repo.put('script_breakdowns', {
        id: randomUUID(),
        libraryId,
        title: name.normalize('NFC').slice(0, 200),
        sourcePin: { assetId: asset.id, versionId: asset.currentVersionId },
        sourceHash: asset.hash,
        lineCount: parsed.lineCount,
        revision: 0,
        entities: parsed.entities,
        provenance: {
          providerId: 'structured-script',
          kind: 'structured-script',
          mode: 'rules',
          model: null,
          rawText: '',
          derivation: 'structured-script-v1',
          inputKind: 'text',
          sourceHash: asset.hash,
        },
        createdAt: date,
        updatedAt: date,
      });
    });
  }
  private async readScript(
    script: C.ScriptBreakdown,
    signal: AbortSignal,
  ): Promise<ParsedScript> {
    const file = this.options.store.getVersionFile(script.sourcePin.versionId);
    if (
      file.libraryId !== script.libraryId ||
      file.assetId !== script.sourcePin.assetId
    )
      throw new AutomationError('NOT_FOUND', 404);
    return runAutomationWorker(
      {
        op: 'read-script',
        root: this.options.paths.data,
        relativePath: relative(this.options.paths.data, file.snapshotPath),
        expectedHash: script.sourceHash,
      },
      signal,
    );
  }
  updateScript(
    libraryId: string,
    id: string,
    input: unknown,
  ): Promise<C.ScriptBreakdown> {
    return this.operation(async () => {
      const data = C.ScriptUpdateSchema.parse(input);
      const script = this.script(libraryId, id);
      if (script.revision !== data.expectedRevision)
        throw new AutomationError('REVISION_CHANGED', 409);
      const source = await this.readScript(script, this.controller.signal);
      const entities = await runAutomationWorker<C.ScriptEntity[]>(
        {
          op: 'edit',
          text: source.text,
          entities: data.entities,
          existing: script.entities,
        },
        this.controller.signal,
      );
      return this.options.database.sqlite.transaction(() => {
        const latest = this.script(libraryId, id);
        if (latest.revision !== data.expectedRevision)
          throw new AutomationError('REVISION_CHANGED', 409);
        return this.repo.put('script_breakdowns', {
          ...latest,
          title: data.title ?? latest.title,
          entities,
          revision: latest.revision + 1,
          updatedAt: now(),
        });
      })();
    });
  }
  analyzeScript(
    libraryId: string,
    id: string,
    input: unknown,
  ): C.AutomationJob {
    this.ensureCapacity();
    const { providerId } = C.ScriptAnalyzeRequestSchema.parse(input);
    if (!this.textProvider || providerId !== this.textProvider.info.id)
      throw new AutomationError('PROVIDER_UNAVAILABLE');
    const provider = this.textProvider;
    const script = this.script(libraryId, id);
    const date = now();
    const job: C.AutomationJob = {
      id: randomUUID(),
      libraryId,
      kind: 'script',
      providerId,
      status: 'queued',
      pins: [script.sourcePin],
      total: 1,
      processed: 0,
      results: [],
      errorCode: null,
      ruleId: null,
      scriptId: id,
      createdAt: date,
      updatedAt: date,
    };
    return this.launch(job, async (signal) => {
      const parsed = await this.readScript(script, signal);
      const result = await provider.analyze(
        parsed.text,
        script.sourceHash,
        signal,
      );
      const entities = await runAutomationWorker<C.ScriptEntity[]>(
        {
          op: 'edit',
          text: parsed.text,
          entities: result.entities,
          existing: [],
        },
        signal,
      );
      signal.throwIfAborted();
      this.options.database.sqlite.transaction(() => {
        const latest = this.script(libraryId, id);
        if (latest.revision !== script.revision)
          throw new AutomationError('REVISION_CHANGED', 409);
        this.repo.put('script_breakdowns', {
          ...latest,
          entities,
          provenance: result.provenance,
          revision: latest.revision + 1,
          updatedAt: now(),
        });
        const current = this.repo.get('automation_jobs', libraryId, job.id);
        this.repo.put('automation_jobs', {
          ...current,
          processed: 1,
          results: [{ ...script.sourcePin, proposalId: null, errorCode: null }],
          updatedAt: now(),
        });
      })();
    });
  }
  documents(libraryId: string, query: unknown = {}) {
    this.options.store.getLibrary(libraryId);
    return page(this.repo.all('setting_documents', libraryId), query);
  }
  document(libraryId: string, id: string) {
    return this.repo.get('setting_documents', libraryId, id);
  }
  createDocument(libraryId: string, input: unknown): C.SettingDocument {
    const data = C.SettingDocumentInputSchema.parse(input);
    this.options.store.getLibrary(libraryId);
    return this.options.database.sqlite.transaction(() => {
      const seen = new Set<string>();
      const sources = data.pins.map((pin) => {
        const key = `${pin.assetId}:${pin.versionId}`;
        if (seen.has(key)) throw new AutomationError('DUPLICATE_PIN');
        seen.add(key);
        const asset = this.options.store.getAsset(pin.assetId);
        if (asset.libraryId !== libraryId)
          throw new AutomationError('NOT_FOUND', 404);
        const version = this.options.store
          .listVersions(asset.id)
          .find((v) => v.id === pin.versionId);
        if (!version) throw new AutomationError('NOT_FOUND', 404);
        return {
          ...pin,
          hash: version.hash,
          name: version.name,
          note: asset.note,
          prompt: version.prompt,
          negativePrompt: version.negativePrompt,
          model: version.model,
          source: version.source,
          seed: version.seed,
          width: version.width,
          height: version.height,
          tags: asset.tags.map((t) => t.name),
        };
      });
      const script = data.scriptId
        ? this.script(libraryId, data.scriptId)
        : null;
      if (data.entityIds.length && !script)
        throw new AutomationError('SCRIPT_REQUIRED');
      const entities = data.entityIds.map((id) => {
        const entity = script?.entities.find((e) => e.id === id);
        if (!entity) throw new AutomationError('INVALID_ENTITY');
        return entity;
      });
      const zh = data.language === 'zh-CN';
      const missing = zh ? '未提供' : 'Not provided';
      const field = (label: string, value: string) =>
        `**${label}:** ${value || missing}`;
      const markdown = [
        `# ${data.title}`,
        '',
        zh
          ? '基于下列固定版本的元数据；缺失信息明确标记。'
          : 'Generated from the pinned versions below; missing information is explicitly marked.',
        '',
        ...sources.flatMap((source) => [
          `## ${source.name}`,
          '',
          field(zh ? '版本' : 'Version', source.versionId),
          field(zh ? '内容哈希' : 'Content hash', source.hash),
          field(zh ? '备注' : 'Notes', source.note),
          field(zh ? '提示词' : 'Prompt', source.prompt),
          field(zh ? '负面提示词' : 'Negative prompt', source.negativePrompt),
          field(zh ? '模型' : 'Model', source.model),
          field(zh ? '来源' : 'Source', source.source),
          field(zh ? '种子' : 'Seed', source.seed),
          field(
            zh ? '尺寸' : 'Dimensions',
            source.width && source.height
              ? `${source.width} × ${source.height}`
              : '',
          ),
          field(zh ? '标签' : 'Tags', source.tags.join(', ')),
          '',
        ]),
        ...entities.flatMap((e) => [
          `## ${e.name} (${e.kind})`,
          '',
          e.notes || missing,
          ...e.references.map(
            (ref) =>
              `${zh ? '原文行' : 'Source lines'} ${ref.startLine}–${ref.endLine}:\n\n${ref.excerpt
                .split(/\r\n|\r|\n/u)
                .map((line) => `> ${line}`)
                .join('\n')}`,
          ),
          '',
        ]),
      ].join('\n');
      const date = now();
      return this.repo.put('setting_documents', {
        id: randomUUID(),
        libraryId,
        title: data.title,
        kind: data.kind,
        language: data.language,
        revision: 0,
        markdown,
        sources,
        scriptId: script?.id ?? null,
        entities,
        provenance: 'metadata-document-v1',
        createdAt: date,
        updatedAt: date,
      });
    })();
  }
  updateDocument(
    libraryId: string,
    id: string,
    input: unknown,
  ): C.SettingDocument {
    const data = C.SettingDocumentUpdateSchema.parse(input);
    return this.options.database.sqlite.transaction(() => {
      const doc = this.document(libraryId, id);
      if (doc.revision !== data.expectedRevision)
        throw new AutomationError('REVISION_CHANGED', 409);
      return this.repo.put('setting_documents', {
        ...doc,
        title: data.title ?? doc.title,
        markdown: data.markdown ?? doc.markdown,
        revision: doc.revision + 1,
        updatedAt: now(),
      });
    })();
  }
  exportDocument(libraryId: string, id: string, format: string) {
    const doc = this.document(libraryId, id);
    if (!['markdown', 'json'].includes(format))
      throw new AutomationError('INVALID_EXPORT_FORMAT');
    return {
      body: format === 'markdown' ? doc.markdown : JSON.stringify(doc, null, 2),
      type:
        format === 'markdown'
          ? 'text/markdown; charset=utf-8'
          : 'application/json; charset=utf-8',
      name: `setting-${doc.id}.${format === 'markdown' ? 'md' : 'json'}`,
    };
  }
  async close() {
    this.closed = true;
    this.controller.abort();
    await Promise.allSettled([...this.operations]);
  }
}
