import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  CreateFcpxmlSchema,
  FcpxmlSourceRateSchema,
  FcpxmlVideoTimingSchema,
} from '../../shared/src/fcpxml.js';
const clip = () => ({
  id: randomUUID(),
  assetId: randomUUID(),
  versionId: randomUUID(),
  durationFrames: 125,
});
test('FCPXML requests retain explicit pin order and exact rational frame rates', () => {
  const first = clip(),
    second = clip();
  const parsed = CreateFcpxmlSchema.parse({
    name: '镜头 & 序列',
    timebase: '24000/1001',
    clips: [second, first],
  });
  expect(parsed.clips.map((item) => item.versionId)).toEqual([
    second.versionId,
    first.versionId,
  ]);
  expect(parsed.timebase).toBe('24000/1001');
  expect(FcpxmlSourceRateSchema.parse('30000/1001')).toBe('30000/1001');
});
test('FCPXML rejects duplicate entries, invalid XML text, invented audio defaults and nonpositive timing', () => {
  const item = clip();
  expect(() =>
    CreateFcpxmlSchema.parse({ name: 'Sequence', clips: [item, item] }),
  ).toThrow();
  expect(() =>
    CreateFcpxmlSchema.parse({
      name: 'bad' + String.fromCharCode(0),
      clips: [item],
    }),
  ).toThrow();
  for (const rate of ['0', '24/0', 'Infinity', '23.976', '9999999999'])
    expect(FcpxmlSourceRateSchema.safeParse(rate).success).toBe(false);
  expect(
    FcpxmlVideoTimingSchema.safeParse({
      frameRate: '25',
      durationFrames: 50,
      width: 1920,
      height: 1080,
    }).success,
  ).toBe(false);
  expect(
    FcpxmlVideoTimingSchema.safeParse({
      frameRate: '25',
      durationFrames: 50,
      width: 1920,
      height: 1080,
      audio: 'stereo',
    }).success,
  ).toBe(false);
  expect(
    FcpxmlVideoTimingSchema.safeParse({
      frameRate: '25',
      durationFrames: 50,
      width: 1920,
      height: 1080,
      audio: 'stereo',
      audioRate: 48000,
    }).success,
  ).toBe(true);
});

test('FCPXML job migration persists valid job payloads with required library ownership', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { readFile } = await import('node:fs/promises');
  const database = new Database(':memory:');
  try {
    database.pragma('foreign_keys = ON');
    database.exec('CREATE TABLE libraries (id TEXT PRIMARY KEY);');
    database.exec(
      await readFile(
        new URL('../drizzle/0008_fcpxml.sql', import.meta.url),
        'utf8',
      ),
    );
    const libraryId = randomUUID(),
      id = randomUUID(),
      date = new Date().toISOString();
    expect(() =>
      database
        .prepare('INSERT INTO fcpxml_jobs VALUES (?,?,?,NULL,?,?)')
        .run(id, libraryId, '{}', date, date),
    ).toThrow();
    database.prepare('INSERT INTO libraries VALUES (?)').run(libraryId);
    database
      .prepare('INSERT INTO fcpxml_jobs VALUES (?,?,?,NULL,?,?)')
      .run(id, libraryId, JSON.stringify({ status: 'queued' }), date, date);
    expect(
      database
        .prepare(
          'SELECT payload,created_at,updated_at FROM fcpxml_jobs WHERE id=?',
        )
        .get(id),
    ).toEqual({
      payload: '{"status":"queued"}',
      created_at: date,
      updated_at: date,
    });
  } finally {
    database.close();
  }
});
