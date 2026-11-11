const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
const base='http://127.0.0.1:4215',fixture=await(await fetch(base+'/fixture')).json();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:390,height:844}});await ctx.addCookies([{name:'shamusho_session',value:fixture.office,url:base}]);
const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.goto(base+'/cast#cast-register');const form=page.locator('#cast-register');
await form.locator('[data-cast-search]').fill('同じ名前');assert.equal(await form.locator('[data-cast-member] option').count(),3);
await form.locator('[data-cast-member]').selectOption(fixture.USER);
await form.locator('[data-cast-search]').fill('該当しない人');assert.equal(await form.locator('[data-cast-member]').inputValue(),fixture.USER);assert.match(await form.locator('[data-cast-search-status]').innerText(),/該当する人がいません/);
assert.equal(await form.locator('[data-cast-custom]').isVisible(),false);
for(const item of await form.locator('[name=tpl]').all())await item.uncheck();await form.locator('button[type=submit]').click();assert.match(await form.locator('[data-cast-submit-status]').innerText(),/1つ以上/);
await form.locator('[name=useTemplate][value=no]').check();assert.equal(await form.locator('[data-cast-template]').isVisible(),false);
await form.locator('[name=menuName]').fill('お話し');await form.locator('[name=menuMinutes]').fill('30');await form.locator('[name=menuPrice]').fill('0');
await form.locator('.cast-profile').evaluate(e=>e.open=true);await form.locator('[name=bio]').fill('紹介を残したまま直せる');
await form.evaluate(f=>f.noValidate=true);
await Promise.all([page.waitForNavigation(),form.locator('button[type=submit]').click()]);
assert.equal(await form.locator('[name=bio]').inputValue(),'紹介を残したまま直せる');assert.equal(await form.locator('[name=menuPrice]').inputValue(),'0');assert.equal(await page.locator('#cast-registration-error').count(),1);
await page.waitForFunction(()=>document.activeElement.id==='cast-registration-error');
fs.mkdirSync('docs/previews',{recursive:true});await page.screenshot({path:'docs/previews/cast-register-error.webp'});
await form.locator('[name=menuPrice]').fill('300');
for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:width>900?1000:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);if([390,1440].includes(width)){await form.evaluate(f=>f.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:`docs/previews/cast-register-${width}.webp`});}}
await Promise.all([page.waitForNavigation(),form.locator('button[type=submit]').click()]);assert.match(page.url(),/msg=registered/);
// JavaScriptがなくても、本人IDとメニューを送って登録できる。
const nojs=await browser.newContext({javaScriptEnabled:false,reducedMotion:'reduce',viewport:{width:390,height:844}});await nojs.addCookies([{name:'shamusho_session',value:fixture.office,url:base}]);const p=await nojs.newPage();await p.goto(base+'/cast');const f=p.locator('#cast-register');assert.equal(await f.locator('[data-cast-search]').isVisible(),false);
await f.locator('[data-cast-member]').selectOption(fixture.OTHER);await f.locator('[name=useTemplate][value=no]').check();await f.locator('[name=menuName]').fill('JSなしの雑談');await f.locator('[name=menuMinutes]').fill('30');await f.locator('[name=menuPrice]').fill('300');await Promise.all([p.waitForNavigation(),f.locator('button[type=submit]').click()]);assert.match(p.url(),/msg=registered/);
assert.deepEqual(errors,[]);console.log(JSON.stringify({sameName:true,searchKeepsIdentity:true,modeSwitch:true,emptyTemplateBlocked:true,errorKeepsValues:true,errorFocused:true,noJavaScript:true,widths:[320,390,768,1440],errors}));
await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
