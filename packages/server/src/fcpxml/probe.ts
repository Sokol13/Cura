import { open } from 'node:fs/promises';
import { FcpxmlVideoTimingSchema, type FcpxmlVideoTiming } from '@cura/shared';
import { rational } from './rational.js';
interface Atom {
  type: string;
  body: Buffer;
}
const invalid = (detail: string): never => {
  throw new Error(detail);
};
function atoms(bytes: Buffer): Atom[] {
  const result: Atom[] = [];
  for (let p = 0; p < bytes.length; ) {
    if (result.length >= 10000 || bytes.length - p < 8)
      invalid('Invalid or excessive movie atoms');
    const size32 = bytes.readUInt32BE(p),
      type = bytes.toString('ascii', p + 4, p + 8);
    const header = size32 === 1 ? 16 : 8;
    if (p + header > bytes.length) invalid('Truncated movie atom');
    const size =
      size32 === 1
        ? Number(bytes.readBigUInt64BE(p + 8))
        : size32 || bytes.length - p;
    if (!Number.isSafeInteger(size) || size < header || p + size > bytes.length)
      invalid('Invalid movie atom size');
    result.push({ type, body: bytes.subarray(p + header, p + size) });
    p += size;
  }
  return result;
}
function one(bytes: Buffer, type: string): Buffer {
  const matches = atoms(bytes).filter((a) => a.type === type);
  if (matches.length !== 1) invalid(`Expected one ${type} movie atom`);
  return matches[0]!.body;
}
function timeHeader(bytes: Buffer) {
  const version = bytes[0];
  if (version !== 0 && version !== 1) invalid('Unsupported movie time header');
  const timescale = bytes.readUInt32BE(version === 0 ? 12 : 20);
  const duration =
    version === 0 ? BigInt(bytes.readUInt32BE(16)) : bytes.readBigUInt64BE(24);
  if (!timescale || duration <= 0n) invalid('Missing movie timing');
  return { timescale, duration };
}
/** Bounded ISO-BMFF header inspection; never reads or decodes the potentially huge mdat payload. */
export async function probeVideo(path: string): Promise<FcpxmlVideoTiming> {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    let moov: Buffer | undefined,
      count = 0;
    for (let p = 0; p < size; ) {
      if (++count > 10000 || size - p < 8)
        invalid('Invalid movie atom structure');
      const head = Buffer.alloc(16);
      const read = await file.read(head, 0, Math.min(16, size - p), p);
      if (read.bytesRead < 8) invalid('Truncated movie atom');
      const size32 = head.readUInt32BE(0),
        header = size32 === 1 ? 16 : 8;
      const length =
        size32 === 1 ? Number(head.readBigUInt64BE(8)) : size32 || size - p;
      if (!Number.isSafeInteger(length) || length < header || p + length > size)
        invalid('Invalid movie atom length');
      const type = head.toString('ascii', 4, 8);
      if (type === 'moof')
        invalid(
          'Fragmented video is unsupported; export a constant frame rate MP4 or MOV',
        );
      if (type === 'moov') {
        if (moov || length > 16 * 1024 * 1024)
          invalid('Movie metadata is duplicated or exceeds 16 MiB');
        moov = Buffer.alloc(length - header);
        if (
          (await file.read(moov, 0, moov.length, p + header)).bytesRead !==
          moov.length
        )
          invalid('Truncated movie metadata');
      }
      p += length;
    }
    if (!moov)
      invalid('Missing movie metadata; use a constant frame rate MP4 or MOV');
    const movie = moov!;
    const movieTime = timeHeader(one(movie, 'mvhd'));
    const tracks = atoms(movie)
      .filter((a) => a.type === 'trak')
      .map((track) => {
        const mdia = one(track.body, 'mdia');
        return {
          body: track.body,
          mdia,
          kind: one(mdia, 'hdlr').toString('ascii', 8, 12),
        };
      });
    const videos = tracks.filter((t) => t.kind === 'vide'),
      audios = tracks.filter((t) => t.kind === 'soun');
    if (videos.length !== 1 || audios.length > 1)
      invalid('Use one video track and at most one audio track');
    const video = videos[0]!,
      time = timeHeader(one(video.mdia, 'mdhd'));
    const stbl = one(one(video.mdia, 'minf'), 'stbl'),
      stts = one(stbl, 'stts');
    const entries = stts.readUInt32BE(4);
    if (!entries || entries > 10000 || stts.length !== 8 + entries * 8)
      invalid('Invalid sample timing table');
    let frames = 0,
      delta = 0;
    for (let i = 0; i < entries; i++) {
      const count = stts.readUInt32BE(8 + i * 8),
        next = stts.readUInt32BE(12 + i * 8);
      if (!count || !next || (delta && delta !== next))
        invalid(
          'Variable frame rate is unsupported; convert to constant frame rate',
        );
      frames += count;
      delta = next;
    }
    if (BigInt(frames) * BigInt(delta) !== time.duration)
      invalid('Video duration disagrees with sample timing');
    // Multiple edit segments or trimmed/offset presentation needs a richer timeline model.
    const edts = atoms(video.body).find((a) => a.type === 'edts');
    if (edts) {
      const elst = one(edts.body, 'elst'),
        v = elst[0];
      if ((v !== 0 && v !== 1) || elst.readUInt32BE(4) !== 1)
        invalid('Complex video edit lists are unsupported');
      const duration =
        v === 0 ? BigInt(elst.readUInt32BE(8)) : elst.readBigUInt64BE(8);
      const start =
        v === 0 ? BigInt(elst.readInt32BE(12)) : elst.readBigInt64BE(16);
      const rateOffset = v === 0 ? 16 : 24;
      if (
        start !== 0n ||
        elst.readInt16BE(rateOffset) !== 1 ||
        elst.readInt16BE(rateOffset + 2) !== 0 ||
        duration * BigInt(time.timescale) !==
          time.duration * BigInt(movieTime.timescale)
      )
        invalid(
          'Trimmed, delayed or rate-adjusted video edits are unsupported',
        );
    }
    const descriptions = one(stbl, 'stsd');
    if (descriptions.readUInt32BE(4) !== 1)
      invalid('Changing video sample formats are unsupported');
    const sample = atoms(descriptions.subarray(8))[0];
    if (!sample || !['avc1', 'avc3', 'hvc1', 'hev1'].includes(sample.type))
      invalid('Unsupported video codec; use H.264 or HEVC');
    const rate = rational(BigInt(time.timescale), BigInt(delta));
    let audio: 'none' | 'mono' | 'stereo' = 'none',
      audioRate: number | undefined;
    if (audios[0]) {
      const sd = one(one(one(audios[0].mdia, 'minf'), 'stbl'), 'stsd');
      if (sd.readUInt32BE(4) !== 1)
        invalid('Changing audio formats are unsupported');
      const entry = atoms(sd.subarray(8))[0];
      if (
        !entry ||
        !['mp4a', 'lpcm', 'sowt', 'twos'].includes(entry.type) ||
        entry.body.readUInt16BE(8) > 1
      )
        invalid('Unsupported audio codec or sample format');
      const channels = entry!.body.readUInt16BE(16);
      if (channels !== 1 && channels !== 2)
        invalid('Only mono or stereo audio is supported');
      audio = channels === 1 ? 'mono' : 'stereo';
      audioRate = entry!.body.readUInt32BE(24) / 65536;
    }
    return FcpxmlVideoTimingSchema.parse({
      frameRate: rate.d === 1n ? String(rate.n) : `${rate.n}/${rate.d}`,
      durationFrames: frames,
      width: sample!.body.readUInt16BE(24),
      height: sample!.body.readUInt16BE(26),
      audio,
      ...(audioRate ? { audioRate } : {}),
    });
  } catch (error) {
    if (error instanceof RangeError) invalid('Truncated movie metadata');
    throw error;
  } finally {
    await file.close();
  }
}
