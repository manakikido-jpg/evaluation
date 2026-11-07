import {it,expect} from 'vitest';
import {KisekiRoleTrail} from '../src/web/views/kisekiTrial.js';
import {newKiseki,lever,stop} from '../src/services/casino/kiseki/engine.js';
const last=(n:number)=>n-1;
it('未実施の空欄を保ち、直近5件を古い順で右側へ揃える',()=>{
 const empty=KisekiRoleTrail({trail:[]}).toString();expect((empty.match(/data-kt-trail-mark="empty"/g)||[])).toHaveLength(5);expect(empty).not.toContain('<img');
 const html=KisekiRoleTrail({trail:['red','god','white','blue','yellow','none']}).toString();
 expect([...html.matchAll(/data-kt-trail-mark="([^"]+)"/g)].map(m=>m[1])).toEqual(['god','white','blue','yellow','none']);
 expect((html.match(/data-kt-trail-latest="true"/g)||[])).toHaveLength(1);expect(html).toContain('白7（ガイアベル）');expect(html).not.toContain('symbol-red7.webp');
 const one=KisekiRoleTrail({trail:['blue']}).toString();expect((one.match(/data-kt-trail-mark="empty"/g)||[])).toHaveLength(4);expect(one).toContain('5枠目：青7');
});
it('回転開始・第1/第2停止では履歴を増やさず、第3停止の確定結果だけを表示する',()=>{
 const s=newKiseki();s.trail=['white','blue','blue'];const before=KisekiRoleTrail({trail:s.trail}).toString();
 lever(s,last,'blue');for(const i of [2,0]){stop(s,i,last);expect(KisekiRoleTrail({trail:s.trail}).toString()).toBe(before);}
 stop(s,1,last);expect(s.trail).toEqual(['white','blue','blue','blue']);expect((KisekiRoleTrail({trail:s.trail}).toString().match(/data-kt-trail-mark="blue"/g)||[])).toHaveLength(3);
 expect(()=>stop(s,1,last)).toThrow();expect(s.trail).toHaveLength(4);
});
