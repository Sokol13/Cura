import { randomUUID } from 'node:crypto';
import type { ScriptEntity, ScriptEntityInput } from '@cura/shared';
import { AutomationError } from './errors.js';
export interface ParsedScript {
  text: string;
  lineCount: number;
  entities: ScriptEntity[];
}
export function editEntities(
  text: string,
  input: ScriptEntityInput[],
  existing: ScriptEntity[] = [],
): ScriptEntity[] {
  const lines = text.split(/\r\n|\r|\n/u);
  const starts: number[] = [0];
  for (const match of text.matchAll(/\r\n|\r|\n/gu))
    starts.push(match.index + match[0].length);
  const used = new Set<string>();
  let excerptBytes = 0;
  return input.map((entity) => {
    const id = entity.id ?? randomUUID();
    if (used.has(id) || (entity.id && !existing.some((e) => e.id === id)))
      throw new AutomationError('SCRIPT_INVALID_ENTITY');
    used.add(id);
    return {
      id,
      kind: entity.kind,
      name: entity.name.normalize('NFC').trim(),
      notes: entity.notes ?? '',
      references: entity.ranges.map((range) => {
        if (
          !Number.isInteger(range.startLine) ||
          !Number.isInteger(range.endLine) ||
          range.startLine < 1 ||
          range.endLine < range.startLine ||
          range.endLine > lines.length
        )
          throw new AutomationError('SCRIPT_INVALID_RANGE');
        const start = starts[range.startLine - 1]!;
        const end =
          starts[range.endLine - 1]! + lines[range.endLine - 1]!.length;
        const excerpt = text.slice(start, end);
        excerptBytes += Buffer.byteLength(excerpt, 'utf8');
        if (excerptBytes > 1048576)
          throw new AutomationError('SCRIPT_REFERENCES_TOO_LARGE');
        return { ...range, excerpt };
      }),
    };
  });
}
export function parseScript(bytes: Uint8Array): ParsedScript {
  if (bytes.byteLength > 524288)
    throw new AutomationError('SCRIPT_TOO_LARGE', 413);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new AutomationError('SCRIPT_INVALID_UTF8');
  }
  if (text.includes('\0')) throw new AutomationError('SCRIPT_INVALID_TEXT');
  const lines = text.split(/\r\n|\r|\n/u);
  const inputs: ScriptEntityInput[] = [];
  const byKey = new Map<string, ScriptEntityInput>();
  const add = (kind: ScriptEntity['kind'], name: string, line: number) => {
    name = name.trim().normalize('NFC').slice(0, 200);
    if (!name) return;
    const key = `${kind}:${name}`;
    const range = { startLine: line + 1, endLine: line + 1 };
    const found = byKey.get(key);
    if (found) {
      if (found.ranges.length < 100) found.ranges.push(range);
    } else if (inputs.length < 1000) {
      const item = { kind, name, notes: '', ranges: [range] };
      inputs.push(item);
      byKey.set(key, item);
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const explicit =
      /^(?:#{1,6}\s*)?(人物|角色|CHARACTER|道具|PROP|场景|SCENE)\s*[:：]\s*(.+)$/iu.exec(
        line,
      );
    if (explicit) {
      const key = explicit[1]!.toUpperCase();
      add(
        ['人物', '角色', 'CHARACTER'].includes(key)
          ? 'character'
          : ['道具', 'PROP'].includes(key)
            ? 'prop'
            : 'scene',
        explicit[2]!,
        i,
      );
      return;
    }
    if (
      /^(?:INT\.?|EXT\.?|INT\.?\/EXT\.?|I\/E)\s+\S/iu.test(line) ||
      /^\.(?!\.)(?=\S)/u.test(line)
    ) {
      add('scene', line.replace(/^\./u, ''), i);
      return;
    }
    if (line.startsWith('@')) {
      add('character', line.slice(1).replace(/\s*\([^)]*\)$/u, ''), i);
      return;
    }
    if (
      /^[A-Z][A-Z '\-.]{0,59}(?:\s*\([^)]*\))?$/u.test(line) &&
      !lines[i - 1]?.trim() &&
      lines[i + 1]?.trim() &&
      !/^(FADE|CUT|DISSOLVE|THE END|ACT|SCENE)\b/u.test(line)
    )
      add('character', line.replace(/\s*\([^)]*\)$/u, ''), i);
  });
  return {
    text,
    lineCount: lines.length,
    entities: editEntities(text, inputs),
  };
}
