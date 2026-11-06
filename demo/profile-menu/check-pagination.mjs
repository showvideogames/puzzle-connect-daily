import {chromium} from '@playwright/test';import assert from 'node:assert/strict';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{const p=await b.newPage({viewport:{width:390,height:844},hasTouch:true});const errors=[];p.on('pageerror',e=>errors.push(String(e)));await p.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
await p.goto('http://127.0.0.1:5215/preferences.html?standings=1&large=1');await p.getByRole('tab',{name:'Groups',exact:true}).click();await p.getByRole('button',{name:/Coffee Club 1000 members/}).click();const board=p.getByRole('region',{name:'CrossPuns standings'});await board.getByRole('button',{name:'See all (1000)',exact:true}).tap();
const labels=[];
for(let page=1;page<=40;page++){
 await board.getByText(`Page ${page} of 40 · ${(page-1)*25+1}–${page*25} of 1000`,{exact:true}).waitFor();
 assert.equal(await board.getByTestId('standing-row').count(),25);
 labels.push(...await board.getByTestId('standing-row').allTextContents());
 const hidden=board.getByTestId('standing-row').filter({hasText:'This player is blocked'});assert.equal(await hidden.locator('img').count(),0);
 if(page<40){await board.getByRole('button',{name:'Next',exact:true}).focus();await p.keyboard.press('Enter');}
}
assert.equal(new Set(labels).size,1000);assert.equal(await board.getByRole('button',{name:'Next',exact:true}).count(),0);
await board.getByRole('button',{name:'Previous',exact:true}).tap();await board.getByText('Page 39 of 40 · 951–975 of 1000',{exact:true}).waitFor();
await board.getByLabel('Period',{exact:true}).selectOption('7');await board.getByText('Page 1 of 40 · 1–25 of 1000',{exact:true}).waitFor();assert.equal(await board.getByRole('button',{name:'Previous',exact:true}).count(),0);
for(const width of [320,1440]){await p.setViewportSize({width,height:1000});for(const dark of [false,true]){await p.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await board.screenshot({path:`/tmp/rainbow-pages-${width}-${dark?'dark':'light'}.png`,animations:'disabled'});}}
await board.getByRole('button',{name:'Show less',exact:true}).click();assert.equal(await board.getByTestId('standing-row').count(),3);assert.deepEqual(errors,[]);
console.log('PASS: 1000 synthetic members over 40 pages, 25 per page, unique coverage, keyboard Next, touch Previous, period reset, blocked avatar privacy, collapse, mobile/desktop light/dark.');
}finally{await b.close();}
