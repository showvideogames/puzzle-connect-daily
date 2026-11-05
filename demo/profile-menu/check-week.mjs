import {chromium} from '@playwright/test';import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 for(const timezoneId of ['America/Los_Angeles','Pacific/Auckland']){
  const page=await browser.newPage({timezoneId});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  for(const width of [320,1440]){
   await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5215/preferences.html?weekly=1');await page.getByRole('button',{name:/Jordan.*Profile/}).click();
   const week=page.getByRole('region',{name:"Last 7 days of activity"});await week.getByText('View details',{exact:true}).waitFor();
   assert.equal(await week.getByText('Upcoming',{exact:true}).count(),0);assert.equal(await week.getByText('No published puzzle',{exact:true}).count(),4);
   assert.equal(await week.getByText('Finish this same puzzle to see their details.',{exact:true}).count(),2);
   await week.getByText('View details',{exact:true}).click();await week.getByLabel('Guess 1: All yellow',{exact:true}).waitFor();
   for(const theme of ['light','dark']){
    await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(timezoneId==='America/Los_Angeles')await page.screenshot({path:`evidence/week-${width}-${theme}.png`,fullPage:true});
   }
   await page.getByRole('button',{name:'Switch account',exact:true}).click();assert.equal(await week.count(),0);
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: rolling last-seven-day activity, per-puzzle locks and unlock, missing/future days, account switch, LA/Auckland, 320/1440 light/dark.');
}finally{await browser.close();}
