import {chromium} from '@playwright/test';import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 for(const width of [320,1440]){
  await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5215/preferences.html');await page.getByRole('tab',{name:'Groups',exact:true}).click();await page.getByRole('button',{name:/Coffee Club.*members/}).click();
  await page.getByRole('button',{name:'Edit description',exact:true}).click();await page.getByLabel('Group description',{exact:true}).fill('Our cozy puzzle clubhouse.\nBring a coffee and play at your own pace.');
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`evidence/description-${width}-${theme}.png`});}
  await page.getByRole('button',{name:'Save description',exact:true}).click();await page.getByTestId('group-description').waitFor();assert.match(await page.getByTestId('group-description').innerText(),/Our cozy puzzle clubhouse/);
  await page.getByRole('button',{name:'Edit description',exact:true}).click();await page.getByLabel('Group description',{exact:true}).fill('Unsaved');await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.doesNotMatch(await page.getByTestId('group-description').innerText(),/Unsaved/);
  await page.getByRole('button',{name:'Switch account',exact:true}).click();await page.getByTestId('groups-tab').waitFor();await page.getByRole('button',{name:/Coffee Club.*members/}).click();await page.getByTestId('group-description').waitFor();assert.equal(await page.getByRole('button',{name:'Edit description',exact:true}).count(),0);
 }
 assert.deepEqual(errors,[]);console.log('PASS: owner description save/cancel, member read with no editor, 320/1440 light/dark, no overflow/errors.');
}finally{await browser.close();}
