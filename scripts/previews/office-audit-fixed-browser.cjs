const fs=require('node:fs'),assert=require('node:assert/strict');
const{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{const base='http://127.0.0.1:4215',f=await(await fetch(base+'/fixture')).json(),b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const checks=[],errors=[];try{
const c=await b.newContext({viewport:{width:390,height:844}});await c.addCookies([{name:'shamusho_session',value:f.office,url:base},...f.sessions.map(s=>({name:s.name,value:s.value,url:base+s.path}))]);const p=await c.newPage();p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
for(const width of [320,390,768,1440]){await p.setViewportSize({width,height:width>900?1000:844});
for(const path of ['/','/cast','/sticker-desk/new','/marketplace/new','/economy/casino-live','/casino/versus','/casino/tables/poker']){
await p.goto(base+path);await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,path+' '+width);
if(path==='/casino/versus'){assert.equal(await p.evaluate(()=>htmx.config.includeIndicatorStyles),false);assert.equal(await p.locator('head style').count(),0);}
if(path==='/cast'&&width<=768){const box=await p.locator('.topbar .hamburger').boundingBox();assert.ok(box.width>=44&&box.height>=44);assert.ok(await p.locator('.hamburger span').first().evaluate(e=>e.getBoundingClientRect().width>=20));}
checks.push({path,width});
}
if([390,1440].includes(width)){await p.goto(base+'/cast#cast-register');await p.waitForTimeout(250);await p.locator('#cast-register').evaluate(e=>window.scrollTo({top:window.scrollY+e.getBoundingClientRect().top-84,behavior:'instant'}));await p.waitForTimeout(100);await p.screenshot({path:`docs/previews/cast-register-start-${width}.webp`});}
}
assert.deepEqual(errors,[]);const result={checks,errors};fs.writeFileSync('/tmp/office-audit-fixed-report.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1)});
