const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
const base='http://127.0.0.1:4215',fixture=await(await fetch(base+'/fixture')).json();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:390,height:844}});
await ctx.addCookies([{name:'shamusho_session',value:fixture.office,url:base},...fixture.sessions.map(s=>({name:s.name,value:s.value,url:base+s.path}))]);
const page=await ctx.newPage();const exceptions=[],consoleErrors=[],failedRequests=[];page.on('pageerror',e=>exceptions.push(String(e)));page.on('console',m=>{if(m.type()==='error')consoleErrors.push({path:new URL(page.url()).pathname,text:m.text()});});page.on('requestfailed',r=>failedRequests.push({url:r.url().replace(base,''),reason:r.failure()?.errorText}));
await page.goto(base+'/cast');await page.waitForTimeout(200);
const out={screens:[],routes:[],registeredRoutes:fixture.routes,exceptions,consoleErrors,failedRequests};
// Enumerate every registered GET endpoint, then also follow screen links for detail pages.
const ignore=/\/(?:static|auth|logout|fixture|service-worker|manifest|office-icon)|\.(?:json|csv|zip)$|\/image$|\/photo$|\/api(?:\/|$)|\/state$/;
const candidates=new Set([...fixture.routes.filter(p=>!p.includes(':')&&!ignore.test(p)),...fixture.previewPaths]);
for(const a of await page.locator('a[href]').evaluateAll(els=>els.map(a=>a.getAttribute('href'))))if(a?.startsWith('/')&&!a.startsWith('//')&&!a.includes('#')&&!ignore.test(a))candidates.add(a);
candidates.add('/members/'+fixture.USER);candidates.add('/economy/members/'+fixture.USER);candidates.add('/cast-office');candidates.add('/roles/100000000000000006');candidates.add('/channels/780000000000000001');
for(const kind of ['fortune','moneywheel','craps','duckrace','crash','plinko','penguin','keno','videopoker','tower','mines'])candidates.add('/casino/arcade/'+kind);
for(const kind of ['bj_table','baccarat_table','roulette_table','chinchiro_table','poker','daifugo','babanuki','mahjong','keiba','life'])candidates.add('/casino/tables/'+kind);
if(process.env.OFFICE_AUDIT_PATHS){candidates.clear();for(const p of process.env.OFFICE_AUDIT_PATHS.split(','))candidates.add(p);}
for(const path of candidates){
 console.log("checking",path);
 const response=await ctx.request.get(base+path);const type=response.headers()['content-type']||'';
 out.routes.push({path,finalPath:response.url().replace(base,''),status:response.status(),html:type.includes('text/html')});
 if(response.status()!==200||!type.includes('text/html'))continue;
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:width>900?1000:844});
  await page.goto(base+path,{waitUntil:'load'});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);
  const check=await page.evaluate(()=>({title:document.title,overflow:document.documentElement.scrollWidth>innerWidth+2,scrollWidth:document.documentElement.scrollWidth,offenders:Array.from(document.querySelectorAll('main *')).filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+2&&!e.closest('.admin-table-scroll,.table-wrap,.table-scroll,.table-overflow,[hidden],.org-stage')&&getComputedStyle(e).position!=='fixed';}).slice(0,6).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,65)}))}));
  out.screens.push({path,finalPath:page.url().replace(base,''),width,...check});
  fs.writeFileSync(process.env.OFFICE_AUDIT_REPORT||'/tmp/office-audit-report.json',JSON.stringify(out,null,2));
 }
}
fs.writeFileSync(process.env.OFFICE_AUDIT_REPORT||'/tmp/office-audit-report.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({routes:out.routes.length,screens:out.screens.length,failures:out.routes.filter(r=>r.status>=500),overflow:out.screens.filter(s=>s.overflow),exceptions,consoleErrors,failedRequests},null,2));
await browser.close();
if(out.screens.some(s=>s.overflow)||out.routes.some(r=>r.status>=500)||exceptions.length||consoleErrors.length||failedRequests.some(r=>r.reason!=='net::ERR_ABORTED'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
