import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import type {Db} from '../src/db/client.js';
import {addHorse,buyHorseAura,dressOwnHorse,myHorses} from '../src/services/casino/keibaStable.js';
import {KB_DEFAULT_OUTFIT} from '../src/services/casino/keibaOutfit.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {makeDb} from './helpers.js';
const A='760000000000000401', B='760000000000000402';
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb()); await addCoins(db,A,30000,'adjust');});
afterEach(async()=>{await close();});
const balance=async()=> (await walletOf(db,A)).balance;
const horse=async()=> (await myHorses(db,A))[0]!;
describe('馬のオーラショップ',()=>{
 it('固定色は馬ごとに3500銭。再送・再装備で二重課金せず、能力を変えない',async()=>{
  const h=(await addHorse(db,'オーラ',undefined,A))!;
  const results=await Promise.all([buyHorseAura(db,A,h.id,{key:'silver',revision:0}),buyHorseAura(db,A,h.id,{key:'silver',revision:0})]);
  expect(results.sort()).toEqual(['aura_stale','ok']); expect(await balance()).toBe(26500);
  const styled=await horse(); expect(styled.outfit.aura?.key).toBe('silver');
  expect([styled.spd,styled.sta,styled.coat,styled.starts,styled.wins]).toEqual([h.spd,h.sta,h.coat,h.starts,h.wins]);
  expect(await buyHorseAura(db,A,h.id,{key:'none',revision:1})).toBe('ok');
  expect(await buyHorseAura(db,A,h.id,{key:'silver',revision:2})).toBe('ok');
  expect(await balance()).toBe(26500);
  const second=(await addHorse(db,'別の馬',undefined,A))!;
  expect(await buyHorseAura(db,A,second.id,{key:'silver',revision:0})).toBe('ok');
  expect(await balance()).toBe(23000);
 });
 it('黄金は景品専用で、直接購入を送信しても銭と装備を変更しない',async()=>{
  const h=(await addHorse(db,'黄金は非売品',undefined,A))!;
  expect(await buyHorseAura(db,A,h.id,{key:'gold',revision:0})).toBe('invalid');
  expect(await balance()).toBe(30000);expect((await horse()).outfit).toEqual(KB_DEFAULT_OUTFIT);
 });
 it('カスタムは色変更ごと7000銭。同じ色の押し直しは無料',async()=>{
  const h=(await addHorse(db,'自由色',undefined,A))!;
  const color={key:'custom',body:'#123456',glow:'#aabbcc'};
  expect(await buyHorseAura(db,A,h.id,{...color,revision:0})).toBe('ok'); expect(await balance()).toBe(23000);
  expect(await buyHorseAura(db,A,h.id,{...color,revision:1})).toBe('ok'); expect(await balance()).toBe(23000);
  expect(await buyHorseAura(db,A,h.id,{...color,body:'#654321',revision:1})).toBe('ok'); expect(await balance()).toBe(16000);
  expect(await buyHorseAura(db,A,h.id,{...color,revision:2})).toBe('ok'); expect(await balance()).toBe(9000);
 });
 it('不正色・他人・残高不足は装備と銭を変えず、無料着せ替えから有料情報を注入できない',async()=>{
  const h=(await addHorse(db,'認可',undefined,A))!;
  expect(await buyHorseAura(db,B,h.id,{key:'silver',revision:0})).toBe('not_found');
  expect(await buyHorseAura(db,A,h.id,{key:'custom',body:'url(evil)',glow:'#ffffff',revision:0})).toBe('invalid');
  expect(await dressOwnHorse(db,A,h.id,{...KB_DEFAULT_OUTFIT,aura:{key:'custom',body:'#000000',glow:'#ffffff'},auraOwned:['silver']})).toBe('ok');
  expect((await horse()).outfit.aura).toBeUndefined(); expect((await horse()).outfit.auraOwned).toBeUndefined();
  await buyHorseAura(db,A,h.id,{key:'sakura',revision:0});
  await dressOwnHorse(db,A,h.id,{...KB_DEFAULT_OUTFIT,hood:'ears'});
  expect((await horse()).outfit.aura?.key).toBe('sakura');
  await db.transaction(async tx=>{const {spendWithin}=await import('../src/services/economy.js');await spendWithin(tx,A,26500,'adjust');});
  const saved=(await horse()).outfit;
  expect(await buyHorseAura(db,A,h.id,{key:'custom',body:'#112233',glow:'#445566',revision:1})).toBe('poor');
  expect((await horse()).outfit).toEqual(saved);expect(await balance()).toBe(0);
 });
});
