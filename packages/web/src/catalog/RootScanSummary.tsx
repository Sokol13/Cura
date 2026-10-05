import type { ScanSummary } from '@cura/shared';
import { useTranslation } from 'react-i18next';

import { scanStatusText } from './scan-status';

export function RootScanSummary({
  summary,
}: {
  summary?: ScanSummary | undefined;
}) {
  const { t, i18n } = useTranslation();
  if (!summary) return <p className="root-scan-empty">{t('scanNoHistory')}</p>;
  return (
    <details className="root-scan-summary">
      <summary>
        <span className="root-scan-status" data-scan-status={summary.status}>
          {scanStatusText(summary, t)}
        </span>
        <span>
          {t('scanSummaryCounts', {
            supported: summary.supportedFound,
            skipped: summary.unsupportedSkipped,
            errors: summary.readErrors,
          })}
        </span>
      </summary>
      <div className="root-scan-details">
        <p>{t('scanRecursive')}</p>
        <p>
          {t('scanFileCounts', {
            found: summary.filesFound,
            succeeded: summary.succeeded,
          })}
        </p>
        {summary.existingGenericFound > 0 && (
          <p>
            {t('scanExistingGeneric', { count: summary.existingGenericFound })}
          </p>
        )}
        {(summary.symlinksSkipped > 0 || summary.specialEntriesSkipped > 0) && (
          <p>
            {t('scanOtherSkipped', {
              symlinks: summary.symlinksSkipped,
              special: summary.specialEntriesSkipped,
            })}
          </p>
        )}
        <p>
          {t(summary.finishedAt ? 'scanFinishedAt' : 'scanStartedAt', {
            time: new Date(
              summary.finishedAt ?? summary.startedAt,
            ).toLocaleString(i18n.language),
          })}
        </p>
        {summary.extensions.length > 0 && (
          <>
            <h3>{t('scanExtensions')}</h3>
            <dl className="root-scan-extensions">
              {summary.extensions.map((extension) => (
                <div key={extension.extension}>
                  <dt>{extension.extension || t('scanNoExtension')}</dt>
                  <dd>
                    {t('scanExtensionCounts', {
                      found: extension.found,
                      supported: extension.supported,
                      existing: extension.existingGeneric,
                      skipped: extension.skipped,
                      errors: extension.readErrors,
                    })}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
        {summary.otherExtensionFiles > 0 && (
          <p>
            {t('scanOtherExtensions', { count: summary.otherExtensionFiles })}
          </p>
        )}
        {summary.errors.length > 0 && (
          <>
            <h3>{t('scanReadErrors')}</h3>
            <ul className="root-scan-errors">
              {summary.errors.map((error, index) => (
                <li key={index}>
                  <span>{error.relativePath ?? t('scanRootPath')}</span>
                  <span>
                    {t(
                      error.stage === 'enumerate'
                        ? 'scanStageEnumerate'
                        : 'scanStageRead',
                    )}{' '}
                    · <code>{error.code}</code>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {summary.omittedErrors > 0 && (
          <p>{t('scanOmittedErrors', { count: summary.omittedErrors })}</p>
        )}
      </div>
    </details>
  );
}
