import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FcpxmlManifest } from '@cura/shared';
import { add, frameSeconds, toFcpxmlTime } from './rational.js';
function xml(value: string): string {
  const valid = Array.from(value, (character) => {
    const p = character.codePointAt(0)!;
    return p === 9 ||
      p === 10 ||
      p === 13 ||
      (p >= 32 && p <= 0xd7ff) ||
      (p >= 0xe000 && p <= 0xfffd) ||
      (p >= 0x10000 && p <= 0x10ffff)
      ? character
      : '�';
  }).join('');
  return valid
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('\r', '&#13;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\t', '&#9;');
}
/** Strict 1.7 subset: asset@src, resource formats, one serial project spine. */
export function renderFcpxml(
  manifest: FcpxmlManifest,
  directory: string,
): string {
  const timeline = manifest.timeline,
    format = 'sequence-format',
    lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE fcpxml>',
      '<fcpxml version="1.7">',
      '  <resources>',
      `    <format id="${format}" frameDuration="${toFcpxmlTime(frameSeconds(1, timeline.timebase))}" width="${timeline.width}" height="${timeline.height}" colorSpace="1-1-1 (Rec. 709)"/>`,
    ];
  for (const media of manifest.media) {
    const target = resolve(directory, ...media.path.split('/')),
      inside = relative(resolve(directory), target);
    if (isAbsolute(inside) || inside.startsWith('..'))
      throw new Error('Invalid package-relative media path');
    const sourceFormat = `format-${media.versionId}`,
      video = media.videoTiming;
    lines.push(
      `    <format id="${sourceFormat}" ${video ? `frameDuration="${toFcpxmlTime(frameSeconds(1, video.frameRate))}"` : 'name="FFVideoFormatRateUndefined"'} width="${media.width}" height="${media.height}"/>`,
    );
    const audio =
      video && video.audio !== 'none'
        ? ` hasAudio="1" audioSources="1" audioChannels="${video.audio === 'mono' ? 1 : 2}" audioRate="${video.audioRate}"`
        : '';
    lines.push(
      `    <asset id="${media.resourceId}" name="${xml(media.name)}" src="${xml(pathToFileURL(target).href)}" start="0s" duration="${video ? toFcpxmlTime(frameSeconds(video.durationFrames, video.frameRate)) : '0s'}" hasVideo="1" format="${sourceFormat}"${audio}/>`,
    );
  }
  lines.push(
    '  </resources>',
    `  <event name="Cura"><project name="${xml(timeline.name)}">`,
    `    <sequence format="${format}" duration="${manifest.duration}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    '      <spine>',
  );
  let offset = { n: 0n, d: 1n };
  for (const clip of timeline.clips) {
    const media = manifest.media.find(
      (item) =>
        item.versionId === clip.versionId && item.assetId === clip.assetId,
    );
    if (!media) throw new Error('Missing exact version resource');
    const duration = frameSeconds(clip.durationFrames, timeline.timebase),
      start = media.videoTiming
        ? frameSeconds(clip.inFrames, media.videoTiming.frameRate)
        : { n: 0n, d: 1n };
    lines.push(
      `        <asset-clip ref="${media.resourceId}" name="${xml(clip.label || media.name)}" offset="${toFcpxmlTime(offset)}" start="${toFcpxmlTime(start)}" duration="${toFcpxmlTime(duration)}"/>`,
    );
    offset = add(offset, duration);
  }
  if (toFcpxmlTime(offset) !== manifest.duration)
    throw new Error('Timeline duration does not match its ordered clips');
  lines.push(
    '      </spine>',
    '    </sequence>',
    '  </project></event>',
    '</fcpxml>',
    '',
  );
  return lines.join('\n');
}
