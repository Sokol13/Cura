import type Database from 'better-sqlite3';
import { AssetQuerySchema, type AssetQuery } from '@cura/shared';

export function hammingDistance(left: string, right: string): number {
  if (
    !left ||
    left.length !== right.length ||
    !/^[a-f\d]+$/i.test(left + right)
  )
    return 1024;
  let bits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (bits) {
    bits &= bits - 1n;
    count++;
  }
  return count;
}
export function colorDistance(palette: string, color: string): number {
  const colors: unknown = JSON.parse(palette);
  if (!Array.isArray(colors)) return 1000;
  const rgb = (v: string) =>
    [1, 3, 5].map((offset) => parseInt(v.slice(offset, offset + 2), 16));
  const target = rgb(color);
  return Math.min(
    1000,
    ...colors
      .filter(
        (v): v is string => typeof v === 'string' && /^#[a-f\d]{6}$/i.test(v),
      )
      .map((v) =>
        Math.sqrt(
          rgb(v).reduce(
            (sum, channel, i) => sum + (channel - target[i]!) ** 2,
            0,
          ),
        ),
      ),
  );
}
export function registerSearchFunctions(sqlite: Database.Database) {
  sqlite.function('cura_hamming', { deterministic: true }, (a, b) =>
    hammingDistance(String(a), String(b)),
  );
  sqlite.function('cura_color_distance', { deterministic: true }, (a, b) =>
    colorDistance(String(a), String(b)),
  );
}
export function assetSearch(
  libraryId: string,
  input: AssetQuery,
  similarHash?: string,
) {
  const q = AssetQuerySchema.parse(input);
  const clauses = [
    'a.library_id = ?',
    q.trash ? 'a.deleted_at IS NOT NULL' : 'a.deleted_at IS NULL',
  ];
  const params: Array<string | number> = [libraryId];
  if (!q.trash)
    clauses.push(
      `json_extract(a.payload, '$.archivedAt') IS ${q.archived ? 'NOT ' : ''}NULL`,
    );
  const orders: string[] = [];
  const orderParams: Array<string | number> = [];
  if (q.q) {
    const normalized = q.q.normalize('NFC');
    const terms = normalized.match(/[\p{L}\p{N}_]+/gu) ?? [];
    if (terms.length) {
      const match = terms
        .map((term) => `"${term.replaceAll('"', '""')}"`)
        .join(' AND ');
      if (/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(normalized)) {
        const substrings = terms
          .map(() => "a.search_text LIKE ? ESCAPE '\\'")
          .join(' AND ');
        clauses.push(
          `(a.id IN (SELECT asset_id FROM asset_fts WHERE asset_fts MATCH ?) OR (${substrings}))`,
        );
        params.push(
          match,
          ...terms.map(
            (term) => `%${term.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`,
          ),
        );
      } else {
        clauses.push(
          'a.id IN (SELECT asset_id FROM asset_fts WHERE asset_fts MATCH ?)',
        );
        params.push(match);
      }
    } else {
      clauses.push('0');
    }
  }
  if (q.folderId) {
    clauses.push(
      'a.folder_id IN (WITH RECURSIVE children(id) AS (SELECT id FROM folders WHERE id = ? AND library_id = ? UNION ALL SELECT f.id FROM folders f JOIN children c ON f.parent_id = c.id) SELECT id FROM children)',
    );
    params.push(q.folderId, libraryId);
  }
  if (q.tagId) {
    clauses.push(
      'EXISTS (SELECT 1 FROM asset_tags at WHERE at.asset_id = a.id AND at.tag_id = ?)',
    );
    params.push(q.tagId);
  }
  for (const key of ['rating', 'type', 'source'] as const)
    if (q[key] !== undefined) {
      clauses.push(`json_extract(a.payload, '$.${key}') = ?`);
      params.push(q[key]);
    }
  for (const [key, field, operator] of [
    ['after', 'created_at', '>='],
    ['before', 'created_at', '<='],
  ] as const)
    if (q[key]) {
      clauses.push(`a.${field} ${operator} ?`);
      params.push(q[key]);
    }
  for (const [key, field, operator] of [
    ['minWidth', 'width', '>='],
    ['maxWidth', 'width', '<='],
    ['minHeight', 'height', '>='],
    ['maxHeight', 'height', '<='],
  ] as const)
    if (q[key] !== undefined) {
      clauses.push(`json_extract(a.payload, '$.${field}') ${operator} ?`);
      params.push(q[key]);
    }
  if (q.color) {
    const expression =
      "cura_color_distance(json_extract(a.payload, '$.colors'), ?)";
    clauses.push(`${expression} <= 100`);
    params.push(q.color);
    orders.push(expression);
    orderParams.push(q.color);
  }
  if (similarHash !== undefined) {
    orders.unshift("cura_hamming(json_extract(a.payload, '$.phash'), ?)");
    orderParams.unshift(similarHash);
  }
  orders.push('a.created_at DESC', 'a.rowid DESC');
  return {
    where: clauses.join(' AND '),
    params,
    order: orders.join(', '),
    orderParams,
    limit: q.limit,
    offset: q.offset,
  };
}
