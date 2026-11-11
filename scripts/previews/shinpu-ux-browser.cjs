/** ローカルfixture専用。上限なしの両替/回復と固定操作を、実API・2人戦で確認。 */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const path=require('node:path');
let browser;
(async()=>{
  const base='http://127.0.0.1:4211',out=path.resolve(__dirname,'../../docs/previews');
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const pages=[],errors=[];
  for(const suffix of ['','-other']){
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const {token,now}=await(await fetch(base+'/fixture/session'+suffix)).json();
    await context.addCookies([{name:'sakura_shinpu_test',value:token,url:base}]);
    await context.addInitScript(n=>{Date.now=()=>n;},now);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(base+'/casino/shinpu');pages.push(page);
  }
  const [a,b]=pages;
  await a.locator('#count').selectOption('2');await a.locator('#create').click();
  await a.locator('#start').waitFor({state:'visible'});await b.goto(await a.locator('#invite').inputValue());
  await b.locator('#waiting').waitFor({state:'visible'});
  await a.waitForFunction(()=>document.getElementById('waiting-seats').textContent.includes('2 / 2'));
  await a.locator('#start').click();await a.locator('#hand .card').first().waitFor();
  if(await a.locator('#players .player').count()!==1)throw Error('own resources duplicated above opponents');
  async function turn(p){await p.waitForFunction(()=>document.getElementById('phase').textContent.includes('あなたの攻撃ターン'));}
  async function passOther(){await turn(b);await b.locator('#more-actions summary').click();await b.locator('#pass').click();await turn(a);}
  async function exchange(kind){
    await a.locator('#more-actions summary').click();await a.locator('#exchange-open').click();
    await a.locator(`[data-exchange="${kind}"]`).click();await passOther();
  }
  await a.locator('#hand .card.heal').click();
  if(!(await a.locator('#action-context').innerText()).includes('消費MP 0'))throw Error('cost confirmation');
  await a.locator('#main-action').click();await a.waitForFunction(()=>document.querySelector('#self-resources .hp strong').textContent==='72');
  if(!(await a.locator('#battle-result').innerText()).includes('HP＋12'))throw Error('actual healing result');await passOther();
  for(let i=0;i<4;i++)await exchange('coin');
  const summon=a.locator('#hand .card.summon');
  if(!await summon.isDisabled())throw Error('unaffordable card is selectable');
  const reason=await summon.getAttribute('aria-describedby');
  if(!(await a.locator('#'+reason).innerText()).includes('MPがあと3必要'))throw Error('missing reason');
  await summon.locator('..').locator('.card-detail-button').click();
  await a.locator('#card-detail').waitFor({state:'visible'});
  if(!(await a.locator('#card-detail-text').innerText()).includes('MP 3'))throw Error('disabled card details');
  await a.locator('#card-detail [data-close]').click();
  for(let i=0;i<6;i++)await exchange('mp');
  if(await a.locator('#self-resources .mp strong').innerText()!=='24')throw Error('MP exchange capped');
  await a.locator('#hand .card.mana').first().click();await a.locator('#main-action').click();
  await a.waitForFunction(()=>document.querySelector('#self-resources .mp strong').textContent==='30');
  if(!(await a.locator('#battle-result').innerText()).includes('MP＋6'))throw Error('MP recovery result');await passOther();
  for(const width of [320,390,768,950,1440]){
    await a.setViewportSize({width,height:844});
    for(const location of ['top','bottom']){
      await a.evaluate(pos=>window.scrollTo(0,pos==='top'?0:document.documentElement.scrollHeight),location);
      await a.waitForTimeout(80);
      const ok=await a.locator('#main-action').evaluate(x=>{const r=x.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&!!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#main-action');});
      if(!ok)throw Error('fixed action obscured: '+width+'/'+location);
    }
    if(!await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw Error('page overflow '+width);
  }
  await a.setViewportSize({width:390,height:844});await a.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  const hand=await a.locator('#hand').boundingBox(),dock=await a.locator('#command-dock').boundingBox();
  if(hand.y+hand.height>dock.y)throw Error('last cards hidden under dock');
  await a.screenshot({path:path.join(out,'shinpu-ux-unlimited-mobile.webp'),type:'webp'});
  console.log(JSON.stringify({hp:72,mp:30,disabledReason:true,disabledDetails:true,resourceResults:true,fixedDockWidths:[320,390,768,950,1440],overlap:0,errors}));
  if(errors.length)throw Error(JSON.stringify(errors));
  await a.locator('#leave').click();await b.locator('#leave').click();await browser.close();
})().catch(async e=>{await browser?.close();console.error(e);process.exit(1);});
