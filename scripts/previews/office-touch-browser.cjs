const assert=require('node:assert/strict');
const{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{const base='http://127.0.0.1:4215',f=await(await fetch(base+'/fixture')).json(),b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const checked=[],errors=[];try{
for(const width of [320,390]){
const c=await b.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});await c.addCookies([{name:'shamusho_session',value:f.office,url:base},...f.sessions.map(s=>({name:s.name,value:s.value,url:base+s.path}))]);const p=await c.newPage();p.on('pageerror',e=>errors.push(String(e)));
for(const path of ['/','/cast','/members','/sticker-desk/new','/cast-office','/marketplace/new','/casino/pinball','/casino/arcade/plinko']){
await p.goto(base+path);await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,path+' '+width);
for(const item of await p.locator('.mobile-nav > *').all()){const box=await item.boundingBox();assert.ok(box.height>=44);assert.ok(box.x>=0&&box.x+box.width<=width);}
checked.push({path,width});
if(path==='/cast'){await p.locator('#cast-register [data-cast-search]').tap();await p.locator('#cast-register [data-cast-search]').fill('同じ名前');assert.ok((await p.locator('#cast-register [data-cast-member] option').count())>=3);}
}
await p.goto(base+'/');const toggle=p.locator('button[data-nav-toggle]').last();await toggle.tap();await p.waitForFunction(()=>document.body.classList.contains('nav-is-open'));await p.locator('[data-nav-close]').tap();assert.equal(await p.evaluate(()=>document.body.classList.contains('nav-is-open')),false);await c.close();
}
assert.deepEqual(errors,[]);console.log(JSON.stringify({touch:true,checked,errors}));
}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1)});
