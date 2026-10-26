import {comboKey,picksOf,type KbBetType} from './keiba.js';
/** 通常/ボックス/フォーメーションを同じ買い目へ変換。重複馬・重複券を取り除く。 */
export function formationKeys(type:KbBetType,slots:number[][]):string[]{
 const count=picksOf(type);if(slots.length<count)return [];
 const use=slots.slice(0,count).map(s=>[...new Set(s)]);
 if(use.some(s=>!s.length||s.some(n=>!Number.isInteger(n)||n<1||n>8)))return [];
 const out=new Set<string>();const walk=(picked:number[])=>{if(picked.length===count){out.add(comboKey(type,picked));return;}for(const n of use[picked.length]!)if(!picked.includes(n))walk([...picked,n]);};walk([]);return [...out];
}
