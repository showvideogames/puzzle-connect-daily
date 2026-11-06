import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
for (const width of [320, 390, 1440]) {
  await page.setViewportSize({ width, height: 850 });
  await page.goto('http://127.0.0.1:5215/');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
    const trigger = page.getByRole('button', { name: 'Profile menu, 2 pending notifications' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'My profile' }).waitFor();
    const bounds = await page.getByRole('menu').boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `evidence/menu-${width}-${theme}.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    assert(await trigger.evaluate(el => el === document.activeElement));
  }
}
for (const [name, message] of [['My profile', 'My profile selected'], ['Friends & Groups', 'Friends & Groups selected'], ['Account options', 'Account options selected']]) {
  await page.getByRole('button', { name: 'Profile menu, 2 pending notifications' }).click();
  await page.getByRole('menuitem', { name, exact: false }).click();
  assert.equal(await page.getByRole('status').textContent(), message);
}
for (const value of ['0', 'unknown']) {
  await page.getByLabel('Notifications', { exact: true }).selectOption(value);
  assert.equal(await page.getByTestId('profile-notification').count(), 0);
}
await page.getByLabel('Notifications', { exact: true }).selectOption('105');
await page.getByRole('button', { name: 'Profile menu, 105 pending notifications' }).click();
assert.equal(await page.getByLabel('105 pending notifications', { exact: true }).textContent(), '99+');
assert.deepEqual(errors, []);
console.log('PASS: 6 layout/theme combinations; keyboard opening, Escape/focus return; 3 actions; zero/unknown/105 notification states; no page errors.');
await browser.close();
