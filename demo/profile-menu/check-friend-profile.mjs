import {chromium} from '@playwright/test';import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 for(const width of [320,1440]){
  await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5215/preferences.html');await page.getByRole('button',{name:/Jordan.*Profile/}).click();await page.getByTestId('friend-profile').waitFor();await page.getByTestId('result-locked').waitFor();assert.equal(await page.getByTestId('result-detail').count(),0);
  await page.getByRole('button',{name:'Favorite & nickname',exact:true}).click();await page.getByLabel('Favorite',{exact:true}).check();await page.getByLabel('Private nickname').fill('Best pal');await page.getByRole('button',{name:'Save preferences',exact:true}).click();await page.getByRole('heading',{name:'Best pal',exact:true}).waitFor();
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`evidence/friend-profile-${width}-${theme}.png`,fullPage:true});}
  await page.getByRole('button',{name:'Back',exact:true}).click();const strip=page.getByRole('region',{name:'Favorite friends'});assert.equal(await strip.getByText('You',{exact:true}).count(),0);await page.screenshot({path:`evidence/favorites-${width}-dark.png`,fullPage:true});await strip.getByRole('button',{name:"Open Best pal's profile",exact:true}).click();await page.getByRole('heading',{name:'Best pal',exact:true}).waitFor();
  await page.goto('http://127.0.0.1:5215/preferences.html?completed=1');await page.getByRole('button',{name:/Jordan.*Profile/}).click();await page.getByLabel('Guess 1: All yellow',{exact:true}).waitFor();assert.equal(await page.getByTestId('result-locked').count(),0);
 }
 assert.deepEqual(errors,[]);console.log('PASS: dedicated profile, nickname/favorite save, favorites strip excludes self, locked/unlocked same-puzzle details, 320/1440 light/dark.');
}finally{await browser.close();}
