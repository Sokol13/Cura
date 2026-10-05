import { extname } from 'node:path';
import { ScanErrorSchema, type ScanSummary } from '@cura/shared';

/** Keep diagnostic failures bounded and free of machine-specific absolute paths. */
export function addScanFailure(
  summary: ScanSummary,
  relativePath: string | null,
  stage: 'enumerate' | 'read',
  error: unknown,
): void {
  const candidate = (error as NodeJS.ErrnoException | undefined)?.code;
  const code =
    typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(candidate)
      ? candidate
      : 'READ_FAILED';
  const parsed = ScanErrorSchema.safeParse({ relativePath, stage, code });
  const failure = parsed.success
    ? parsed.data
    : { relativePath: null, stage, code };
  summary.readErrors++;
  if (summary.errors.length < 50) summary.errors.push(failure);
  else summary.omittedErrors++;
  if (relativePath !== null && stage === 'read') {
    const extension = extname(relativePath).toLowerCase().normalize('NFC');
    const row = summary.extensions.find((item) => item.extension === extension);
    if (row) row.readErrors++;
  }
}
