import { StyleOrnament } from './casinoStyleParts.js';
import { CASINO_LABEL } from '../../services/casino/casino.js';
import { LOBBY_TABLE_GAMES, lobbyGameHref, visibleLobbyGames } from '../../services/casino/lobby.js';
import { STYLE_COSMETICS, STYLE_ITEMS, drawCost, styleItem } from '../../services/casino/styles.js';
import type { CasinoGame } from '../../config.js';
import type { LobbyProps } from './casino.js';

const fmt = (n: number) => n.toLocaleString('ja-JP');
const featured: CasinoGame[] = ['blackjack', 'slots', 'roulette', 'poker', 'mahjong', 'keiba'];
const art: Partial<Record<CasinoGame, string>> = {
  blackjack: 'blackjack',
  bj_table: 'blackjack',
  slots: 'slots',
  roulette: 'roulette',
  roulette_table: 'roulette',
  poker: 'poker',
  mahjong: 'mahjong',
  keiba: 'keiba',
  highlow: 'highlow',
  baccarat: 'baccarat',
  baccarat_table: 'baccarat',
  atslot: 'atslot',
  chinchiro: 'chinchiro',
  chinchiro_table: 'chinchiro',
  othello: 'othello',
  versus: 'versus',
  daifugo: 'daifugo',
  babanuki: 'babanuki',
};
const label = (g: CasinoGame) => (g === 'mahjong' ? '麻雀' : g === 'keiba' ? '競馬' : CASINO_LABEL[g].name);
function GameCard(p: { game: CasinoGame; tables: Map<string, number>; openMatches: number }) {
  const g = p.game;
  const multi = LOBBY_TABLE_GAMES.includes(g);
  const count = g === 'versus' ? p.openMatches : (p.tables.get(g) ?? 0);
  return (
    <a href={lobbyGameHref(g)} class="cl-game">
      <div class={`cl-game-art ${art[g] ? `cl-art-${art[g]}` : 'cl-art-other'}`} aria-hidden="true">
        {!art[g] && <span>{CASINO_LABEL[g].emoji}</span>}
      </div>
      <div class="cl-game-body">
        <div class="cl-game-heading">
          <h3>{label(g)}</h3>
          <small>{multi ? 'みんなで遊ぶ' : 'ひとりで遊ぶ'}</small>
        </div>
        <p>{CASINO_LABEL[g].note}</p>
        <div class="cl-game-bottom">
          <span>{count > 0 ? `${count}${g === 'versus' ? '部屋' : '卓'}が開いています` : multi ? '卓を探す・立てる' : '自分のペースで'}</span>
          <b>
            遊ぶ <span aria-hidden="true">›</span>
          </b>
        </div>
      </div>
    </a>
  );
}
export function CasinoLobbyContent(p: LobbyProps) {
  const games = visibleLobbyGames(p.casino);
  const shown = games.filter((g) => p.group === 'all' || (p.group === 'table' ? LOBBY_TABLE_GAMES.includes(g) : !LOBBY_TABLE_GAMES.includes(g)));
  const first = p.group === 'all' ? featured.filter((g) => shown.includes(g)) : shown;
  const more = p.group === 'all' ? shown.filter((g) => !first.includes(g)) : [];
  const background = styleItem(p.me.styles?.background ?? '');
  const title = styleItem(p.me.styles?.title ?? '');
  const ornament = styleItem(p.me.styles?.ornament ?? '');
  return (
    <div class="cl-shell">
      <nav class="cl-rail" aria-label="ゲームの種類">
        {['solo', 'table'].map((group) => (
          <section>
            <a class="cl-rail-heading" href={`/casino/hall?group=${group}#games`}>
              {group === 'solo' ? '✦ ひとりで遊ぶ' : '♧ みんなで遊ぶ'}
            </a>
            {games
              .filter((g) => (group === 'table' ? LOBBY_TABLE_GAMES.includes(g) : !LOBBY_TABLE_GAMES.includes(g)))
              .map((g) => (
                <a class="cl-rail-game" href={lobbyGameHref(g)}>
                  <span aria-hidden="true">{CASINO_LABEL[g].emoji}</span>
                  <span>{label(g)}</span>
                </a>
              ))}
          </section>
        ))}
        <a class="cl-rail-foot" href="/casino">
          ⛩ 入口・雀荘へ
        </a>
      </nav>
      <div class="cl-content">
        <section class="cl-hero">
          <p class="cl-eyebrow">SAKURANOMIYA CASINO</p>
          <p class="cl-greeting">
            <span class="cl-greeting-name">おかえりなさい、{p.me.session.displayName} さん</span>
            {title && (
              <span class="cl-title-pill">
                {title.emoji} {title.name}
              </span>
            )}
          </p>
          <h1>今夜は、どの遊びから？</h1>
          <p>自分のペースで、楽しくどうぞ。</p>
        </section>
        {p.msg && (
          <p class="c-msg" role="status">
            {p.msg}
          </p>
        )}
        {(p.mine || p.resumes.length > 0) && (
          <section class="cl-panel cl-resume" aria-labelledby="cl-resume-title">
            <h2 id="cl-resume-title">◷ 続きから遊ぶ</h2>
            {p.mine && (
              <a class="cl-resume-row" href={`/casino/t/${p.mine.id}`}>
                <span class={`cl-resume-art cl-art-${art[p.mine.kind] ?? 'poker'}`} aria-hidden="true"></span>
                <span class="cl-resume-info">
                  <b>{label(p.mine.kind)}</b>
                  <small>
                    卓 #{p.mine.id} · {p.mine.players}/{p.mine.capacity}人
                  </small>
                </span>
                <span class={`cl-state${p.mine.yourTurn ? ' my-turn' : ''}`}>{p.mine.status}</span>
                <b class="cl-action">
                  卓に戻る <span aria-hidden="true">›</span>
                </b>
              </a>
            )}
            {p.resumes.map((r) => (
              <a class="cl-resume-row" href={`/casino/${r.game}?g=${r.id}`}>
                <span class="cl-resume-icon" aria-hidden="true">
                  {CASINO_LABEL[r.game].emoji}
                </span>
                <span class="cl-resume-info">
                  <b>{label(r.game)}</b>
                  <small>進行中の勝負</small>
                </span>
                <b class="cl-action">
                  続きを遊ぶ <span aria-hidden="true">›</span>
                </b>
              </a>
            ))}
          </section>
        )}
        <section id="games" class="cl-games-section" aria-labelledby="cl-games-title">
          <div class="cl-section-heading">
            <h2 id="cl-games-title">♧ 遊ぶゲーム</h2>
            <p>好きな遊びで、素敵なひとときを。</p>
          </div>
          <nav class="cl-filters" aria-label="遊ぶ人数で選ぶ">
            {[
              ['all', 'すべて'],
              ['solo', 'ひとりで遊ぶ'],
              ['table', 'みんなで遊ぶ'],
            ].map(([group, text]) => (
              <a href={`/casino/hall?group=${group}#games`} class={p.group === group ? 'selected' : ''} aria-current={p.group === group ? 'page' : undefined}>
                {text}
              </a>
            ))}
          </nav>
          <div class="cl-games">
            {first.map((g) => (
              <GameCard game={g} tables={p.tables} openMatches={p.openMatches} />
            ))}
          </div>
          {more.length > 0 && (
            <details class="cl-more" open={first.length === 0}>
              <summary>ほかのゲームを見る（{more.length}種類）</summary>
              <div class="cl-games">
                {more.map((g) => (
                  <GameCard game={g} tables={p.tables} openMatches={p.openMatches} />
                ))}
              </div>
            </details>
          )}
          {shown.length === 0 && <p class="cl-empty">この種類のゲームは今お休み中です。ほかの遊びを選んでください。</p>}
        </section>
        <section id="available-tables" class="cl-panel" aria-labelledby="cl-tables-title">
          <div class="cl-section-heading">
            <h2 id="cl-tables-title">♧ {p.mine ? 'ほかの卓' : '参加できる卓'}</h2>
            <a href="/casino/hall?group=table#games">
              ゲームから卓を探す <span aria-hidden="true">›</span>
            </a>
          </div>
          {p.mine && <p class="cl-small">いまの卓を立ってから、ほかの卓に参加できます。</p>}
          {p.openTables.length === 0 ? (
            <p class="cl-empty">いまは空いている卓がありません。好きなゲームから卓を立ててみましょう。</p>
          ) : (
            <ul class="cl-tables">
              {p.openTables.slice(0, 4).map((t) => (
                <li>
                  <span class="cl-table-icon" aria-hidden="true">
                    {CASINO_LABEL[t.kind].emoji}
                  </span>
                  <span>
                    <b>{label(t.kind)}</b>
                    <small>
                      卓 #{t.id} · {t.players}/{t.capacity}人 · {t.status}
                    </small>
                  </span>
                  <a class="cl-action" href={`/casino/t/${t.id}`}>
                    卓を見る <span aria-hidden="true">›</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <details class="cl-more cl-records">
          <summary>最近の勝負・大当たり</summary>
          <div class="cl-record-grid">
            <section class="cl-panel">
              <h2>あなたの最近の勝負</h2>
              {p.recent.length === 0 ? (
                <p class="cl-empty">まだ遊んでいません。</p>
              ) : (
                <ul class="cl-history">
                  {p.recent.map((r) => (
                    <li>
                      <span>
                        {CASINO_LABEL[r.game as CasinoGame]?.name}（{fmt(r.bet)}）
                      </span>
                      <b class={r.payout - r.bet > 0 ? 'c-win' : r.payout - r.bet < 0 ? 'c-lose' : 'c-even'}>
                        {r.payout - r.bet > 0 ? '+' : ''}
                        {fmt(r.payout - r.bet)}
                      </b>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section class="cl-panel">
              <h2>最近の大当たり</h2>
              {p.bigWins.length === 0 ? (
                <p class="cl-empty">まだありません。</p>
              ) : (
                <ul class="cl-history">
                  {p.bigWins.map((r) => (
                    <li>
                      <span>
                        {r.name} · {CASINO_LABEL[r.game as CasinoGame]?.name}
                      </span>
                      <b class="c-win">+{fmt(r.payout - r.bet)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </details>
        <section class="cl-limits" aria-label="賭ける上限">
          <p>
            1回 {fmt(p.casino.minBet)}〜{fmt(p.casino.maxBet)}
            {p.me.coin.name}
            {p.casino.dailyBetLimit > 0 && (
              <>
                {' '}
                · 今日賭けた分 {fmt(p.today)} / {fmt(p.casino.dailyBetLimit)}
                {p.me.coin.name}
              </>
            )}
          </p>
          {p.me.boostUntil && <p class="c-boost">🎰 大勝負の札が効いています（今日の夜0時まで）。卓の参加費・ブラインドはふだんの上限です。</p>}
        </section>
      </div>
      <aside class="cl-aside" aria-label="着せ替えと御籤">
        <section class="cl-panel cl-wardrobe">
          <h2>♧ あなたの着せ替え</h2>
          <div class="cl-wardrobe-scene" aria-label={`装備中の背景：${background?.name ?? '標準'}・席の飾り：${ornament?.name ?? '標準'}`}>
            <StyleOrnament itemKey={ornament?.key} fallback="🌸" />
          </div>
          <dl class="cl-style-list">
            <div>
              <dt>背景</dt>
              <dd>
                {background?.emoji ?? '🌙'} {background?.name ?? '夜の境内（標準）'}
              </dd>
            </div>
            <div>
              <dt>称号</dt>
              <dd>{title ? `${title.emoji} ${title.name}` : 'まだ装備していません'}</dd>
            </div>
          </dl>
          <p class="cl-small">
            見た目の品 {p.wardrobe.owned.length}/{STYLE_COSMETICS.length}種類 · お試し券 {p.wardrobe.tickets}枚
          </p>
          <a class="cl-gold-action" href="/casino/wardrobe">
            🪭 着せ替える <span aria-hidden="true">›</span>
          </a>
        </section>
        <section class="cl-panel cl-gacha">
          <h2>♧ 勝負の御籤</h2>
          <p>景品を集めて、あなたの遊技場を彩ろう。</p>
          <div class="cl-gacha-scene cl-art-gacha" aria-hidden="true">
            <span class="cl-prize-count">景品 {STYLE_ITEMS.length}種類</span>
          </div>
          <p class="cl-gacha-price">
            1回 {fmt(p.casinoGacha.price)}
            {p.me.coin.name} · 10連 {fmt(drawCost(p.casinoGacha, 10))}
            {p.me.coin.name}
          </p>
          <div class="cl-gacha-actions">
            <a href="/casino/style-gacha" class="cl-outline-action">
              中身を見る
            </a>
            <a href={p.prayerHref} class="cl-pink-action" target="_blank" rel="noopener noreferrer" aria-label="Discordの祈願所を新しいタブで開く">
              ⛩ 祈願所へ
            </a>
          </div>
          <p class="cl-small">御籤はDiscordの祈願所で引けます。{!p.casinoGacha.enabled && '今はお休み中です。'}</p>
        </section>
      </aside>
    </div>
  );
}
