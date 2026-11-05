import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {DRAW_SIZE,ROLE_WEIGHTS,ROLES,SGG_GAMES} from '../src/services/casino/kiseki/rules.js';
import {lever,newKiseki,stop} from '../src/services/casino/kiseki/engine.js';
const evidence=JSON.parse(readFileSync(new URL('../docs/kiseki-source-check.json',import.meta.url),'utf8'));
it('保存済み公開資料の確率・PGG基本構成を守り、丸め誤差を確定役へ付け替えない',()=>{
 const facts=evidence.verifiedFromSavedHtml;
 for(const [role,value] of [['god',facts.godDenominator],['red',facts.redDenominator],['sp',facts.spDenominator]] as const){
  expect(ROLES[role].denominator).toBe(value);expect(Math.abs(ROLE_WEIGHTS.find(v=>v.role===role)!.weight/DRAW_SIZE-1/value)).toBeLessThanOrEqual(.5/DRAW_SIZE);
 }
 expect(ROLE_WEIGHTS.reduce((sum,value)=>sum+value.weight,0)).toBe(DRAW_SIZE);expect(SGG_GAMES).toEqual(facts.sggGames);
 const state=newKiseki();lever(state,n=>n-1,'god',true);for(const i of [0,1,2])stop(state,i,n=>n-1,19);
 expect(state.phase).toBe('pgg');expect(state.left).toBe(facts.pggGames);expect(state.stocks).toBe(facts.pggRemainingStocks);expect(state.lastPaid).toBe(150);
 expect(evidence.notClaimedVerified).toContain('実機の全リール配列と滑り制御表');expect(evidence.sources.find((source:any)=>source.url.endsWith('/4/')).latestFetch).toBe('HTTP403');
});
