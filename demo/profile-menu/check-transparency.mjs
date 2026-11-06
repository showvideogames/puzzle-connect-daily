import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
for (const width of [320,1440]) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('http://127.0.0.1:5215/group.html');
  await page.getByTestId('group-photo-input').setInputFiles({ name:'transparent.svg', mimeType:'image/svg+xml', buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048"><circle cx="1024" cy="1024" r="500" fill="red" fill-opacity=".5"/></svg>') });
  await page.getByRole('button', { name:'Adjust picture' }).click();
  await page.getByText('Transparent background kept.').waitFor();
  for (const theme of ['light','dark']) {
    await page.evaluate(dark => document.documentElement.classList.toggle('dark',dark), theme==='dark');
    await page.waitForTimeout(250);
    await page.screenshot({ path:`evidence/transparency-${width}-${theme}.png` });
  }
  await page.getByRole('button',{name:'Use picture'}).click();
  await page.getByRole('dialog').waitFor({state:'detached'});
  await page.getByRole('button',{name:'Save group',exact:true}).click();
  const img=page.getByTestId('saved-picture');
  const src=await img.getAttribute('src'); assert(src.startsWith('data:image/png;base64,'));
  assert(Buffer.from(src.split(',')[1],'base64').length<58000);
  const pixels=await img.evaluate(async img=>{ await img.decode();const c=document.createElement('canvas');c.width=256;c.height=256;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return [img.naturalWidth,img.naturalHeight,ctx.getImageData(0,0,1,1).data[3],ctx.getImageData(128,128,1,1).data[3]]; });
  assert.deepEqual(pixels.slice(0,3),[256,256,0]); assert(pixels[3]>=127&&pixels[3]<=128);
  writeFileSync('evidence/browser-transparent-photo.png',Buffer.from(src.split(',')[1],'base64'));
}
assert.deepEqual(errors,[]);
console.log('PASS: phone/desktop light/dark crop preview; actual saved PNG keeps zero-alpha corners and half-alpha center after 2048px resizing and crop.');
await browser.close();
