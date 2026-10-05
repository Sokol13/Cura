import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from '../../../../packages/server/node_modules/sharp/lib/index.js';
const output = resolve(process.argv[2] ?? '.tmp/canvas-cdp-control');
await mkdir(output, { recursive: true });
const browser = await chromium.launch(
  process.env.CURA_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.CURA_CHROMIUM_EXECUTABLE }
    : { channel: 'chrome' },
);
const evidence = [];
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('CDP control exceeded 3000 ms')),
          3000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
try {
  for (const dpr of [1, 1.25]) {
    const context = await browser.newContext({
      viewport: { width: 1500, height: 1000 },
      deviceScaleFactor: dpr,
    });
    const page = await context.newPage();
    await page.setContent(
      '<style>body{margin:0;background:#fff}i{position:fixed;width:20px;height:20px}i:nth-child(1){left:0;top:0;background:red}i:nth-child(2){right:0;top:0;background:blue}i:nth-child(3){left:0;bottom:0;background:yellow}i:nth-child(4){right:0;bottom:0;background:lime}</style><i></i><i></i><i></i><i></i>',
    );
    const session = await context.newCDPSession(page);
    const sample = {
      dpr,
      viewport: await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      })),
      layout: await bounded(session.send('Page.getLayoutMetrics')),
      captures: [],
    };
    for (const mode of [
      'default-surface',
      'clip-device-pixels',
      'clip-css-pixels',
    ]) {
      const clip =
        mode === 'default-surface'
          ? {}
          : {
              clip: {
                x: 0,
                y: 0,
                width: 1500,
                height: 1000,
                scale: mode === 'clip-css-pixels' ? 1 / dpr : 1,
              },
            };
      const result = await bounded(
        session.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false,
          ...clip,
        }),
      );
      const bytes = Buffer.from(result.data, 'base64');
      const { data, info } = await sharp(bytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const point = (x, y) => [
        ...data.subarray(
          (y * info.width + x) * 4,
          (y * info.width + x) * 4 + 4,
        ),
      ];
      sample.captures.push({
        mode,
        width: info.width,
        height: info.height,
        corners: [
          point(2, 2),
          point(info.width - 3, 2),
          point(2, info.height - 3),
          point(info.width - 3, info.height - 3),
        ],
      });
      await writeFile(join(output, `control-dpr-${dpr}-${mode}.png`), bytes);
    }
    evidence.push(sample);
    await bounded(context.close());
  }
} finally {
  await bounded(browser.close());
}
await writeFile(
  join(output, 'cdp-dimensions.json'),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
