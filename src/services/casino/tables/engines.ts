import { baccaratTable, bjTable, rouletteTable } from './dealer.js';
import { chinchiroTable } from './chinchiroTable.js';
import { babanuki, daifugo } from './party.js';
import { mahjong } from './mahjong.js';
import { keiba } from './keiba.js';
import { poker } from './poker.js';

/** 卓の種類ごとのゲーム */
export const ENGINES = {
  bj_table: bjTable,
  baccarat_table: baccaratTable,
  roulette_table: rouletteTable,
  chinchiro_table: chinchiroTable,
  poker,
  daifugo,
  babanuki,
  mahjong,
  keiba,
} as const;
