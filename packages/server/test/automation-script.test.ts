import { describe, expect, it } from 'vitest';
import { parseScript, editEntities } from '../src/automation/script.js';
describe('retained script source references', () => {
  it('extracts explicit bilingual scenes, character cues and props with exact CRLF excerpts', () => {
    const bytes = Buffer.from(
      'INT. HOUSE - DAY\r\n\r\nALICE\r\nHello.\r\nPROP: red key\r\n\r\n场景：森林 - 夜\r\n人物：小林\r\n道具：灯笼\r\n',
    );
    const result = parseScript(bytes);
    expect(result.entities.map((e) => [e.kind, e.name])).toEqual(
      expect.arrayContaining([
        ['scene', 'INT. HOUSE - DAY'],
        ['character', 'ALICE'],
        ['prop', 'red key'],
        ['scene', '森林 - 夜'],
        ['character', '小林'],
        ['prop', '灯笼'],
      ]),
    );
    expect(
      result.entities.find((e) => e.name === 'ALICE')?.references[0],
    ).toEqual({ startLine: 3, endLine: 3, excerpt: 'ALICE' });
    const changed = editEntities(result.text, [
      {
        kind: 'character',
        name: 'Alice revised',
        notes: 'note',
        ranges: [{ startLine: 3, endLine: 4 }],
      },
    ]);
    expect(changed[0]?.references[0]?.excerpt).toBe('ALICE\r\nHello.');
  });
  it('rejects invalid UTF8, oversized text and fabricated out-of-source references', () => {
    expect(() => parseScript(Buffer.from([0xc3, 0x28]))).toThrow(
      'SCRIPT_INVALID_UTF8',
    );
    expect(() => parseScript(Buffer.alloc(524289, 65))).toThrow(
      'SCRIPT_TOO_LARGE',
    );
    expect(() =>
      editEntities('one line', [
        { kind: 'prop', name: 'door', ranges: [{ startLine: 1, endLine: 2 }] },
      ]),
    ).toThrow('SCRIPT_INVALID_RANGE');
  });
  it('bounds aggregate excerpt bytes when repeated ranges amplify a small source', () => {
    expect(() =>
      editEntities('a'.repeat(20000), [
        {
          kind: 'prop',
          name: 'Repeated',
          ranges: Array.from({ length: 60 }, () => ({
            startLine: 1,
            endLine: 1,
          })),
        },
      ]),
    ).toThrow('SCRIPT_REFERENCES_TOO_LARGE');
  });
  it('preserves a UTF-8 BOM and combining characters in exact source excerpts', () => {
    const text = '\ufeffSCENE: cafe\u0301\r\n';
    const parsed = parseScript(Buffer.from(text));
    expect(parsed.text).toBe(text);
    expect(parsed.entities[0]?.references[0]?.excerpt).toBe(text.slice(0, -2));
  });
  it('preserves stable entity identities and labels unsupported prose as no structured matches', () => {
    const parsed = parseScript(
      Buffer.from(
        'Once upon a time a girl carried a lantern through a forest.',
      ),
    );
    expect(parsed.entities).toEqual([]);
    const source = parseScript(Buffer.from('INT. ROOM\n\nALICE\nHello'));
    const first = source.entities[0]!;
    expect(
      editEntities(
        source.text,
        [
          {
            id: first.id,
            kind: first.kind,
            name: first.name,
            notes: 'edited',
            ranges: first.references,
          },
        ],
        source.entities,
      )[0]?.id,
    ).toBe(first.id);
  });
});
