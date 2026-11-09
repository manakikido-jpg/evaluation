import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/web/public/casino.js',import.meta.url),'utf8');
it('カジノ共通の送信は専用リール画面へ重ねてPOSTせず、通常の購入フォームは処理する',async()=>{
 const text=source.slice(source.indexOf("document.addEventListener('submit', async"),source.indexOf("window.addEventListener('popstate'"));let handler:any,calls=0;
 class Form{constructor(public dedicated:boolean){}closest(){return this.dedicated?{}:null;}getAttribute(n:string){return n==='method'?'post':'/casino/god/buy';}}
 runInNewContext(text,{document:{addEventListener:(_n:string,fn:any)=>handler=fn},HTMLFormElement:Form,URL,location:{href:'https://example.test/casino/god',origin:'https://example.test'},window:{CasinoRequests:{submit:async()=>{calls++;}}},swapPage:()=>{}});
 let prevented=false;await handler({target:new Form(true),preventDefault:()=>prevented=true});expect(calls).toBe(0);expect(prevented).toBe(false);
 await handler({target:new Form(false),preventDefault:()=>prevented=true});expect(calls).toBe(1);expect(prevented).toBe(true);
});
it('体験開始の画面差し替えでは外部スクリプトを読み込むためにGETで画面を開く',()=>{
 const text=source.slice(source.indexOf('const swapPage ='),source.indexOf("document.addEventListener('submit', async"));let target='';
 const doc={querySelector:(q:string)=>q==='.c-main'||q==='[data-gaisen-trial]'?{}:null,body:{hasAttribute:()=>false}};
 runInNewContext(text+";swapPage('html','https://example.test/casino/god/play');",{DOMParser:class{parseFromString(){return doc;}},document:{querySelector:()=>null,body:{hasAttribute:()=>false}},location:{assign:(url:string)=>target=url}});
 expect(target).toBe('https://example.test/casino/god/play');
});
