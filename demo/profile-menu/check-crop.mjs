import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
const file = { name: 'wide-test.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="2000"><rect width="2000" height="2000" fill="red"/><rect x="2000" width="2000" height="2000" fill="lime"/></svg>') };
async function range(name, value) { await page.getByRole('slider', { name, exact: true }).fill(String(value)); }
for (const width of [320, 1440]) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('http://127.0.0.1:5215/group.html');
  await page.getByTestId('group-photo-input').setInputFiles(file);
  await page.getByRole('button', { name: 'Adjust picture' }).click();
  await page.getByRole('button', { name: 'Use picture' }).waitFor();
  await range('Zoom', 2);
  await range('Horizontal position', 1);
  const preview = page.getByTestId('group-crop-preview');
  const box = await preview.boundingBox();
  assert(box.x >= 0 && box.x + box.width <= width);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `evidence/crop-${width}-${theme}.png` });
  }
  // Real drag moves the chosen source area, then keyboard sets a predictable final crop.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .8, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  assert(Number(await page.getByRole('slider', { name: 'Horizontal position', exact: true }).inputValue()) < 1);
  await range('Horizontal position', 1);
  await page.getByRole('button', { name: 'Use picture' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Save group', exact: true }).click();
  const saved = await page.getByTestId('saved-picture').getAttribute('src');
  assert(saved.startsWith('data:image/jpeg;base64,'));
  assert(Buffer.from(saved.split(',')[1], 'base64').length < 58000);
  const sample = await page.getByTestId('saved-picture').evaluate(async img => {
    await img.decode(); const c = document.createElement('canvas'); c.width=256; c.height=256;
    const ctx=c.getContext('2d'); ctx.drawImage(img,0,0); return { width:img.naturalWidth, height:img.naturalHeight, pixel:Array.from(ctx.getImageData(128,128,1,1).data) };
  });
  assert.equal(sample.width, 256); assert.equal(sample.height, 256);
  assert(sample.pixel[1] > 240 && sample.pixel[0] < 15, JSON.stringify(sample));
  await page.getByRole('button', { name: 'Adjust picture' }).click();
  await range('Horizontal position', 0);
  await page.getByRole('button', { name: 'Cancel crop' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Save group', exact: true }).click();
  assert.equal(await page.getByTestId('saved-picture').getAttribute('src'), saved);
}
assert.deepEqual(errors, []);
console.log('PASS: crop drag and sliders, phone/desktop light/dark, 4000px input resized to 256px JPEG under 58KB, output pixels match selected right half, cancellation preserves saved picture.');
await browser.close();
