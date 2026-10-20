import { AI_GAME_LABEL, AI_GAP, AI_MIN_SEATS, variantLabel, type AiRow, type AiStats, type AiVerdict } from '../../services/casino/aiStats.js';
import { OTHELLO_LEVELS } from '../../services/casino/othello.js';

/** 🤖 AI（BOT・CPU）と人の勝負（カジノのページ）。強すぎ・弱すぎを見て、直すときの手がかりにする */

const fmt = (n: number) => n.toLocaleString('ja-JP');
const signed = (n: number) => `${n > 0 ? '+' : ''}${fmt(n)}`;

const VERDICT: Record<AiVerdict, { text: string; cls: string }> = {
  strong: { text: '🔥 AI が強め', cls: 'warn' },
  weak: { text: '🧊 AI が弱め', cls: 'warn' },
  fair: { text: '⚖ ちょうどよい', cls: 'ok' },
  few: { text: '… まだ少ない', cls: 'muted' },
};
const Verdict = (p: { v: AiVerdict }) => <span class={`ai-verdict ${VERDICT[p.v].cls}`}>{VERDICT[p.v].text}</span>;
/** 順位（0 = 1 位・1 = 最下位）を「上から ○%」に */
const placeText = (v: number) => `${Math.round(v * 100)}`;

function Rows(p: { rows: AiRow[]; coinName: string; showVariant: boolean }) {
  return (
    <table class="compact ai-table">
      <thead>
        <tr>
          <th>ゲーム</th>
          {p.showVariant && <th>ルール・AI の版</th>}
          <th class="num">勝負</th>
          <th class="num">人の 1 位</th>
          <th class="num">AI の 1 位</th>
          <th class="num" title="0 = いつも 1 位・100 = いつも最下位">人の順位</th>
          <th class="num" title="0 = いつも 1 位・100 = いつも最下位">AI の順位</th>
          <th class="num">人の増減（1 席あたり）</th>
          <th>判定</th>
        </tr>
      </thead>
      <tbody>
        {p.rows.map((r) => (
          <tr>
            <td>{AI_GAME_LABEL[r.game] ?? r.game}</td>
            {p.showVariant && (
              <td class="ai-variant">
                {variantLabel(r.game, r.variant)} <span class="note">（AI v{r.aiVersion}）</span>
              </td>
            )}
            <td class="num">{fmt(r.matches)}</td>
            <td class="num">{r.humanTop}%</td>
            <td class="num">{r.botTop}%</td>
            <td class="num">{placeText(r.humanPlace)}</td>
            <td class="num">{placeText(r.botPlace)}</td>
            <td class="num">
              {signed(r.humanNet)}（{signed(r.humanNetPer)}）
            </td>
            <td>
              <Verdict v={r.verdict} />
              {r.humanLeft > 0 && <span class="note"> ・途中で抜けた {r.humanLeft}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AiStatsSection(p: { ai: AiStats; coinName: string; rangeLabel: string }) {
  const { ai } = p;
  const empty = !ai.totals.length && !ai.othello.length;
  return (
    <section class="card anchor" id="ai">
      <h2>🤖 AI との勝負（{p.rangeLabel}）</h2>
      <p class="note">
        人と AI（BOT・CPU）が同じ卓にいた勝負だけを数えます（人だけ・AI だけの卓は入りません）。「順位」は 0 = いつも 1 位・100 = いつも最下位にそろえた平均で、人と AI が同じくらいの強さなら近い数字になります。人の順位が AI より
        {Math.round(AI_GAP * 100)} 以上悪ければ「AI が強め」、良ければ「AI が弱め」（人の席が {AI_MIN_SEATS} より少ないうちは判定しません）。ポーカーは 1 手ごと（勝った人が 1 位）・増減はチップ、ほかは{p.coinName}です。
      </p>
      {!!ai.daifugo?.length && <section><h3>👑 大富豪：改善を確認するルール</h3><p class="note">運営の赤字が大きい順です。同じルール・人数・BOT数・AI版・配当条件で分けます。20対戦未満は様子見、参加者3人未満は特定の人に偏った成績として扱います。賭け額・参加者の腕前でも収支は変わるため、赤字だけでBOTが弱いとは判断しません。</p><div class="table-wrap"><table class="compact ai-table"><thead><tr><th>ルール・条件</th><th>対戦 / 人数</th><th>人の1位</th><th>運営収支 / 1対戦</th><th>次の確認</th></tr></thead><tbody>{ai.daifugo.map(r=><tr><td>{r.rules ? variantLabel('daifugo',r.rules) : '追加ルールなし'}<small class="note"> {r.players}席 / BOT{r.bots}席 / AI v{r.aiVersion} / {r.policy}</small></td><td>{fmt(r.matches)}対戦 / {r.humans}人</td><td>{r.humanTop}%</td><td>{signed(r.houseNet)} / {signed(r.housePer)} {p.coinName}</td><td>{({few:'まだ少ない：記録を増やす',concentrated:'参加者が偏っている：対戦相手も確認',weak:'改善候補：このルールでBOTの判断を検証',loss:'赤字：賭け額・参加者・配当条件を確認',strong:'BOTが強め：強化は慎重に',fair:'偏りは小さめ：経過を見る'} as const)[r.status]}</td></tr>)}</tbody></table></div></section>}
      {empty ? (
        <p class="empty">まだ記録がありません（この機能を入れてから遊ばれた分から数えます）。</p>
      ) : (
        <>
          {ai.totals.length > 0 && <Rows rows={ai.totals} coinName={p.coinName} showVariant={false} />}
          {ai.rows.length > 0 && (
            <details class="ai-details">
              <summary>ルール・AI の版ごとに見る（{ai.rows.length}）</summary>
              <Rows rows={ai.rows} coinName={p.coinName} showVariant={true} />
            </details>
          )}
          {ai.othello.length > 0 && (
            <>
              <h3>⚫ オセロ（CPU）</h3>
              <table class="compact ai-table">
                <thead>
                  <tr>
                    <th>強さ</th>
                    <th class="num">回数</th>
                    <th class="num">勝ち</th>
                    <th class="num">引き分け</th>
                    <th class="num">負け</th>
                    <th class="num">投了</th>
                    <th class="num" title="引き分けは半分の勝ち">人の勝率</th>
                    <th class="num" title="勝ったときの倍率で、損も得もしない勝率">損得なしの勝率</th>
                    <th class="num">人の増減</th>
                    <th>判定</th>
                  </tr>
                </thead>
                <tbody>
                  {ai.othello.map((o) => (
                    <tr>
                      <td>{OTHELLO_LEVELS[o.level].label}</td>
                      <td class="num">{fmt(o.games)}</td>
                      <td class="num">{fmt(o.win)}</td>
                      <td class="num">{fmt(o.draw)}</td>
                      <td class="num">{fmt(o.lose)}</td>
                      <td class="num">{fmt(o.resign)}</td>
                      <td class="num">{Math.round(((o.win + o.draw / 2) / o.games) * 100)}%</td>
                      <td class="num">{Math.round(100 / o.mult)}%</td>
                      <td class="num">{signed(o.humanNet)}</td>
                      <td>
                        <Verdict v={o.verdict} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {ai.players.length > 0 && (
            <details class="ai-details">
              <summary>AI とよく遊んでいる人（{ai.players.length}）</summary>
              <table class="compact ai-table">
                <thead>
                  <tr>
                    <th>名前</th>
                    <th class="num">勝負</th>
                    <th class="num">1 位</th>
                    <th class="num">順位</th>
                    <th class="num">増減</th>
                  </tr>
                </thead>
                <tbody>
                  {ai.players.map((x) => (
                    <tr>
                      <td>{x.name}</td>
                      <td class="num">{fmt(x.matches)}</td>
                      <td class="num">{x.top}%</td>
                      <td class="num">{placeText(x.place)}</td>
                      <td class="num">{signed(x.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
    </section>
  );
}
