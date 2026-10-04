import * as C from '@cura/shared';
import type { AppDatabase } from '../database.js';
import { CatalogStore } from '../catalog-store.js';
import { add, compare, frameSeconds, toFcpxmlTime } from './rational.js';
export interface FcpxmlSnapshot {
  manifest: C.FcpxmlManifest;
  sources: Record<string, string>;
}
export class FcpxmlValidationError extends Error {
  constructor(readonly problems: C.FcpxmlProblem[]) {
    super('Some clips cannot be exported. Review the per-clip guidance.');
  }
}
/** Freeze exact pins and authored order in one transaction. Private paths never enter manifest. */
export function readFcpxmlSnapshot(
  database: AppDatabase,
  libraryId: string,
  input: C.CreateFcpxml,
): FcpxmlSnapshot {
  const timeline = C.CreateFcpxmlSchema.parse(input),
    catalog = new CatalogStore(database);
  return database.sqlite.transaction(() => {
    catalog.getLibrary(libraryId);
    const media = new Map<string, C.FcpxmlMedia>(),
      sources: Record<string, string> = {},
      problems: C.FcpxmlProblem[] = [];
    let duration = { n: 0n, d: 1n };
    for (const clip of timeline.clips) {
      duration = add(
        duration,
        frameSeconds(clip.durationFrames, timeline.timebase),
      );
      const problem = (message: string) =>
        problems.push({
          code: 'CLIP_INVALID',
          message,
          clipId: clip.id,
          versionId: clip.versionId,
        });
      try {
        const asset = catalog.getAsset(clip.assetId),
          version = catalog
            .listVersions(asset.id)
            .find((v) => v.id === clip.versionId);
        if (asset.libraryId !== libraryId || !version) {
          problem('Select an exact version belonging to this library.');
          continue;
        }
        const video = ['video/mp4', 'video/quicktime'].includes(version.type);
        if (!video && !['image/png', 'image/jpeg'].includes(version.type)) {
          problem(
            'This format is unsupported by this FCPXML subset. Import a PNG/JPEG still or constant-frame-rate H.264/HEVC MP4/MOV.',
          );
          continue;
        }
        if (video && !clip.videoTiming) {
          problem(
            'Inspect the retained video source to provide its exact timing before exporting.',
          );
          continue;
        }
        if (!video && (clip.inFrames !== 0 || clip.videoTiming)) {
          problem(
            'Still images start at frame zero and have no video source timing.',
          );
          continue;
        }
        if (video && clip.videoTiming) {
          const timing = clip.videoTiming;
          if (
            compare(
              add(
                frameSeconds(clip.inFrames, timing.frameRate),
                frameSeconds(clip.durationFrames, timeline.timebase),
              ),
              frameSeconds(timing.durationFrames, timing.frameRate),
            ) > 0
          ) {
            problem(
              'The clip in-point and duration exceed the retained source duration.',
            );
            continue;
          }
        }
        const previous = media.get(version.id);
        if (
          previous &&
          JSON.stringify(previous.videoTiming) !==
            JSON.stringify(clip.videoTiming)
        ) {
          problem(
            'Repeated references to one version must use identical source timing.',
          );
          continue;
        }
        const width = clip.videoTiming?.width ?? version.width,
          height = clip.videoTiming?.height ?? version.height;
        if (!width || !height) {
          problem(
            'Source dimensions are unavailable. Reimport a supported, decodable file.',
          );
          continue;
        }
        if (!previous) {
          const name = C.versionExportName(asset.displayName, version.name);
          media.set(
            version.id,
            C.FcpxmlMediaSchema.parse({
              resourceId: `asset-${version.id}`,
              assetId: asset.id,
              versionId: version.id,
              originalName: version.name,
              name,
              path: `media/${version.id}-${name}`,
              hash: version.hash,
              size: version.size,
              type: version.type,
              width,
              height,
              ...(clip.videoTiming ? { videoTiming: clip.videoTiming } : {}),
            }),
          );
          sources[version.id] = catalog.getVersionFile(version.id).snapshotPath;
        }
      } catch {
        problem(
          'The exact version is unavailable. Choose another retained version.',
        );
      }
    }
    if (problems.length) throw new FcpxmlValidationError(problems);
    return {
      manifest: C.FcpxmlManifestSchema.parse({
        format: 'cura-fcpxml/1',
        fcpxmlVersion: '1.7',
        libraryId,
        exportedAt: new Date().toISOString(),
        timeline,
        duration: toFcpxmlTime(duration),
        media: [...media.values()],
      }),
      sources,
    };
  })();
}
/** Neutral/cloud metadata reader excludes running jobs and every local package path. */
export function readFcpxmlExport(
  database: AppDatabase,
  libraryId: string,
): C.FcpxmlJob[] {
  return (
    database.sqlite
      .prepare(
        "SELECT payload FROM fcpxml_jobs WHERE library_id=? AND json_extract(payload,'$.status')='completed' ORDER BY created_at,id",
      )
      .all(libraryId) as { payload: string }[]
  ).map((row) => C.FcpxmlJobSchema.parse(JSON.parse(row.payload)));
}
