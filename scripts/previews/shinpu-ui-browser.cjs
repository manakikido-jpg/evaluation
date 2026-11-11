/** scripts/previews/shinpu-ui.mts を起動してから実行。実残高・Discordは使わない。 */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let activeBrowser;
(async()=>{
const base='http://127.0.0.1:4211',dir=require('node:path').resolve(__dirname,'../../docs/previews')+'/';
const browser=activeBrowser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1});
const {token}=await(await fetch(base+'/fixture/session')).json();
await context.addCookies([{name:'sakura_shinpu_test',value:token,url:base}]);
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.goto(base+'/casino/shinpu');await page.waitForSelector('#create');
await page.locator('#create').click();await page.locator('#start').waitFor({state:'visible'});await page.locator('#start').click();await page.locator('#hand .card').first().waitFor();await page.waitForFunction(()=>Array.from(document.querySelectorAll('#hand img')).every(x=>x.complete&&x.naturalWidth>0));
await page.screenshot({path:dir+'shinpu-art-desktop.webp',type:'webp',fullPage:true});
await page.locator('#hand .card.attack').first().click();await page.waitForFunction(()=>[...document.querySelectorAll('#selected-cards img')].every(x=>x.complete&&x.naturalWidth>0));await page.screenshot({path:dir+'shinpu-art-selection.webp',type:'webp',fullPage:true});
await page.locator('#hand .card-detail-button').first().click();await page.locator('#card-detail-image').evaluate(x=>x.decode());await page.screenshot({path:dir+'shinpu-art-detail.webp',type:'webp'});await page.locator('#card-detail [data-close]').click();
await page.locator('#clear-selection').click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:dir+'shinpu-art-mobile.webp',type:'webp',fullPage:true});
await page.locator('#hand').scrollIntoViewIfNeeded();await page.screenshot({path:dir+'shinpu-art-mobile-hand.webp',type:'webp'});
const report=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,phase:document.getElementById('phase').innerText,hand:document.querySelectorAll('#hand .card').length,missingImages:[...document.images].filter(x=>!x.complete||!x.naturalWidth).length}));

if(report.width!==report.viewport||errors.length)throw Error(JSON.stringify({report,errors}));
await page.setViewportSize({width:1440,height:960});await page.locator('#hand .card.attack').first().focus();await page.keyboard.press('Enter');if(await page.locator('#hand .card.attack').first().getAttribute('aria-pressed')!=='true')throw Error('keyboard select');if(!await page.locator('#hand .card.attack').first().evaluate(x=>x===document.activeElement))throw Error('lost keyboard focus');
const reject=async route=>{const req=route.request();if(req.method()==='POST'&&req.postDataJSON().operation==='move')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'確認用の拒否'})});return route.continue();};
await page.route('**/casino/shinpu/api',reject);await page.locator('#main-action').click();await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('確認用の拒否'));if(await page.locator('#card-play').isVisible())throw Error('played rejected card');await page.unroute('**/casino/shinpu/api',reject);
await page.locator('#main-action').click();await page.locator('#card-play').waitFor({state:'visible'});await page.locator('#card-play').evaluate(x=>x.getAnimations().forEach(a=>{a.pause();a.currentTime=500;}));await page.screenshot({path:dir+'shinpu-art-play.webp',type:'webp'});await page.locator('#card-play').waitFor({state:'hidden'});
await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>showPlayedCards(state.pending.cards,'確認用の札'));if(await page.locator('#card-play').evaluate(x=>getComputedStyle(x).animationName)!=='none')throw Error('reduced motion');await page.locator('#card-play').waitFor({state:'hidden'});
console.log(JSON.stringify({report,errors,keyboard:true,rejectedPlaySuppressed:true,acceptedPlay:true,reducedMotion:true}));await page.locator('#leave').click();await page.waitForSelector('#lobby:not([hidden])');await browser.close();
})().catch(async e=>{await activeBrowser?.close();console.error(e);process.exit(1)});
