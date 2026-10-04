import {
  AutomationExportSchema,
  type AutomationExport,
  type FinalPin,
} from '@cura/shared';
import type { AppDatabase } from '../database.js';
import { AutomationRepository } from './repository.js';
export function readAutomationExport(
  database: AppDatabase,
  libraryId: string,
): AutomationExport {
  return database.sqlite.transaction(() => {
    const repo = new AutomationRepository(database);
    const jobs = repo
      .all('automation_jobs', libraryId)
      .filter((j) => !['queued', 'running'].includes(j.status));
    const ids = new Set(jobs.map((j) => j.id));
    const proposals = repo
      .all('automation_proposals', libraryId)
      .filter((p) => ids.has(p.jobId));
    const proposalIds = new Set(proposals.map((p) => p.id));
    const changes = repo
      .all('automation_changes', libraryId)
      .filter((c) => proposalIds.has(c.proposalId));
    const rules = repo.all('archive_rules', libraryId).map((r) => ({
      ...r,
      lastJobId: r.lastJobId && ids.has(r.lastJobId) ? r.lastJobId : null,
    }));
    const scripts = repo.all('script_breakdowns', libraryId),
      documents = repo.all('setting_documents', libraryId);
    const pins = new Map<string, FinalPin>();
    const add = (pin: FinalPin) =>
      pins.set(`${pin.assetId}:${pin.versionId}`, {
        assetId: pin.assetId,
        versionId: pin.versionId,
      });
    for (const job of jobs) job.pins.forEach(add);
    proposals.forEach(add);
    scripts.forEach((s) => add(s.sourcePin));
    documents.forEach((d) => d.sources.forEach(add));
    return AutomationExportSchema.parse({
      jobs,
      proposals,
      changes,
      rules,
      scripts,
      documents,
      pins: [...pins.values()],
    });
  })();
}
