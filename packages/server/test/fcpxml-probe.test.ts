import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from 'vitest';
import { probeVideo } from '../src/fcpxml/probe.js';
const fixture = fileURLToPath(
  new URL('../../../e2e/fixtures/rich/first-frame.mp4', import.meta.url),
);
test('reads exact constant frame timing from actual retained H264 header', async () => {
  expect(await probeVideo(fixture)).toEqual({
    frameRate: '1',
    durationFrames: 2,
    width: 64,
    height: 48,
    audio: 'none',
  });
});
test('rejects malformed atom sizes and unsupported codecs without guessed timing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cura-fcp-probe-'));
  try {
    const bytes = await readFile(fixture),
      target = join(directory, 'bad.mp4');
    const codec = Buffer.from(bytes);
    codec.write('zzzz', codec.lastIndexOf('avc1'));
    await writeFile(target, codec);
    await expect(probeVideo(target)).rejects.toThrow(/codec/i);
    bytes.writeUInt32BE(0x7fffffff, 0);
    await writeFile(target, bytes);
    await expect(probeVideo(target)).rejects.toThrow(/atom/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
