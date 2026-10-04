import { parentPort, workerData } from 'node:worker_threads';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { resolveContained } from '../media/path-utils.js';
import { parseScript, editEntities } from './script.js';
import { AutomationError, errorCode } from './errors.js';
import type { ScriptEntity, ScriptEntityInput } from '@cura/shared';
type Job =
  | { op: 'image'; root: string; relativePath: string; expectedHash?: string }
  | { op: 'script'; bytes: Uint8Array }
  | {
      op: 'edit';
      text: string;
      entities: ScriptEntityInput[];
      existing: ScriptEntity[];
    }
  | {
      op: 'read-script';
      root: string;
      relativePath: string;
      expectedHash?: string;
    };
async function run(job: Job) {
  if (job.op === 'script') return parseScript(job.bytes);
  if (job.op === 'edit')
    return editEntities(job.text, job.entities, job.existing);
  const path = await resolveContained(job.root, job.relativePath);
  const limit = job.op === 'image' ? 67108864 : 524288;
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  let bytes: Buffer;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limit)
      throw new AutomationError(
        job.op === 'image' ? 'VISION_INPUT_TOO_LARGE' : 'SCRIPT_TOO_LARGE',
      );
    const buffer = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    if (
      offset !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new AutomationError('SOURCE_CHANGED');
    bytes = buffer.subarray(0, offset);
    if (
      job.expectedHash &&
      createHash('sha256').update(bytes).digest('hex') !== job.expectedHash
    )
      throw new AutomationError('SOURCE_CHANGED');
  } finally {
    await handle.close();
  }
  if (job.op === 'read-script') return parseScript(bytes);
  try {
    const png = await sharp(bytes, {
      limitInputPixels: 16777216,
      animated: false,
    })
      .rotate()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    if (png.length > 1048576)
      throw new AutomationError('VISION_INPUT_TOO_LARGE');
    return png;
  } catch (error) {
    if (error instanceof AutomationError) throw error;
    throw new AutomationError('VISION_INPUT_UNAVAILABLE');
  }
}
void run(workerData as Job).then(
  (result) => parentPort?.postMessage({ result }),
  (error) => parentPort?.postMessage({ error: errorCode(error) }),
);
