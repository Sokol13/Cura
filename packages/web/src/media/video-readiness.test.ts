import { afterEach, expect, it, vi } from 'vitest';
import { renderPreview } from './render';

function harness(frameCallbacks = true) {
  const nativeCreate = document.createElement.bind(document);
  const video = nativeCreate('video'),
    canvas = nativeCreate('canvas');
  const load = vi.spyOn(video, 'load').mockImplementation(() => undefined);
  const pause = vi.spyOn(video, 'pause').mockImplementation(() => undefined);
  Object.defineProperties(video, {
    videoWidth: { configurable: true, value: 64 },
    videoHeight: { configurable: true, value: 48 },
    readyState: { configurable: true, value: 4 },
  });
  let frameCallback: VideoFrameRequestCallback | undefined;
  const requestFrame = vi.fn((callback: VideoFrameRequestCallback) => {
    frameCallback = callback;
    return 41;
  });
  const cancelFrame = vi.fn();
  Object.defineProperties(video, {
    requestVideoFrameCallback: {
      configurable: true,
      value: frameCallbacks ? requestFrame : undefined,
    },
    cancelVideoFrameCallback: { configurable: true, value: cancelFrame },
  });
  const draw = vi.fn();
  vi.spyOn(canvas, 'getContext').mockImplementation((() => ({
    drawImage: draw,
  })) as unknown as typeof canvas.getContext);
  vi.spyOn(canvas, 'toBlob').mockImplementation((callback) =>
    callback(new Blob(['encoded pixels'])),
  );
  vi.spyOn(document, 'createElement').mockImplementation((tag, options) =>
    tag === 'video'
      ? video
      : tag === 'canvas'
        ? canvas
        : nativeCreate(tag, options),
  );
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = () => 'blob:fixture';
      static override revokeObjectURL = revoke;
    },
  );
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1, 2, 3])));
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++sequence, callback);
      return sequence;
    }),
  );
  const cancelAnimation = vi.fn((id: number) => frames.delete(id));
  vi.stubGlobal('cancelAnimationFrame', cancelAnimation);
  return {
    video,
    load,
    pause,
    draw,
    revoke,
    requestFrame,
    cancelFrame,
    cancelAnimation,
    loaded: () => video.dispatchEvent(new Event('loadeddata')),
    presented: () =>
      frameCallback?.(0, {
        width: 64,
        height: 48,
        presentationTime: 0,
        expectedDisplayTime: 0,
        mediaTime: 0,
        presentedFrames: 1,
        processingDuration: 0,
      }),
    animation: () => {
      const current = [...frames.entries()];
      for (const [id, callback] of current) {
        frames.delete(id);
        callback(id * 16);
      }
    },
    render: (signal = new AbortController().signal) =>
      renderPreview(
        {
          id: 'version',
          assetId: 'asset',
          sourceHash: 'a'.repeat(64),
          revision: 0,
          name: 'first-frame.mov',
          format: 'mov',
          size: 3,
        },
        signal,
      ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('does not draw loaded video data until its first frame has been presented', async () => {
  const media = harness();
  const result = media.render();
  await vi.waitFor(() => expect(media.load).toHaveBeenCalledOnce());
  media.loaded();
  await Promise.resolve();
  expect(media.draw).not.toHaveBeenCalled();
  expect(media.requestFrame).toHaveBeenCalledOnce();
  media.presented();
  await expect(result).resolves.toBeInstanceOf(Blob);
  expect(media.draw).toHaveBeenCalledOnce();
  expect(media.video.currentTime).toBe(0);
  expect(media.pause).toHaveBeenCalledOnce();
  expect(media.revoke).toHaveBeenCalledOnce();
});

it('waits for loaded data when frame presentation arrives before the loadeddata event', async () => {
  const media = harness();
  const result = media.render();
  await vi.waitFor(() => expect(media.load).toHaveBeenCalledOnce());
  media.presented();
  await Promise.resolve();
  expect(media.draw).not.toHaveBeenCalled();
  media.loaded();
  await expect(result).resolves.toBeInstanceOf(Blob);
  expect(media.draw).toHaveBeenCalledOnce();
});

it('cancels pending frame callbacks and releases the decoder when aborted', async () => {
  const media = harness(),
    controller = new AbortController();
  const result = media.render(controller.signal);
  await vi.waitFor(() => expect(media.load).toHaveBeenCalledOnce());
  media.loaded();
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  expect(media.cancelFrame).toHaveBeenCalledWith(41);
  expect(media.draw).not.toHaveBeenCalled();
  expect(media.revoke).toHaveBeenCalledOnce();
  expect(media.video.onloadeddata).toBeNull();
  media.presented();
  expect(media.draw).not.toHaveBeenCalled();
});

it('keeps the existing ten-second timeout when decoded data never presents a frame', async () => {
  vi.useFakeTimers();
  const media = harness();
  const result = media.render();
  await vi.waitFor(() => expect(media.load).toHaveBeenCalledOnce());
  media.loaded();
  const rejected = expect(result).rejects.toThrow('TIMEOUT');
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(media.cancelFrame).toHaveBeenCalledWith(41);
  expect(media.draw).not.toHaveBeenCalled();
  expect(media.revoke).toHaveBeenCalledOnce();
});

it('uses ready data across render opportunities without seeking on older browsers', async () => {
  const media = harness(false);
  const result = media.render();
  await vi.waitFor(() => expect(media.load).toHaveBeenCalledOnce());
  media.loaded();
  await Promise.resolve();
  expect(media.draw).not.toHaveBeenCalled();
  media.animation();
  await Promise.resolve();
  expect(media.draw).not.toHaveBeenCalled();
  media.animation();
  await expect(result).resolves.toBeInstanceOf(Blob);
  expect(media.draw).toHaveBeenCalledOnce();
  expect(media.video.currentTime).toBe(0);
});

it('cancels the animation fallback when the preview queue is stopped', async () => {
  const media = harness(false),
    controller = new AbortController();
  const result = media.render(controller.signal);
  await vi.waitFor(() => expect(media.load).toHaveBeenCalledOnce());
  media.loaded();
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  expect(media.cancelAnimation).toHaveBeenCalled();
  expect(media.draw).not.toHaveBeenCalled();
});
