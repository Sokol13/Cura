import type { ScanSummary } from '@cura/shared';
import type { TFunction } from 'i18next';

export function scanStatusText(summary: ScanSummary, t: TFunction) {
  if (summary.status === 'running') {
    return summary.phase === 'enumerating'
      ? t('scanEnumerating')
      : t('scanProgress', {
          completed: summary.processed,
          total: summary.supportedFound + summary.existingGenericFound,
        });
  }
  const labels = {
    completed: 'scanCompleted',
    partial: 'scanPartial',
    failed: 'scanFailed',
    interrupted: 'scanInterrupted',
  } as const;
  return t(labels[summary.status]);
}
