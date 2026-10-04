import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CURA_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.CURA_CHROMIUM_EXECUTABLE }
    : { channel: 'chrome' }),
});
try {
  const page = await browser.newPage();
  await page.setContent(
    '<title>Cura setup check</title><h1>Chromium ready</h1>',
  );
  if ((await page.title()) !== 'Cura setup check') {
    throw new Error('Chromium rendered an unexpected document');
  }
  const h264 = await page.evaluate(() =>
    document
      .createElement('video')
      .canPlayType('video/mp4; codecs="avc1.42E01E"'),
  );
  if (!h264) {
    throw new Error(
      'The selected browser lacks H.264. Install the Chrome channel or explicitly provision a Chromium build with H.264 for video acceptance.',
    );
  }
  console.log(
    `Headless Chromium launch/rendering verified (${browser.version()}); H.264 capability reported. Actual video pixels are checked by E2E.`,
  );
} finally {
  await browser.close();
}
