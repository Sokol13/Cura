import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CURA_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.CURA_CHROMIUM_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage();
  await page.setContent(
    '<title>Cura setup check</title><h1>Chromium ready</h1>',
  );
  if ((await page.title()) !== 'Cura setup check') {
    throw new Error('Chromium rendered an unexpected document');
  }
  console.log('Headless Chromium launch and rendering verified.');
} finally {
  await browser.close();
}
