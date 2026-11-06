import {chromium} from '@playwright/test';import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 for(const width of [320,1440]){
  await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5215/preferences.html?standings=1');
  await page.getByRole('tab',{name:'Groups',exact:true}).click();await page.getByRole('button',{name:/Coffee Club/}).click();
  const board=page.getByRole('region',{name:'CrossPuns standings'});await board.getByText('This player is blocked',{exact:true}).waitFor();
  assert.equal(await board.getByText('Jordan',{exact:true}).count(),0);assert.equal(await board.getByText('River',{exact:true}).count(),1);
  const masked=board.getByTestId('standing-row').filter({hasText:'This player is blocked'});assert.equal((await masked.textContent()).trim(),'1This player is blocked');assert.equal(await masked.getByRole('link').count(),0);assert.equal(await masked.locator('img').count(),0);
  assert.equal(await board.locator('img').count(),2);assert.equal(await board.getByTestId('standing-row').count(),3);
  assert.equal(await board.getByText(/points for first|publication date|earlier results/).count(),0);
  await board.getByRole('button',{name:/See all/}).click();assert.equal(await board.getByTestId('standing-row').count(),5);
  await board.getByRole('button',{name:'Show less'}).click();assert.equal(await board.getByTestId('standing-row').count(),3);
  assert.equal(await board.getByLabel('Rank 1',{exact:true}).count(),2);
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`evidence/standings-${width}-${theme}.png`,fullPage:true});}
  for(const days of [7,30,365]){
   await board.getByLabel('Period',{exact:true}).selectOption(String(days));await board.getByText('3 pts',{exact:true}).waitFor();assert.equal(await board.getByLabel('Rank 1',{exact:true}).count(),2);assert.equal(await board.getByText('Jordan',{exact:true}).count(),0);
   if(days===7)for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`evidence/standings-period-${width}-${theme}.png`,fullPage:true});}
  }
  await page.getByRole('button',{name:'Switch account',exact:true}).click();assert.equal(await board.count(),0);
  await page.getByRole('tab',{name:'Groups',exact:true}).click();await page.getByRole('button',{name:/Coffee Club/}).click();await board.getByText('This player is blocked',{exact:true}).waitFor();assert.equal(await board.getByText('River',{exact:true}).count(),0);assert.equal(await board.getByText('Jordan',{exact:true}).count(),1);
 }
 assert.deepEqual(errors,[]);console.log('PASS: all-time and 7/30/365-day publication periods, canonical ties, masked rows in either block direction, account switching, 320/1440 light/dark, no overflow/errors.');
}finally{await browser.close();}
