import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, realpath, writeFile, stat, rm } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { once } from 'node:events';
import { Zip, ZipPassThrough } from 'fflate';
import sharp from 'sharp';
import type { FcpxmlProblem } from '@cura/shared';
import { frameSeconds, compare } from './rational.js';
import { type FcpxmlSnapshot, FcpxmlValidationError } from './snapshot.js';
import { renderFcpxml } from './xml.js';
import { probeVideo } from './probe.js';
import { relinkScript } from './relink.js';
const instructions = `Cura FCPXML 1.7 package\n\nExtract this entire folder. After moving it to the editing machine, run:\n  node relink.mjs\nThen import timeline.fcpxml in Final Cut Pro. Node 22 is sufficient; no Cura, Python, network, or account is needed for relinking.\n\nRelinking verifies every retained media SHA-256 and size, then rewrites local file URLs for the current location. Keep media/, manifest.json and timeline.fcpxml together. The XML downloaded separately references Cura's stable local export directory. ZIP contents need relinking after extraction or relocation.\n\nClip durations use project frames. Video in-points use source frames. Media are exact retained version bytes; source files are not renamed or modified. PNG/JPEG and the validated CFR H.264/HEVC MP4/MOV subset are supported. Header validation and Apple DTD validation do not replace a Final Cut Pro import smoke test.\n`;
/** Runs in a worker. Bounded streamed copies are verified before a package is advertised as complete. */
export async function writeFcpxmlPackage(
  snapshot: FcpxmlSnapshot,
  temporary: string,
  destination: string,
  dataDirectory: string,
  onProgress: (value: number) => void,
): Promise<number> {
  const root = await realpath(dataDirectory),
    manifest = snapshot.manifest;
  if (manifest.media.reduce((sum, m) => sum + m.size, 0) > 3_400_000_000)
    throw new Error(
      'This timeline exceeds the 3.4 GB media limit. Export a shorter sequence.',
    );
  await mkdir(join(temporary, 'media'), { recursive: true });
  try {
    for (let index = 0; index < manifest.media.length; index++) {
      const media = manifest.media[index]!,
        problems: FcpxmlProblem[] = manifest.timeline.clips
          .filter((c) => c.versionId === media.versionId)
          .map((c) => ({
            code: 'MEDIA_INVALID',
            message:
              'Retained bytes are missing or failed SHA-256/size verification. Reimport the source or choose another version.',
            clipId: c.id,
            versionId: media.versionId,
          }));
      const target = join(temporary, ...media.path.split('/'));
      try {
        const source = await realpath(snapshot.sources[media.versionId]!),
          inside = relative(root, source);
        if (inside.startsWith('..') || isAbsolute(inside))
          throw new Error('Invalid retained location');
        const input = await open(source, 'r');
        try {
          const info = await input.stat();
          if (!info.isFile() || info.size !== media.size)
            throw new Error('Invalid size');
          const output = await open(target, 'wx');
          try {
            const digest = createHash('sha256');
            let size = 0;
            for await (const chunk of input.createReadStream({
              autoClose: false,
              highWaterMark: 256 * 1024,
            })) {
              const data = Buffer.from(chunk);
              digest.update(data);
              size += data.length;
              await output.writeFile(data);
            }
            if (size !== media.size || digest.digest('hex') !== media.hash)
              throw new Error('Invalid retained hash');
          } finally {
            await output.close();
          }
        } finally {
          await input.close();
        }
      } catch {
        throw new FcpxmlValidationError(problems);
      }
      try {
        if (media.videoTiming) {
          const actual = await probeVideo(target),
            declared = media.videoTiming;
          if (
            compare(
              frameSeconds(1, actual.frameRate),
              frameSeconds(1, declared.frameRate),
            ) !== 0 ||
            actual.durationFrames !== declared.durationFrames ||
            actual.width !== declared.width ||
            actual.height !== declared.height ||
            actual.audio !== declared.audio ||
            actual.audioRate !== declared.audioRate
          )
            throw new Error(
              'Source timing differs from the retained video header. Inspect the source again.',
            );
        } else {
          const image = sharp(target, { limitInputPixels: 268402689 }),
            metadata = await image.metadata();
          if (
            !['png', 'jpeg'].includes(metadata.format ?? '') ||
            metadata.width !== media.width ||
            metadata.height !== media.height ||
            (metadata.pages ?? 1) > 1
          )
            throw new Error('Still image metadata is unsupported or changed.');
          await image.resize(1, 1).raw().toBuffer();
        }
      } catch (error) {
        throw new FcpxmlValidationError(
          problems.map((p) => ({
            ...p,
            code: 'SOURCE_UNSUPPORTED',
            message:
              media.videoTiming && error instanceof Error && !('code' in error)
                ? error.message
                : 'The retained media could not be decoded or inspected. Import a supported file.',
          })),
        );
      }
      onProgress((0.7 * (index + 1)) / manifest.media.length);
    }
    await writeFile(
      join(temporary, 'timeline.fcpxml'),
      renderFcpxml(manifest, destination),
    );
    await writeFile(
      join(temporary, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    await writeFile(join(temporary, 'relink.mjs'), relinkScript);
    await writeFile(join(temporary, 'README.txt'), instructions);
    const files = [
      ...manifest.media.map((m) => m.path),
      'timeline.fcpxml',
      'manifest.json',
      'relink.mjs',
      'README.txt',
    ];
    const archive = join(temporary, 'package.zip'),
      output = createWriteStream(archive, { flags: 'wx' });
    let outputError: Error | undefined;
    output.on('error', (e) => {
      outputError = e;
    });
    const finished = new Promise<void>((resolve, reject) => {
      output.once('finish', resolve);
      output.once('error', reject);
      output.once('close', () => {
        if (!output.writableFinished)
          reject(new Error('Package output closed'));
      });
    });
    void finished.catch(() => undefined);
    const zip = new Zip((error, chunk, final) => {
      if (error) {
        output.destroy(error);
        return;
      }
      output.write(chunk);
      if (final) output.end();
    });
    try {
      for (let index = 0; index < files.length; index++) {
        const path = files[index]!,
          entry = new ZipPassThrough(path);
        zip.add(entry);
        const handle = await open(join(temporary, ...path.split('/')), 'r');
        try {
          for await (const chunk of handle.createReadStream({
            autoClose: false,
            highWaterMark: 256 * 1024,
          })) {
            entry.push(Buffer.from(chunk), false);
            if (outputError) throw outputError;
            if (output.writableNeedDrain) await once(output, 'drain');
          }
          entry.push(new Uint8Array(), true);
        } finally {
          await handle.close();
        }
        onProgress(0.7 + (0.29 * (index + 1)) / files.length);
      }
      zip.end();
      await finished;
      if (outputError) throw outputError;
    } catch (error) {
      zip.terminate();
      output.destroy();
      await finished.catch(() => undefined);
      throw error;
    }
    return (await stat(archive)).size;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
