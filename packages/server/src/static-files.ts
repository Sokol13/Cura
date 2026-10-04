import { open, type FileHandle } from 'node:fs/promises';
import { extname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { resolveContained } from './media/path-utils.js';

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function registerStaticFiles(app: FastifyInstance, root: string): void {
  app.route<{ Params: { '*': string } }>({
    method: ['GET', 'HEAD'],
    url: '/*',
    async handler(request, reply) {
      const notFound = () =>
        request.method === 'HEAD'
          ? reply.code(404).send()
          : reply.callNotFound();
      // Fastify decodes route parameters once; never decode them a second time.
      let name = request.params['*'];
      if (!name || name.endsWith('/')) name += 'index.html';
      if (name.split(/[\\/]/).some((part) => part.startsWith('.')))
        return notFound();
      let file: FileHandle | undefined;
      try {
        const path = await resolveContained(root, name);
        file = await open(path, 'r');
        const info = await file.stat();
        if (!info.isFile()) {
          await file.close();
          return notFound();
        }
        const extension = extname(name).toLowerCase();
        const immutable =
          extension !== '.html' && /^assets\/.*-[\w-]{8,}\.[\w]+$/.test(name);
        reply
          .type(mimeTypes[extension] ?? 'application/octet-stream')
          .header('content-length', info.size)
          .header('x-content-type-options', 'nosniff')
          .header(
            'cache-control',
            immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
          );
        if (request.method === 'HEAD') {
          await file.close();
          return reply.send();
        }
        return reply.send(file.createReadStream());
      } catch {
        await file?.close();
        return notFound();
      }
    },
  });
}
