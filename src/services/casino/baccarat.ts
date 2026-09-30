import { rankOf, type Rng } from './cards.js';

/**
 * バカラ（プント・バンコ）。プレイヤー・バンカー・タイのどれが勝つかに賭ける。
 * プレイヤー 2 倍・バンカー 1.95 倍（5% の手数料）・タイ 9 倍。タイのとき、プレイヤー・バンカーに賭けた分は戻る。
 * 3 枚目を引くかどうかは決まり（下の表）どおり。カードは毎回 52 枚から引く。
 */

export type BacBet = 'player' | 'banker' | 'tie';
export const BAC_BETS: BacBet[] = ['player', 'banker', 'tie'];
export type BacResult = { player: number[]; banker: number[]; playerTotal: number; bankerTotal: number; winner: BacBet };

export const bacValue = (c: number) => {
  const r = rankOf(c);
  return r >= 10 ? 0 : r;
};
export const bacTotal = (cards: number[]) => cards.reduce((n, c) => n + bacValue(c), 0) % 10;

/** プレイヤーが 3 枚目を引いたあと、バンカーが引くか */
export function bankerDraws(bankerTotal: number, playerThird: number | undefined): boolean {
  if (playerThird === undefined) return bankerTotal <= 5;
  const t = bacValue(playerThird);
  if (bankerTotal <= 2) return true;
  if (bankerTotal === 3) return t !== 8;
  if (bankerTotal === 4) return t >= 2 && t <= 7;
  if (bankerTotal === 5) return t >= 4 && t <= 7;
  if (bankerTotal === 6) return t === 6 || t === 7;
  return false;
}

export function bacDeal(rng: Rng): BacResult {
  const player = [rng(52), rng(52)];
  const banker = [rng(52), rng(52)];
  const natural = bacTotal(player) >= 8 || bacTotal(banker) >= 8;
  if (!natural) {
    let third: number | undefined;
    if (bacTotal(player) <= 5) {
      third = rng(52);
      player.push(third);
    }
    if (bankerDraws(bacTotal(banker), third)) banker.push(rng(52));
  }
  const p = bacTotal(player);
  const b = bacTotal(banker);
  return { player, banker, playerTotal: p, bankerTotal: b, winner: p > b ? 'player' : b > p ? 'banker' : 'tie' };
}

export function bacPayout(bet: BacBet, r: BacResult, amount: number): number {
  if (r.winner === 'tie') return bet === 'tie' ? amount * 9 : amount;
  if (bet !== r.winner) return 0;
  return bet === 'player' ? amount * 2 : Math.floor((amount * 195) / 100);
}
