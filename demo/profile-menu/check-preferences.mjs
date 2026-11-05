import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 for(const width of [320,1440]) {
  await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5215/preferences.html');
  await page.getByRole('button',{name:/Jordan.*Details/}).click();await page.getByRole('button',{name:'Favorite & nickname',exact:true}).click();
  await page.getByLabel('Private nickname').fill('Best pal');await page.getByLabel('Favorite',{exact:true}).check();
  for(const theme of ['light','dark']) {await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`evidence/preferences-${width}-${theme}.png`});}
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  await page.getByRole('button',{name:'Favorite & nickname',exact:true}).waitFor();
  assert.match(await page.getByTestId('result-row').first().innerText(),/Best pal/);
  assert.equal(await page.getByText('★ Favorite',{exact:true}).count(),1);
  await page.getByRole('button',{name:'Switch account',exact:true}).click();await page.getByText('Preview account: Jordan').waitFor();
  await page.getByTestId('friends-home').waitFor();assert.equal(await page.getByText('Best pal',{exact:true}).count(),0);assert.equal(await page.getByText('★ Favorite',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Switch account',exact:true}).click();await page.getByTestId('friends-home').waitFor();await page.getByText('Best pal',{exact:true}).waitFor();
 }
 assert.deepEqual(errors,[]);console.log('PASS: private nickname/favorite save, favorites first, account isolation, small/large light/dark, no overflow or browser errors.');
} finally {await browser.close();}
