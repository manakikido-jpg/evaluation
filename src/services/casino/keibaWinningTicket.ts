import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import type { KeibaWinningSlip } from './tables/types.js';

const paper = 'data:image/png;base64,' + readFileSync(fileURLToPath(new URL('../../../assets/keiba/winning-ticket-paper.png', import.meta.url))).toString('base64');
const fonts = ['ShipporiMinchoB1-500.ttf', 'ShipporiMinchoB1-800.ttf'].map((name) => fileURLToPath(new URL(`../../../assets/fonts/${name}`, import.meta.url)));
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const text = (s: string, length = 25) => escape([...s.replace(/[\r\n\t]/g, ' ')].slice(0, length).join(''));
const fmt = (n: number) => n.toLocaleString('ja-JP');
const labels: Record<string, string> = { win: '単勝', place: '複勝', quinella: '馬連', wide: 'ワイド', exacta: '馬単', trio: '3連複', trifecta: '3連単' };


/** 名前・買い目・金額は、清算時に保存した結果から描く。 */
export function winningTicketSvg(slip: KeibaWinningSlip, coinName: string, at: Date): string {
  const hit = slip.hits[0]!;
  const coin = text(coinName, 8);
  const key = text(hit.key.replaceAll('>', ' → ').replaceAll('-', '・'));
  const numberFont = (value: number, size: number) => Math.min(size, Math.floor(640 / ([...fmt(value)].length * .6 + Math.min([...coinName].length, 8))));
  const day = new Date(at.getTime() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="740" viewBox="0 0 1200 740">
  <image href="${paper}" width="1200" height="740" preserveAspectRatio="none"/>
  <g font-family="Shippori Mincho B1 Medium" fill="#24201d">
  <text x="225" y="82" font-size="39" font-weight="800">咲楽ノ宮競馬場</text>
  <text x="225" y="119" font-size="21">的中記念券・ゲーム内通貨</text>
  <path d="M225 148 H940" stroke="#302c28"/>
  <text x="48" y="206" font-size="34" font-weight="800">${text(slip.race, 15)}</text>
  <text x="48" y="246" font-size="23">第${slip.raceNo}レース　${text(slip.surface)} ${fmt(slip.dist)}m</text>
  <text x="48" y="300" font-size="30">${text(slip.name, 16)} さん</text>
  <rect x="580" y="175" width="360" height="151" fill="none" stroke="#302c28"/>
  <text x="600" y="216" font-size="27">${text(labels[hit.type] ?? hit.type)}　的中買い目</text>
  <text x="600" y="280" font-size="42" font-weight="800">${key}</text>
  <text x="48" y="352" font-size="22">この的中馬券：購入 ${fmt(hit.amount)}${coin} ／ 払戻 ${fmt(hit.payout)}${coin}${slip.hits.length > 1 ? `（ほか${slip.hits.length - 1}点も的中）` : ''}</text>
  <path d="M45 378 H1155" stroke="#302c28"/>
  <text x="72" y="433" font-size="29">レース購入合計</text><text x="1110" y="433" text-anchor="end" font-size="36">${fmt(slip.bet)}${coin}</text>
  <text x="72" y="512" font-size="29">払戻合計</text><text x="1110" y="514" text-anchor="end" font-size="${numberFont(slip.payout, 63)}" font-weight="800">${fmt(slip.payout)}${coin}</text>
  <text x="72" y="595" font-size="29">レース収支</text><text x="1110" y="599" text-anchor="end" font-size="${numberFont(slip.payout - slip.bet, 51)}" font-weight="800">+${fmt(slip.payout - slip.bet)}${coin}</text>
  <path d="M45 638 H1155" stroke="#756350" stroke-dasharray="8 7"/>
  <text x="52" y="681" font-size="19">${day}（日本時間）</text><text x="1145" y="681" text-anchor="end" font-size="19">この券は記念用です。換金はできません。</text>
  </g></svg>`;
}
export function renderWinningTicket(slip: KeibaWinningSlip, coinName: string, at: Date): Buffer {
  return Buffer.from(new Resvg(winningTicketSvg(slip, coinName, at), { font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Shippori Mincho B1 Medium' } }).render().asPng());
}
