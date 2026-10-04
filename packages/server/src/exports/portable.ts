import type { ExportManifest } from '@cura/shared';
/** Filenames are labels only; UUID/hash directories provide collision-free identity. */
export function portableName(value: string): string {
  let safe = Buffer.from(value, 'utf8')
    .toString('utf8')
    .normalize('NFC')
    // Control bytes cannot appear in a portable filename.
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/<>:"|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/[. ]+$/, '')
    .replace(/[. ]+$/, '');
  while (Buffer.byteLength(safe, 'utf8') > 100)
    safe = Array.from(safe).slice(0, -1).join('');
  safe = safe.replace(/[. ]+$/, '');
  return !safe ||
    /^(?:\.|\.\.|con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(safe)
    ? `_${safe || 'untitled'}`
    : safe;
}
/** Quote every cell and neutralize spreadsheet formulas, including leading whitespace. */
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  // Ignore leading control bytes when detecting spreadsheet formulas.
  // eslint-disable-next-line no-control-regex
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function assetsCsv(manifest: ExportManifest): string {
  const columns = [
    'id',
    'name',
    'displayName',
    'archivedAt',
    'currentVersionId',
    'hash',
    'type',
    'size',
    'width',
    'height',
    'prompt',
    'negativePrompt',
    'model',
    'source',
    'seed',
    'note',
    'rating',
    'finalized',
    'folderId',
    'rootId',
    'relativePath',
    'deletedAt',
    'createdAt',
    'updatedAt',
    'tags',
  ];
  return (
    '\uFEFF' +
    [
      columns.map(csvCell).join(','),
      ...manifest.assets.map((asset) =>
        columns
          .map((key) =>
            csvCell(
              key === 'tags'
                ? asset.tags.map((tag) => tag.name).join('; ')
                : asset[key as keyof typeof asset],
            ),
          )
          .join(','),
      ),
    ].join('\r\n') +
    '\r\n'
  );
}
