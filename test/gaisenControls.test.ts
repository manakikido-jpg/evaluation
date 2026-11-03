import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/web/public/gaisen-trial.js',import.meta.url),'utf8');
function fixture(){
 const handlers=new Map<string,Function[]>(),clicked:string[]=[];
 let dialog=false,hidden=false;
 const buttons=Object.fromEntries(['lever','stop-0','stop-1','stop-2'].map(key=>[key,{disabled:false,click:()=>clicked.push(key)}]));
 const control={value:'',textContent:'',setAttribute(){}};
 const root={dataset:{},style:{setProperty(){}},querySelectorAll:()=>[],querySelector:(selector:string)=>selector==='.gt-machine'?{}:selector.startsWith('[data-gt-key=')?buttons[selector.match(/"([^"]+)"/)![1]!]:control};
 const document={get hidden(){return hidden;},querySelector:(s:string)=>s==='[data-gaisen-trial]'?root:s==='dialog[open]'&&dialog?{}:null,addEventListener:(name:string,fn:Function)=>handlers.set(name,[...(handlers.get(name)||[]),fn])};
 runInNewContext(source,{window:{addEventListener(){}},document,localStorage:{getItem:()=>null},performance:{now:()=>1000},cancelAnimationFrame(){},matchMedia:()=>({matches:false,addEventListener(){}})});
 function key(key:string,extras:Record<string,unknown>={}){let prevented=false;const e={key,code:key===' '?'Space':'Digit'+key,target:{closest:()=>null},preventDefault:()=>{prevented=true;},...extras};for(const fn of handlers.get('keydown')||[])fn(e);return prevented;}
 return {clicked,buttons,key,dialog:(v:boolean)=>{dialog=v;},hide:()=>{hidden=true;}};
}
describe('新台のキー操作',()=>{
 it('Spaceと1/2/3を現在の操作ボタンへ渡し、長押しや無効な位置では送らない',()=>{
  const f=fixture();for(const value of [' ','1','2','3'])expect(f.key(value)).toBe(true);
  expect(f.clicked).toEqual(['lever','stop-0','stop-1','stop-2']);
  f.key('1',{repeat:true});f.buttons['stop-1']!.disabled=true;f.key('2');expect(f.clicked).toHaveLength(4);
 });
 it('入力/別ボタン/変換中/修飾キー/ダイアログ/非表示でゲーム操作を起こさない',()=>{
  const f=fixture();
  for(const selector of ['input','select','textarea','a','summary','button','[contenteditable]:not([contenteditable="false"])','[role="textbox"]']){
   const target={closest:(query:string)=>query.split(',').includes(selector)?{}:null};expect(f.key('1',{target})).toBe(false);
  }
  for(const field of ['isComposing','ctrlKey','metaKey','altKey','shiftKey'])expect(f.key('1',{[field]:true})).toBe(false);
  f.dialog(true);expect(f.key('1')).toBe(false);f.dialog(false);f.hide();expect(f.key('1')).toBe(false);expect(f.clicked).toHaveLength(0);
 });
 it('操作ボタンに焦点があってもSpaceを二重に発火させず、ほかのキーは奪わない',()=>{
  const f=fixture(),button={};const target={closest:(query:string)=>query==='button'||query==='[data-gt-key]'?button:null};
  expect(f.key(' ',{target})).toBe(true);expect(f.clicked).toEqual(['lever']);expect(f.key('ArrowDown')).toBe(false);expect(f.key('4')).toBe(false);
 });
});
