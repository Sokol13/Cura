import { z } from 'zod';

const reserved = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
// Labels can become exported filenames, so the same portable character rules apply.
// eslint-disable-next-line no-control-regex
const forbidden = /[\\/<>:"|?*\u0000-\u001f\u007f]/;
const bytes = (value: string) => new TextEncoder().encode(value).length;
export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .transform((value) => value.normalize('NFC'))
  .refine(
    (value) =>
      !forbidden.test(value) &&
      !reserved.test(value) &&
      !/[. ]$/.test(value) &&
      bytes(value) <= 255,
    'Use a portable display name',
  );

export function assetDisplayName(asset: {
  name: string;
  displayName?: string | null;
}): string {
  return asset.displayName ?? asset.name;
}

function split(value: string): [string, string] {
  const dot = value.lastIndexOf('.');
  return dot > 0 && dot < value.length - 1
    ? [value.slice(0, dot), value.slice(dot)]
    : [value, ''];
}

function clean(value: string): string {
  return (
    new TextDecoder()
      .decode(new TextEncoder().encode(value))
      .normalize('NFC')
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/<>:"|?*\u0000-\u001f\u007f]/g, '_')
      .trim()
      .replace(/[. ]+$/, '')
  );
}

function label(stem: string, extension: string, suffix = ''): string {
  let safe = clean(stem) || 'untitled';
  if (reserved.test(safe + extension)) safe = '_' + safe;
  const ending = suffix + extension;
  if (bytes(ending) > 250)
    throw new Error(
      'The original file extension exceeds portable filename limits',
    );
  while (bytes(safe + ending) > 255)
    safe = Array.from(safe).slice(0, -1).join('');
  return safe + ending;
}

/** The exact version, never its current replacement, determines the extension. */
export function versionExportName(
  displayName: string | null | undefined,
  versionName: string,
): string {
  const [originalStem, extension] = split(clean(versionName));
  const stem = displayName ? split(clean(displayName))[0] : originalStem;
  return label(stem, extension);
}

export function proposeDisplayName(
  candidate: string,
  originalName: string,
  occupiedNames: readonly string[] = [],
): string {
  const initial = versionExportName(candidate, originalName);
  const [stem, extension] = split(initial);
  const occupied = new Set(
    occupiedNames.map((name) => name.normalize('NFC').toLowerCase()),
  );
  let result = initial;
  for (let index = 2; occupied.has(result.toLowerCase()); index++)
    result = label(stem, extension, ` (${index})`);
  return DisplayNameSchema.parse(result);
}
