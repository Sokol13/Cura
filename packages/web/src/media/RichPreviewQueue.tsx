import { useEffect } from 'react';
import {
  PREVIEW_RENDERER,
  PREVIEW_UPLOAD_LIMIT,
  PreviewCandidatesSchema,
  PreviewFailureSchema,
} from '@cura/shared';
export function RichPreviewQueue({ libraryId }: { libraryId: string }) {
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function run() {
      try {
        const response = await fetch(
          `/api/libraries/${encodeURIComponent(libraryId)}/previews`,
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(5000),
            ]),
          },
        );
        if (!response.ok) return;
        const { items } = PreviewCandidatesSchema.parse(await response.json());
        for (const item of items) {
          controller.signal.throwIfAborted();
          const path = `/api/versions/${encodeURIComponent(item.id)}/preview`;
          const deadline = AbortSignal.timeout(30000);
          const signal = AbortSignal.any([controller.signal, deadline]);
          let rendering = true;
          try {
            const { renderPreview } = await import('./render');
            const blob = await renderPreview(item, signal);
            if (blob.size > PREVIEW_UPLOAD_LIMIT) throw new Error('SIZE_LIMIT');
            rendering = false;
            const query = new URLSearchParams({
              sourceHash: item.sourceHash,
              revision: String(item.revision),
              renderer: PREVIEW_RENDERER,
            });
            const saved = await fetch(`${path}?${query}`, {
              method: 'POST',
              headers: { 'content-type': 'application/octet-stream' },
              body: blob,
              signal,
            });
            if (!saved.ok && saved.status !== 409)
              throw new Error('RENDER_FAILED');
          } catch (error) {
            if (controller.signal.aborted) break;
            // Transport/save failures leave the version pending for the next poll.
            if (
              !rendering ||
              deadline.aborted ||
              error instanceof TypeError ||
              (error instanceof Error &&
                (error.message === 'SOURCE_UNAVAILABLE' ||
                  ['AbortError', 'TimeoutError'].includes(error.name)))
            )
              continue;
            const code = deadline.aborted
              ? 'TIMEOUT'
              : error instanceof Error
                ? error.message
                : 'RENDER_FAILED';
            const parsed = PreviewFailureSchema.shape.error.safeParse(code),
              reason = parsed.success ? parsed.data : 'INVALID_FILE';
            await fetch(path, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                sourceHash: item.sourceHash,
                revision: item.revision,
                state: [
                  'VIDEO_CODEC',
                  'UNSUPPORTED_FORMAT',
                  'WEBGL_UNAVAILABLE',
                  'EXTERNAL_RESOURCE',
                  'SIZE_LIMIT',
                  'PIXEL_LIMIT',
                  'MODEL_LIMIT',
                  'PDF_PASSWORD',
                ].includes(reason)
                  ? 'unsupported'
                  : 'failed',
                error: reason,
              }),
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(5000),
              ]),
            });
          }
        }
      } catch {
        /* Network reconnection is retried without changing stored preview results. */
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void run(), 2000);
      }
    }
    void run();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [libraryId]);
  return null;
}
