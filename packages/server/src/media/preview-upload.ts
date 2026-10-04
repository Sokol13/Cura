import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
const PREVIEW_UPLOAD_LIMIT = 4 * 1024 * 1024;

export async function savePreview(
  cacheDir: string,
  bytes: Uint8Array,
): Promise<{ thumbnailPath: string }> {
  const invalid = () =>
    Object.assign(new Error('Upload a bounded PNG preview.'), {
      code: 'INVALID_PREVIEW',
    });
  if (
    bytes.byteLength > PREVIEW_UPLOAD_LIMIT ||
    !Buffer.from(bytes)
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw invalid();
  const decoder = sharp(bytes, {
    limitInputPixels: 4_194_304,
    failOn: 'error',
  });
  const metadata = await decoder.metadata().catch(() => {
    throw invalid();
  });
  if (
    metadata.format !== 'png' ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > 2048 ||
    metadata.height > 2048
  )
    throw invalid();
  const output = await decoder
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer()
    .catch(() => {
      throw invalid();
    });
  const root = await realpath(cacheDir),
    directory = join(root, 'thumbnails');
  await mkdir(directory, { recursive: true });
  if (
    (await lstat(directory)).isSymbolicLink() ||
    (await realpath(directory)) !== directory
  )
    throw Object.assign(new Error('Unsafe preview cache.'), {
      code: 'UNSAFE_CACHE',
    });
  const temporary = join(directory, `${randomUUID()}.tmp`),
    thumbnailPath = join(
      directory,
      `${createHash('sha256').update(output).digest('hex')}.webp`,
    );
  try {
    await writeFile(temporary, output, { flag: 'wx', mode: 0o600 });
    await rename(temporary, thumbnailPath);
  } finally {
    await rm(temporary, { force: true });
  }
  return { thumbnailPath };
}
