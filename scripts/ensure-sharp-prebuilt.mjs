import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../packages/server/package.json', import.meta.url),
);
// Sharp's platform-specific optional packages supply the native binaries.
// Never run its install script or fall back to a local compiler.
const sharp = require('sharp');
const buffer = await sharp({
  create: { width: 2, height: 2, channels: 3, background: '#f97316' },
})
  .png()
  .toBuffer();
const metadata = await sharp(buffer).metadata();
if (metadata.width !== 2 || metadata.height !== 2) {
  throw new Error('Sharp prebuilt image smoke check failed.');
}
console.log('sharp: prebuilt image processing verified (no compilation).');
