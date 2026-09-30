const { chromium } = require('playwright');

const CASES = [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true },
];

async function readCanvasPixels(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const width = canvas.width;
    const height = canvas.height;
    const pixels = new Uint8Array(width * height * 4);

    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let nonBackground = 0;
    let bright = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];

      if (
        alpha > 0 &&
        (Math.abs(red - 23) > 4 ||
          Math.abs(green - 32) > 4 ||
          Math.abs(blue - 41) > 4)
      ) {
        nonBackground += 1;
      }

      if (red + green + blue > 120) {
        bright += 1;
      }
    }

    return {
      width,
      height,
      nonBackground,
      bright,
      ratio: nonBackground / (width * height),
    };
  });
}

async function main() {
  const browser = await chromium.launch({
    args: ['--disable-gpu', '--disable-dev-shm-usage'],
  });

  for (const testCase of CASES) {
    const page = await browser.newPage({
      viewport: testCase.viewport,
      isMobile: Boolean(testCase.isMobile),
    });

    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    const hasCanvas = await page.evaluate(() => Boolean(document.querySelector('canvas')));

    if (!hasCanvas) {
      const bodyLength = await page.evaluate(() => document.body.innerHTML.length);
      throw new Error(`canvas was not created; body length: ${bodyLength}`);
    }

    try {
      await page.screenshot({
        path: `artifacts/chunk-${testCase.name}.png`,
        fullPage: false,
        timeout: 15000,
      });
    } catch (error) {
      console.warn(`${testCase.name}: screenshot skipped: ${error.message}`);
    }

    const result = await readCanvasPixels(page);
    console.log(`${testCase.name}: ${JSON.stringify(result)}`);
    await page.close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
