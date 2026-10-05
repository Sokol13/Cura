import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { frameSeconds, toFcpxmlTime, add } from '../src/fcpxml/rational.js';
import { renderFcpxml } from '../src/fcpxml/xml.js';
import { FcpxmlManifestSchema } from '../../shared/src/fcpxml.js';
import { hasFcpxmlDtd } from './fcpxml-dtd.js';

if (!hasFcpxmlDtd) {
  console.warn(
    'Skipping FCPXML DTD-dependent tests: .tmp/fcpxml/FCPXMLv1_7.dtd is missing. To enable them, install Python with lxml==6.1.1 and run python3 scripts/validate-fcpxml.py --prepare from the repository root.',
  );
}

test('rational time remains exact at broadcast and integer rates without float accumulation', () => {
  expect(toFcpxmlTime(frameSeconds(24000, '24000/1001'))).toBe('1001s');
  expect(
    toFcpxmlTime(
      add(frameSeconds(120, '24000/1001'), frameSeconds(48, '24000/1001')),
    ),
  ).toBe('7007/1000s');
  for (const rate of ['24', '25', '30'])
    expect(toFcpxmlTime(frameSeconds(Number(rate) * 5, rate))).toBe('5s');
  expect(() => toFcpxmlTime({ n: 1n << 63n, d: 1n })).toThrow();
});
test('1.7 XML uses ordered exact pins, stable asset IDs and escaped names with local file URLs', () => {
  const libraryId = randomUUID(),
    assetId = randomUUID(),
    versionId = randomUUID();
  const clip = {
    id: randomUUID(),
    assetId,
    versionId,
    label: '镜头 & <one>',
    durationFrames: 125,
  };
  const manifest = FcpxmlManifestSchema.parse({
    format: 'cura-fcpxml/1',
    fcpxmlVersion: '1.7',
    libraryId,
    exportedAt: new Date().toISOString(),
    timeline: {
      name: 'A & B',
      timebase: '25',
      clips: [clip, { ...clip, id: randomUUID(), durationFrames: 50 }],
    },
    duration: '7s',
    media: [
      {
        resourceId: 'asset-' + versionId,
        assetId,
        versionId,
        originalName: 'old.jpg',
        name: '镜头.jpg',
        path: 'media/镜头.jpg',
        hash: 'a'.repeat(64),
        size: 100,
        type: 'image/jpeg',
        width: 640,
        height: 480,
      },
    ],
  });
  const xml = renderFcpxml(manifest, '/tmp/FCP package');
  expect(xml).toContain('<fcpxml version="1.7">');
  expect(xml).toContain('name="A &amp; B"');
  expect(xml).toContain('name="镜头 &amp; &lt;one&gt;"');
  expect(xml).toContain('src="file:///tmp/FCP%20package/media/');
  expect(xml).toContain('offset="5s"');
  expect(xml).toContain('duration="7s"');
  expect(xml).not.toContain('media-rep');
});

test('official Apple DTD independently validates all timebases and rejects broken resource IDs', async (context) => {
  if (!hasFcpxmlDtd) context.skip();
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { fileURLToPath } = await import('node:url');
  const run = promisify(execFile);
  const directory = await mkdtemp(join(tmpdir(), 'cura-fcp-dtd-'));
  try {
    const assetId = randomUUID(),
      versionId = randomUUID();
    const validator = fileURLToPath(
      new URL('../../../scripts/validate-fcpxml.py', import.meta.url),
    );
    for (const timebase of ['24', '25', '30', '24000/1001']) {
      const manifest = FcpxmlManifestSchema.parse({
        format: 'cura-fcpxml/1',
        fcpxmlVersion: '1.7',
        libraryId: randomUUID(),
        exportedAt: new Date().toISOString(),
        timeline: {
          name: '中文 & timeline',
          timebase,
          clips: [
            { id: randomUUID(), assetId, versionId, durationFrames: 120 },
            { id: randomUUID(), assetId, versionId, durationFrames: 48 },
          ],
        },
        duration: toFcpxmlTime(frameSeconds(168, timebase)),
        media: [
          {
            resourceId: 'asset-' + versionId,
            assetId,
            versionId,
            originalName: '历史.png',
            name: '历史.png',
            path: 'media/历史.png',
            hash: 'a'.repeat(64),
            size: 100,
            type: 'image/png',
            width: 64,
            height: 48,
          },
        ],
      });
      const file = join(directory, 'timeline.fcpxml'),
        xml = renderFcpxml(manifest, directory);
      await writeFile(file, xml);
      const { stdout } = await run('python3', [validator, file]);
      expect(JSON.parse(stdout).clips).toBe(2);
      await writeFile(
        file,
        xml.replace('ref="asset-' + versionId + '"', 'ref="missing-id"'),
      );
      await expect(run('python3', [validator, file])).rejects.toThrow();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
