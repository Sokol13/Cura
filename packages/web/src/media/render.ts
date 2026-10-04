import type { PreviewCandidate } from '@cura/shared';
import { PIXEL_LIMIT } from './validation';
export async function sourceBytes(
  candidate: PreviewCandidate,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const limit = ['mp4', 'mov'].includes(candidate.format)
    ? 100 * 1024 * 1024
    : 50 * 1024 * 1024;
  if (candidate.size > limit) throw new Error('SIZE_LIMIT');
  function unavailable(): never {
    throw new Error('SOURCE_UNAVAILABLE');
  }
  const response = await fetch(
    `/api/versions/${encodeURIComponent(candidate.id)}/file`,
    { signal },
  ).catch(unavailable);
  if (!response.ok || !response.body) unavailable();
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read().catch(unavailable);
      if (done) break;
      size += value.byteLength;
      if (size > limit || size > candidate.size) throw new Error('SIZE_LIMIT');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (size !== candidate.size) unavailable();
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data.buffer;
}
async function video(bytes: ArrayBuffer, signal: AbortSignal): Promise<Blob> {
  const element = document.createElement('video'),
    url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
  element.muted = true;
  element.playsInline = true;
  element.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('TIMEOUT')), 10000);
      const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        element.onloadeddata = null;
        element.onerror = null;
        if (error) reject(error);
        else resolve();
      };
      signal.addEventListener('abort', abort, { once: true });
      element.onloadeddata = () => finish();
      element.onerror = () => finish(new Error('VIDEO_CODEC'));
      element.src = url;
      element.load();
      if (signal.aborted) abort();
    });
    if (
      !element.videoWidth ||
      !element.videoHeight ||
      element.videoWidth * element.videoHeight > PIXEL_LIMIT
    )
      throw new Error('PIXEL_LIMIT');
    const scale = Math.min(
        1,
        1024 / element.videoWidth,
        1024 / element.videoHeight,
      ),
      canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(element.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(element.videoHeight * scale));
    canvas
      .getContext('2d')!
      .drawImage(element, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('RENDER_FAILED'))),
        'image/png',
      ),
    );
  } finally {
    element.pause();
    element.removeAttribute('src');
    element.load();
    URL.revokeObjectURL(url);
  }
}
export async function renderPreview(
  candidate: PreviewCandidate,
  signal: AbortSignal,
): Promise<Blob> {
  const bytes = await sourceBytes(candidate, signal);
  signal.throwIfAborted();
  if (candidate.format === 'mp4' || candidate.format === 'mov')
    return video(bytes, signal);
  const worker = new Worker(new URL('./render.worker.ts', import.meta.url), {
    type: 'module',
  });
  return new Promise<Blob>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('TIMEOUT')), 15000);
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    const finish = (error: Error | null, blob?: Blob) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else if (blob) resolve(blob);
      else reject(new Error('RENDER_FAILED'));
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(new Error('RENDER_FAILED'));
    worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string }>) =>
      finish(
        event.data.error ? new Error(event.data.error) : null,
        event.data.blob,
      );
    worker.postMessage({ bytes, format: candidate.format }, [bytes]);
    if (signal.aborted) abort();
  });
}
