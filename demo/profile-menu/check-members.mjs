import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://127.0.0.1:5215/members.html');
    await page.getByText('Jordan', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'View members' }).click();
    assert.equal(await page.getByRole('button', { name: 'Remove River' }).count(), 0);
    await page.getByRole('button', { name: 'Remove Jordan' }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.getByText('Jordan', { exact: true }).count(), 1);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
      await page.waitForTimeout(200);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.screenshot({ path: `evidence/members-${width}-${theme}.png` });
    }
    await page.getByRole('button', { name: 'Remove Jordan' }).click();
    await page.getByRole('button', { name: 'Remove member', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Jordan was removed' }).waitFor();
    assert.equal(await page.getByText('Jordan', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByText('2 members', { exact: true }).waitFor();
    assert.equal(await page.getByText('Jordan', { exact: true }).count(), 0);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: clubhouse members at 320/1440 light/dark, no overflow, no self removal, cancel keeps member, confirmed removal updates roster, result rows and group count.');
} finally { await browser.close(); }
