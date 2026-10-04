import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

// Adobe BSD CMaps only. PDF.js fonts, profiles and WASM stay outside the build.
export function pdfCMapAssets(): Plugin {
  const packagePath = createRequire(import.meta.url).resolve(
    'pdfjs-dist/package.json',
  );
  const directory = join(dirname(packagePath), 'cmaps');
  async function resources() {
    const names = (await readdir(directory)).filter(
      (name) => name === 'LICENSE' || name.endsWith('.bcmap'),
    );
    return Promise.all(
      names.map(
        async (name) => [name, await readFile(join(directory, name))] as const,
      ),
    );
  }
  return {
    name: 'cura-local-pdf-cmaps',
    async generateBundle() {
      for (const [name, source] of await resources())
        this.emitFile({
          type: 'asset',
          fileName: `assets/pdf-cmaps/${name}`,
          source,
        });
    },
    async configureServer(server) {
      const files = new Map(await resources());
      server.middlewares.use('/assets/pdf-cmaps', (request, response, next) => {
        const name = request.url?.split('?')[0]?.slice(1) ?? '';
        const bytes = files.get(name);
        if (!bytes) return next();
        response.setHeader(
          'Content-Type',
          name === 'LICENSE'
            ? 'text/plain; charset=utf-8'
            : 'application/octet-stream',
        );
        response.end(bytes);
      });
    },
  };
}
