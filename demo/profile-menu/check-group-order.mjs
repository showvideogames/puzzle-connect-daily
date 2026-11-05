import {chromium} from '@playwright/test';import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 for(const width of [320,1440]) {
  await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5215/preferences.html');await page.getByRole('tab',{name:'Groups',exact:true}).click();
  const before=await page.getByTestId('group-row').allTextContents();
  await page.getByRole('button',{name:'Reorder groups',exact:true}).click();
  await page.getByRole('button',{name:'Move Book Club up',exact:true}).click();await page.getByRole('button',{name:'Move Book Club up',exact:true}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(await page.getByTestId('group-row').allTextContents(),before);
  await page.getByRole('button',{name:'Reorder groups',exact:true}).click();await page.getByRole('button',{name:'Move Book Club up',exact:true}).click();await page.getByRole('button',{name:'Move Book Club up',exact:true}).click();
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`evidence/group-order-${width}-${theme}.png`});}
  await page.getByRole('button',{name:'Save order',exact:true}).click();await page.getByRole('button',{name:'Reorder groups',exact:true}).waitFor();assert.match(await page.getByTestId('group-row').first().innerText(),/Book Club/);
  await page.getByRole('button',{name:'Switch account',exact:true}).click();await page.getByText('Preview account: Jordan').waitFor();await page.getByTestId('groups-tab').waitFor();assert.doesNotMatch(await page.getByTestId('group-row').first().innerText(),/Book Club/);
  await page.getByRole('button',{name:'Switch account',exact:true}).click();await page.getByText('Preview account: River').waitFor();await page.getByTestId('groups-tab').waitFor();assert.match(await page.getByTestId('group-row').first().innerText(),/Book Club/);
 }
 assert.deepEqual(errors,[]);console.log('PASS: private group order, cancel/save, account isolation, 320/1440 light/dark, no overflow or browser errors.');
}finally{await browser.close();}
