/// <reference lib="webworker" />
import type { RichFormat } from '@cura/shared';
import { PIXEL_LIMIT, validateModel, validatePsd } from './validation';

async function psd(bytes: Uint8Array): Promise<Blob> {
  const { width, height } = validatePsd(bytes);
  const { readPsd, initializeCanvas } = await import('ag-psd');
  initializeCanvas(
    () => {
      throw new Error('INVALID_FILE');
    },
    undefined,
    (w, h) => new ImageData(w, h),
  );
  const document = readPsd(bytes.buffer as ArrayBuffer, {
    skipLayerImageData: true,
    skipThumbnail: true,
    skipLinkedFilesData: true,
    useImageData: true,
  });
  if (!document.imageData) throw new Error('INVALID_FILE');
  const full = new OffscreenCanvas(width, height),
    context = full.getContext('2d');
  if (!context) throw new Error('RENDER_FAILED');
  context.putImageData(document.imageData, 0, 0);
  const scale = Math.min(1, 1024 / width, 1024 / height),
    canvas = new OffscreenCanvas(
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
    );
  canvas.getContext('2d')!.drawImage(full, 0, 0, canvas.width, canvas.height);
  full.width = full.height = 1;
  return canvas.convertToBlob({ type: 'image/png' });
}
async function pdf(bytes: Uint8Array): Promise<Blob> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import(
    'pdfjs-dist/build/pdf.worker.min.mjs?url'
  );
  const parser = new Worker(workerUrl, { type: 'module' });
  const pdfWorker = pdfjs.PDFWorker.create({ port: parser });
  class CanvasFactory {
    create(width: number, height: number) {
      if (width * height > PIXEL_LIMIT) throw new Error('PIXEL_LIMIT');
      const canvas = new OffscreenCanvas(width, height);
      return { canvas, context: canvas.getContext('2d')! };
    }
    reset(target: { canvas: OffscreenCanvas }, width: number, height: number) {
      if (width * height > PIXEL_LIMIT) throw new Error('PIXEL_LIMIT');
      target.canvas.width = width;
      target.canvas.height = height;
    }
    destroy(target: {
      canvas: OffscreenCanvas | null;
      context: OffscreenCanvasRenderingContext2D | null;
    }) {
      if (target.canvas) target.canvas.width = target.canvas.height = 1;
      target.canvas = null;
      target.context = null;
    }
  }
  const loading = pdfjs.getDocument({
    data: bytes,
    worker: pdfWorker,
    CanvasFactory,
    disableFontFace: true,
    isEvalSupported: false,
    enableXfa: false,
    useWasm: false,
    useSystemFonts: true,
    maxImageSize: PIXEL_LIMIT,
    canvasMaxAreaInBytes: 64_000_000,
    stopAtErrors: true,
  });
  try {
    const document = await loading.promise;
    const page = await document.getPage(1);
    const size = page.getViewport({ scale: 1 });
    if (
      !Number.isFinite(size.width) ||
      !Number.isFinite(size.height) ||
      size.width <= 0 ||
      size.height <= 0 ||
      size.width * size.height > PIXEL_LIMIT
    )
      throw new Error('PIXEL_LIMIT');
    const viewport = page.getViewport({
        scale: Math.min(1, 1024 / size.width, 1024 / size.height),
      }),
      canvas = new OffscreenCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvas.getContext(
        '2d',
      ) as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    canvas.width = canvas.height = 1;
    page.cleanup();
    return blob;
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException')
      throw new Error('PDF_PASSWORD');
    throw error;
  } finally {
    await loading.destroy();
    pdfWorker.destroy();
    parser.terminate();
  }
}
async function model(bytes: Uint8Array, format: 'glb' | 'obj'): Promise<Blob> {
  const THREE = await import('three');
  let object: import('three').Object3D;
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (
      url.startsWith('blob:') ||
      /^data:(image\/(png|jpeg)|application\/octet-stream);base64,/.test(url)
    )
      return url;
    throw new Error('EXTERNAL_RESOURCE');
  });
  if (format === 'glb') {
    if (bytes.length < 20) throw new Error('INVALID_FILE');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== bytes.length ||
      view.getUint32(16, true) !== 0x4e4f534a
    )
      throw new Error('INVALID_FILE');
    const length = view.getUint32(12, true);
    if (length > 4 * 1024 * 1024 || length + 20 > bytes.length)
      throw new Error('MODEL_LIMIT');
    const binaryOffset = 20 + length;
    const binary =
      bytes.length >= binaryOffset + 8 &&
      view.getUint32(binaryOffset + 4, true) === 0x004e4942
        ? bytes.subarray(
            binaryOffset + 8,
            binaryOffset + 8 + view.getUint32(binaryOffset, true),
          )
        : undefined;
    validateModel(
      JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))),
      binary,
    );
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    object = (
      await new GLTFLoader(manager).parseAsync(bytes.buffer as ArrayBuffer, '')
    ).scene;
  } else {
    if (bytes.length > 16 * 1024 * 1024) throw new Error('SIZE_LIMIT');
    const text = new TextDecoder().decode(bytes);
    if (/^\s*(?:mtllib|map_\w+)\s/m.test(text))
      throw new Error('EXTERNAL_RESOURCE');
    let vertices = 0,
      faces = 0;
    for (const line of text.split('\n')) {
      if (/^v\s/.test(line)) vertices++;
      if (/^f\s/.test(line)) {
        faces++;
        if (line.trim().split(/\s+/).length > 33)
          throw new Error('MODEL_LIMIT');
      }
    }
    if (vertices > 250000 || faces > 250000) throw new Error('MODEL_LIMIT');
    if (!vertices || !faces) throw new Error('INVALID_FILE');
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    object = new OBJLoader(manager).parse(text);
    object.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const old = Array.isArray(node.material)
          ? node.material
          : [node.material];
        for (const m of old) m.dispose();
        node.material = new THREE.MeshStandardMaterial({
          color: '#e96938',
          roughness: 0.8,
        });
      }
    });
  }
  let renderedVertices = 0;
  object.traverse((node) => {
    if (node instanceof THREE.Mesh)
      renderedVertices +=
        (node.geometry.index?.count ??
          node.geometry.getAttribute('position')?.count ??
          0) * (node instanceof THREE.InstancedMesh ? node.count : 1);
  });
  if (renderedVertices > 750000) throw new Error('MODEL_LIMIT');
  let renderer: import('three').WebGLRenderer | undefined;
  try {
    const canvas = new OffscreenCanvas(512, 512);
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas as unknown as HTMLCanvasElement,
        antialias: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      throw new Error('WEBGL_UNAVAILABLE');
    }
    renderer.setSize(512, 512, false);
    renderer.setPixelRatio(1);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#252830');
    scene.add(object);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x454552, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(3, 5, 4);
    scene.add(light);
    const box = new THREE.Box3().setFromObject(object),
      sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0)
      throw new Error('INVALID_FILE');
    const camera = new THREE.PerspectiveCamera(
      40,
      1,
      sphere.radius / 100,
      sphere.radius * 100,
    );
    camera.position
      .copy(sphere.center)
      .add(
        new THREE.Vector3(2.5, 1.8, 3)
          .normalize()
          .multiplyScalar(sphere.radius * 3.5),
      );
    camera.lookAt(sphere.center);
    renderer.render(scene, camera);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    object.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material]) {
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) value.dispose();
          material.dispose();
        }
      }
    });
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}
self.onmessage = (
  event: MessageEvent<{ bytes: ArrayBuffer; format: RichFormat }>,
) => {
  const { bytes, format } = event.data;
  void (
    format === 'psd'
      ? psd(new Uint8Array(bytes))
      : format === 'pdf'
        ? pdf(new Uint8Array(bytes))
        : model(new Uint8Array(bytes), format as 'glb' | 'obj')
  ).then(
    (blob) => self.postMessage({ blob }),
    (error) =>
      self.postMessage({
        error: error instanceof Error ? error.message : 'RENDER_FAILED',
      }),
  );
};
