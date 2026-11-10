import type {GuildConfig} from '../config.js';
import {activeCoreTime,describeCoreTime} from './coreTime.js';

/** 宿代だけの倍率。通話報酬やキャストの倍率とは別。 */
export const roomRateAt=(cfg:GuildConfig,now:Date)=>activeCoreTime(cfg.coreTime,now)?cfg.rooms.coreTimeMultiplier:1;
export const roomAmountAt=(cfg:GuildConfig,base:number,now:Date)=>base*roomRateAt(cfg,now);

/** 常設パネルは時刻で古くならないよう、通常額とコアタイム額を両方載せる。 */
export function roomAmountLabel(cfg:GuildConfig,base:number,unit=cfg.economy.currencyName):string{
 if(base<=0)return '無料';
 const normal=`${base.toLocaleString('ja-JP')}${unit?` ${unit}`:''}`;
 return cfg.rooms.coreTimeMultiplier>1&&cfg.coreTime.slots.length?`${normal}（コアタイム ${(base*cfg.rooms.coreTimeMultiplier).toLocaleString('ja-JP')}${unit?` ${unit}`:''}）`:normal;
}
export function roomCoreTimeNote(cfg:GuildConfig):string{
 return cfg.rooms.coreTimeMultiplier>1&&cfg.coreTime.slots.length?`コアタイム（${describeCoreTime(cfg.coreTime)}・日本時間）の宿代は通常の${cfg.rooms.coreTimeMultiplier}倍です。新規利用・更新のお支払い時刻で計算し、払い済み分は変えません。`:'';
}
