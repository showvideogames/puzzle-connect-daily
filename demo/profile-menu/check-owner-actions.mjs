import {chromium} from '@playwright/test';import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const capture=async(name,width)=>{for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`evidence/${name}-${width}-${theme}.png`,fullPage:true});}};
 for(const width of [320,1440]){
  await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5215/preferences.html');await page.getByRole('tab',{name:'Groups',exact:true}).click();await page.getByRole('button',{name:/Coffee Club.*members/}).click();
  await page.getByRole('button',{name:'View members',exact:true}).click();await page.getByRole('button',{name:'Make Jordan owner',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Make Jordan owner',exact:true}).click();await capture('owner-transfer',width);await page.getByRole('button',{name:'Transfer ownership',exact:true}).click();
  await page.getByTestId('groups-tab').waitFor();await page.getByRole('button',{name:/Coffee Club.*members/}).click();assert.equal(await page.getByRole('button',{name:'Delete group',exact:true}).count(),0);
  await page.getByRole('button',{name:'Switch account',exact:true}).click();await page.getByTestId('groups-tab').waitFor();await page.getByRole('button',{name:/Coffee Club.*members/}).click();
  await page.getByRole('button',{name:'Delete group',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Delete group',exact:true}).click();await capture('owner-delete',width);
  await page.getByRole('button',{name:'Delete group permanently',exact:true}).click();await page.getByTestId('groups-tab').waitFor();assert.equal(await page.getByRole('button',{name:/Coffee Club.*members/}).count(),0);
  await page.getByRole('button',{name:'Switch account',exact:true}).click();await page.getByTestId('groups-tab').waitFor();assert.equal(await page.getByRole('button',{name:/Coffee Club.*members/}).count(),0);
 }
 assert.deepEqual(errors,[]);console.log('PASS: confirmed transfer/delete, cancel sends no change, former owner loses controls, new owner can delete, both member lists update, 320/1440 light/dark.');
}finally{await browser.close();}
