import type { Child } from "hono/jsx";
import type { CasinoConfig } from "../../config.js";
import type { CasinoTable } from "../../db/schema.js";
import {
  allOrdered,
  allPairs,
  comboKey,
  fmtOdds,
  keyNos,
  picksOf,
  KB_APT,
  KB_COATS,
  KB_CLASSES,
  KB_SEXES,
  classOf,
  isGraded,
  KB_LOOK,
  kbPayConf,
  racePrizes,
  KB_BET_LABEL,
  KB_BET_TYPES,
  KB_DISTANCES,
  KB_GOINGS,
  KB_MAX_TICKETS,
  KB_STYLES,
  KB_SURFACES,
  KB_TAKE,
  KB_WEATHERS,
  liveOdds,
  poolTotal,
  marks,
  type KbBetType,
  type KbHorse,
} from "../../services/casino/keiba.js";
import {
  KB_PRERACE_MS,
  KB_RESULT_SECONDS,
  KB_WINDOWS,
  type KbState,
  type KbTicket,
} from "../../services/casino/tables/keiba.js";
import { CasinoLayout, Msg, type CasinoMe, type Coin } from "./casino.js";
import type { KeibaHorseRow } from "../../db/schema.js";
import {
  KB_FOALS_MAX,
  KB_SALE_FEE,
} from "../../services/casino/keibaStable.js";

/**
 * 🏇 みんなでダービーの画面。コースの上を走る馬は casino.js が動かす（data-kb の動きを、みんな同じ時刻に）
 */

const fmt = (n: number) => n.toLocaleString("ja-JP");
const NO = "①②③④⑤⑥⑦⑧";
const noMark = (no: number) => NO[no - 1] ?? String(no);
const COND = ["↓", "↘", "→", "↗", "↑"];
const COND_NOTE = ["不調", "いまひとつ", "ふつう", "好調", "絶好調"];

export const KB_RULES =
  `8 頭のレースに、みんなで賭けて同じレースを見ます。だれかがレースを開くと受付が始まり（1〜5 分）、締め切ると発走。結果を出したら、座っている人がいるあいだは次のレースの受付が自動で始まります。` +
  `賭け方は 単勝（1 着）・複勝（3 着まで）・馬連（1・2 着の 2 頭）・ワイド（3 着までの 2 頭）・馬単（1・2 着を順番どおり）・3連複（1〜3 着の 3 頭）・3連単（1〜3 着を順番どおり）。オッズは賭けられた銭で決まり（払い戻し率 ${Math.round((1 - KB_TAKE) * 100)}%）、発走まで動きます。人が少なくても極端にならないよう、BOT のお客さんも少し賭けています。`;

/** 馬番の札（枠の色） */
export const HorseNo = (p: { no: number; small?: boolean }) => (
  <span class={`kb-no kb-g${p.no}${p.small ? " small" : ""}`}>{p.no}</span>
);

/** 組の見せ方（①-③・順番どおりは ⑤→②） */
const pairLabel = (key: string) =>
  keyNos(key)
    .map(noMark)
    .join(key.includes(">") ? "→" : "-");
export const ticketLabel = (t: Pick<KbTicket, "t" | "key">) =>
  `${KB_BET_LABEL[t.t].name} ${pairLabel(t.key)}`;

const raceLine = (s: KbState) =>
  `${KB_SURFACES[s.race.surface]} ${fmt(s.race.dist)}m・${KB_WEATHERS[s.race.weather]}・馬場 ${KB_GOINGS[s.race.going]}`;

/** ロビーの「レースを開く」 */
export function KbCreateFields() {
  return (
    <>
      <label>
        レース名（なくてもよい）
        <input
          type="text"
          name="title"
          maxlength={20}
          placeholder="例: 咲楽ノ宮ダービー"
        />
      </label>
      <label>
        クラス
        <select name="cls">
          <option value="">
            おまかせ（出られる馬の多いクラス。ときどき重賞）
          </option>
          {KB_CLASSES.map((c, i) => (
            <option value={String(i)}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        受付の時間
        <select name="window">
          {KB_WINDOWS.map((m) => (
            <option value={String(m)} selected={m === 2}>
              {m} 分
            </option>
          ))}
        </select>
      </label>
      <label>
        距離
        <select name="dist">
          <option value="">おまかせ（毎回変わる）</option>
          {KB_DISTANCES.map((d) => (
            <option value={String(d)}>{fmt(d)}m</option>
          ))}
        </select>
      </label>
    </>
  );
}

/** ロビーの一覧の 1 行 */
export function kbSummary(s: KbState): string {
  const phase =
    s.phase === "betting"
      ? "受付中"
      : s.phase === "racing"
        ? "🏇 走っています"
        : "結果";
  return `第 ${s.race.n} レース ${s.race.name}（${KB_CLASSES[s.race.cls] ?? ""}・${KB_SURFACES[s.race.surface]} ${fmt(s.race.dist)}m）・${phase}・受付 ${s.window} 分・${s.seats.length} 人`;
}

/** テレビ中継の映像（casino.js が canvas に描く。みんな同じ時刻に同じ動き） */
function Tv(p: {
  s: KbState;
  mine: number[];
  reveal?: { net: number; paid: number; big: boolean };
}) {
  const { s } = p;
  const base = {
    mine: p.mine,
    key: `${s.race.n}:${s.run?.start ?? 0}`,
    dist: s.race.dist,
    surface: s.race.surface,
    weather: s.race.weather,
    cls: s.race.cls,
    raceName: s.race.name,
    prerace: KB_PRERACE_MS,
    horses: s.horses.map((h) => ({
      no: h.no,
      coat: h.coat,
      silk: h.silk,
      name: h.name,
      weight: h.weight,
      wdiff: h.wdiff,
      look: KB_LOOK[h.cond + 2],
      owner: h.ownerName,
    })),
  };
  const data =
    s.phase === "betting" || !s.run
      ? { ...base, phase: "betting" }
      : {
          ...base,
          phase: s.phase,
          start: s.run.start,
          frameMs: s.run.frameMs,
          frames: s.run.frames,
          lanes: s.run.lanes,
          calls: s.run.calls,
          order: s.run.order,
          resultAt: s.resultAt ?? null,
        };
  return (
    <div class="kb-tv" data-kb={JSON.stringify(data)}>
      <canvas class="kb-canvas" role="img" aria-label="レースの映像"></canvas>
      <div class="kb-tv-tag">
        <b>LIVE</b> 咲楽ノ宮競馬場 {s.race.n}R
      </div>
      <div class="kb-remain"></div>
      <ol class="kb-rank" aria-label="いまの順位"></ol>
      <div class="kb-mine" aria-live="polite"></div>
      <div class="kb-paddock" aria-live="polite"></div>
      {s.phase === "betting" && <div class="kb-hurry">⏰ 締め切り間近！</div>}
      {s.phase === "result" && s.run && s.final && <Board s={s} />}
      {p.reveal && (
        <div class={`kb-reveal ${p.reveal.paid > 0 ? "hit" : "miss"}`}>
          {p.reveal.paid > 0 ? (
            <>
              <b>{p.reveal.big ? "🎉 万馬券 的中！" : "🎉 的中！"}</b>
              <span>払い戻し {fmt(p.reveal.paid)}</span>
              <small>
                このレースの収支 {p.reveal.net >= 0 ? "+" : ""}
                {fmt(p.reveal.net)}
              </small>
            </>
          ) : (
            <>
              <b>はずれ…</b>
              <span>次のレースで取り返そう！</span>
            </>
          )}
        </div>
      )}
      <div class="kb-call" aria-live="polite">
        {s.phase === "betting"
          ? "各馬、返し馬を終えてゲートの後ろへ。馬券はお早めに！"
          : s.phase === "result"
            ? s.run?.calls.at(-1)?.text
            : "ゲートイン完了。まもなくスタートです…"}
      </div>
    </div>
  );
}

/** 到達順位 → 確定 → 払戻金（100 銭あたり）の電光掲示板。出し方は casino.js（時間で順に） */
function Board(p: { s: KbState }) {
  const { s } = p;
  const run = s.run!;
  const f = s.final!;
  const yen = (o10: number) => fmt(o10 * 10);
  return (
    <div class="kb-board">
      <div class="kb-board-order">
        <div class="kb-board-title">
          到達順位 <span class="kb-lamp">確定</span>
        </div>
        <ol>
          {run.order.slice(0, 5).map((no, i) => (
            <li>
              <span class="kb-board-pos">{i + 1}</span>
              <span class={`kb-no kb-g${no} small`}>{no}</span>
              <span class="kb-board-margin">
                {i === 0 ? run.times[0] : run.margins[i]}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div class="kb-board-pay">
        <div class="kb-board-title">払戻金（100 銭につき）</div>
        <table>
          <tbody>
            <tr>
              <th>単勝</th>
              <td>{f.win[0]}</td>
              <td>{yen(f.win[1])}</td>
            </tr>
            {f.place.map(([no, o], i) => (
              <tr>
                <th>{i === 0 ? "複勝" : ""}</th>
                <td>{no}</td>
                <td>{yen(o)}</td>
              </tr>
            ))}
            <tr>
              <th>馬連</th>
              <td>{f.quinella[0]}</td>
              <td>{yen(f.quinella[1])}</td>
            </tr>
            {f.wide.map(([k, o], i) => (
              <tr>
                <th>{i === 0 ? "ワイド" : ""}</th>
                <td>{k}</td>
                <td>{yen(o)}</td>
              </tr>
            ))}
            {(["exacta", "trio", "trifecta"] as const).map((t) => {
              const x = f[t];
              return x ? (
                <tr>
                  <th>{KB_BET_LABEL[t].name}</th>
                  <td>{x[0].replace(/>/g, "→")}</td>
                  <td>{yen(x[1])}</td>
                </tr>
              ) : null;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const record = (h: KbHorse) => `${h.starts} 戦 ${h.wins} 勝`;
const recordDetail = (h: KbHorse) =>
  `[${h.wins}-${h.seconds}-${h.thirds}-${Math.max(0, h.starts - h.wins - h.seconds - h.thirds)}]`;

/** 勝負服の小さな見本 */
const Silk = (p: { h: KbHorse }) => (
  <span
    class={`kb-silk kb-pat${p.h.silk.pattern}`}
    data-base={p.h.silk.base}
    data-accent={p.h.silk.accent}
    aria-hidden="true"
  ></span>
);

/** 出馬表（受付中はオッズ、結果では着順も） */
function RaceCard(p: { s: KbState; clickable: boolean }) {
  const { s } = p;
  const mk = marks(s.horses);
  const winOdds = s.horses.map(
    (h) => liveOdds(s.pools, "win", String(h.no)).lo,
  );
  const popular = [...s.horses]
    .sort((a, b) => winOdds[a.no - 1]! - winOdds[b.no - 1]! || a.no - b.no)
    .map((h) => h.no);
  const finishAt = (no: number) =>
    s.phase === "result" && s.run ? s.run.order.indexOf(no) + 1 : 0;
  const rows =
    s.phase === "result" && s.run
      ? s.run.order.map((no) => s.horses[no - 1]!)
      : s.horses;
  return (
    <div class="kb-card-wrap">
      <table class="kb-card">
        <thead>
          <tr>
            {s.phase === "result" && <th>着</th>}
            <th>馬番</th>
            <th>印</th>
            <th class="l">馬名</th>
            <th>単勝</th>
            <th>複勝</th>
            <th>人気</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h: KbHorse) => {
            const pl = liveOdds(s.pools, "place", String(h.no));
            const at = finishAt(h.no);
            return (
              <tr
                class={`${p.clickable ? "kb-pick" : ""}${at && at <= 3 ? ` kb-top${at}` : ""}`}
                data-kb-pick={p.clickable ? String(h.no) : undefined}
              >
                {s.phase === "result" && <td class="kb-fin">{at}</td>}
                <td>
                  <HorseNo no={h.no} />
                </td>
                <td class="kb-mark">{mk.get(h.no) ?? ""}</td>
                <td class="l">
                  <b>
                    <Silk h={h} />
                    {h.name}
                  </b>
                  <small>
                    {KB_SEXES[h.sex]}
                    {h.age}・{KB_COATS[h.coat]}・{KB_STYLES[h.style]}・
                    {KB_APT[h.apt]}・
                    {h.surf === 2
                      ? "芝もダートも"
                      : `${KB_SURFACES[h.surf]}が得意`}
                    ・調子{" "}
                    <span title={COND_NOTE[h.cond + 2]}>
                      {COND[h.cond + 2]}
                    </span>
                  </small>
                  <small>
                    馬体重 {h.weight}kg
                    {h.wdiff ? `（${h.wdiff > 0 ? "+" : ""}${h.wdiff}）` : ""}・
                    {KB_CLASSES[h.cls]}・賞金 {fmt(h.prize)}
                    {h.sire ? `・父 ${h.sire}` : ""}
                    {h.ownerName ? (
                      <span class="kb-owner">・馬主 {h.ownerName}</span>
                    ) : (
                      ""
                    )}
                    {h.id > 0 && (
                      <>
                        ・
                        <a
                          class="kb-horse-link"
                          href={`/casino/keiba/horse/${h.id}`}
                        >
                          成績
                        </a>
                      </>
                    )}
                  </small>
                  <small>
                    {h.starts ? (
                      <>
                        {record(h)} {recordDetail(h)}・近走{" "}
                        {h.recent.map((r) => (
                          <span
                            class={`kb-run${r.pos <= 3 ? ` p${r.pos}` : ""}`}
                            title={`${r.race}（${KB_SURFACES[r.surface]} ${r.dist}m）`}
                          >
                            {r.pos}
                          </span>
                        ))}
                      </>
                    ) : (
                      "初出走"
                    )}
                  </small>
                  {at > 0 && s.run && (
                    <small class="kb-time">
                      {s.run.times[at - 1]}
                      {at > 1 ? `（${s.run.margins[at - 1]}）` : ""}・上がり 3F{" "}
                      {s.run.last3f[at - 1]?.toFixed(1)}・通過{" "}
                      {s.run.corners[at - 1] || "—"}
                    </small>
                  )}
                </td>
                <td class="kb-odds">
                  <span
                    data-kb-odd={`w${h.no}`}
                    data-v={String(winOdds[h.no - 1]!)}
                  >
                    {fmtOdds(winOdds[h.no - 1]!)}
                  </span>
                  <span class="kb-popbar" aria-hidden="true">
                    <i
                      data-w={String(
                        Math.round(
                          (s.pools.win[h.no - 1]! /
                            Math.max(1, poolTotal(s.pools, "win"))) *
                            100,
                        ),
                      )}
                    ></i>
                  </span>
                </td>
                <td class="kb-odds sub">
                  <span data-kb-odd={`p${h.no}`} data-v={String(pl.lo)}>
                    {fmtOdds(pl.lo)}
                    {pl.hi !== pl.lo ? `-${fmtOdds(pl.hi)}` : ""}
                  </span>
                </td>
                <td>{popular.indexOf(h.no) + 1}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 馬連・ワイドのオッズ表 */
function PairOdds(p: { s: KbState; t: "quinella" | "wide" }) {
  const n = p.s.horses.length;
  const cell = (a: number, b: number) => {
    const o = liveOdds(p.s.pools, p.t, `${a}-${b}`);
    return fmtOdds(o.lo);
  };
  return (
    <table class="kb-pairs">
      <thead>
        <tr>
          <th></th>
          {Array.from({ length: n - 1 }, (_, i) => (
            <th>
              <HorseNo no={i + 2} small />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: n - 1 }, (_, i) => i + 1).map((a) => (
          <tr>
            <th>
              <HorseNo no={a} small />
            </th>
            {Array.from({ length: n - 1 }, (_, j) => j + 2).map((b) =>
              b > a ? <td>{cell(a, b)}</td> : <td class="x"></td>,
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** いまのオッズ（10 倍した値）。画面の「当たると いくら」に使う */
function oddsData(s: KbState) {
  const nos = s.horses.map((h) => h.no);
  const pair = (t: "quinella" | "wide") =>
    Object.fromEntries(
      allPairs().map((k) => [
        k,
        ((o) => [o.lo, o.hi])(liveOdds(s.pools, t, k)),
      ]),
    );
  // 馬単・3 連複・3 連単は 1 つの倍率
  const combos = (t: "exacta" | "trio" | "trifecta") => {
    const keys = [
      ...new Set(allOrdered(picksOf(t), nos.length).map((o) => comboKey(t, o))),
    ];
    return Object.fromEntries(keys.map((k) => [k, liveOdds(s.pools, t, k).lo]));
  };
  return {
    win: Object.fromEntries(
      nos.map((n) => [n, liveOdds(s.pools, "win", String(n)).lo]),
    ),
    place: Object.fromEntries(
      nos.map((n) =>
        ((o) => [n, [o.lo, o.hi]])(liveOdds(s.pools, "place", String(n))),
      ),
    ),
    quinella: pair("quinella"),
    wide: pair("wide"),
    exacta: combos("exacta"),
    trio: combos("trio"),
    trifecta: combos("trifecta"),
    // 賭け方ごとの合計（自分が賭けた分でオッズが下がるのを見込むため）
    totals: Object.fromEntries(
      KB_BET_TYPES.map((t) => [t, poolTotal(s.pools, t)]),
    ),
  };
}

/** 馬券を買う: 賭け方 → 馬（押して選ぶ。2 頭以上でボックス）→ 量 → 買う */
function BetPanel(p: {
  t: CasinoTable;
  s: KbState;
  me: CasinoMe;
  casino: CasinoConfig;
}) {
  const { s, casino } = p;
  const mk = marks(s.horses);
  const win = s.horses.map((h) => liveOdds(s.pools, "win", String(h.no)).lo);
  const fav = s.horses[win.indexOf(Math.min(...win))]!.no;
  const chips = [
    ...new Set([casino.minBet, 50, 100, 500, 1000, 5000, casino.maxBet]),
  ]
    .filter((n) => n >= casino.minBet && n <= casino.maxBet)
    .sort((a, b) => a - b);
  const first = chips.find((n) => n >= 100) ?? chips[0]!;
  return (
    <section class="c-panel kb-bet">
      <h2>🎫 馬券を買う</h2>
      <form
        method="post"
        action={`/casino/t/${p.t.id}/act`}
        class="kb-slip"
        data-odds={JSON.stringify(oddsData(s))}
        data-fav={String(fav)}
        data-coin={p.me.coin.name}
        data-max={String(KB_MAX_TICKETS)}
      >
        <input type="hidden" name="_csrf" value={p.me.session.csrfToken} />
        <input type="hidden" name="action" value="bets" />
        <input type="hidden" name="seq" value="" />
        <p class="kb-step">① 賭け方</p>
        <div class="kb-types" role="radiogroup" aria-label="賭け方">
          {KB_BET_TYPES.map((t: KbBetType, i) => (
            <label class="kb-type">
              <input type="radio" name="type" value={t} checked={i === 0} />
              <span>
                <b>{KB_BET_LABEL[t].name}</b>
                <small>{KB_BET_LABEL[t].note}</small>
              </span>
            </label>
          ))}
        </div>
        <div class="kb-mode" role="radiogroup" aria-label="馬単・3連単の買い方">
          <label>
            <input type="radio" name="mode" value="box" checked />
            <span>
              <b>ボックス</b>
              <small>選んだ馬の、順番ちがいも全部</small>
            </span>
          </label>
          <label>
            <input type="radio" name="mode" value="order" />
            <span>
              <b>着順どおり</b>
              <small>押した順が 1 着 → 2 着 → 3 着（1 点）</small>
            </span>
          </label>
        </div>
        <p class="kb-step">
          ② 馬を選ぶ{" "}
          <small class="kb-hint">
            何頭でも。2 頭・3
            頭の賭け方は、選んだ馬の組み合わせを全部買います（ボックス）
          </small>
        </p>
        <div class="kb-quick">
          <button
            type="button"
            class="c-btn c-btn-small"
            data-kb-quick="random"
          >
            🎲 おまかせ
          </button>
          <button type="button" class="c-btn c-btn-small" data-kb-quick="fav">
            ⭐ 1 番人気
          </button>
          <button
            type="button"
            class="c-btn c-btn-small c-btn-ghost"
            data-kb-quick="clear"
          >
            選び直す
          </button>
        </div>
        <div class="kb-horses">
          {s.horses.map((h) => (
            <label class={`kb-hbtn kb-g${h.no}-edge`}>
              <input type="checkbox" name="h" value={String(h.no)} />
              <span class={`kb-no kb-g${h.no}`}>{h.no}</span>
              <i class="kb-hbtn-seq" data-kb-seq={String(h.no)}></i>
              <span class="kb-hbtn-name">
                {mk.get(h.no) && <i class="kb-hbtn-mark">{mk.get(h.no)}</i>}
                {h.name}
              </span>
              <span class="kb-hbtn-odds" data-kb-hodds={String(h.no)}>
                単 {fmtOdds(win[h.no - 1]!)}
              </span>
            </label>
          ))}
        </div>
        <p class="kb-step">③ 1 点あたりの量</p>
        <div class="kb-amounts">
          {chips.map((n) => (
            <label
              class={`kb-amt c-chip c-chip-${n >= 5000 ? "black" : n >= 1000 ? "gold" : n >= 500 ? "purple" : n >= 100 ? "blue" : n >= 50 ? "green" : "red"}`}
            >
              <input
                type="radio"
                name="bet"
                value={String(n)}
                checked={n === first}
              />
              <span>{fmt(n)}</span>
            </label>
          ))}
          <label class="kb-amt-custom">
            <input type="radio" name="bet" value="custom" />
            <input
              type="number"
              name="betCustom"
              min={casino.minBet}
              max={casino.maxBet}
              value={String(first)}
              inputmode="numeric"
              aria-label="好きな量"
            />
          </label>
        </div>
        <p class="kb-preview" aria-live="polite">
          馬を選ぶと、何点・合計いくら・当たるといくらかがここに出ます。
        </p>
        <button type="submit" class="c-btn c-btn-gold kb-buy">
          🎫 馬券を買う
        </button>
        <p class="c-muted kb-hint">
          1 レースに {KB_MAX_TICKETS}{" "}
          枚まで。発走までは「全部取り消す」で戻せます。
        </p>
      </form>
    </section>
  );
}

function MyTickets(p: {
  t: CasinoTable;
  s: KbState;
  me: CasinoMe;
  mine: KbTicket[];
}) {
  const { s, mine } = p;
  if (!mine.length) return null;
  const bet = mine.reduce((n, x) => n + x.amount, 0);
  const paid = mine.reduce((n, x) => n + (x.payout ?? 0), 0);
  return (
    <section class="c-panel">
      <h2>
        🎫 あなたの馬券（{fmt(bet)} {p.me.coin.name}）
        <a class="kb-h2-link" href="/casino/keiba/mine">
          これまでの成績 →
        </a>
      </h2>
      <ul class="kb-tickets">
        {mine.map((x) => (
          <li class={x.payout ? "hit" : x.odds === 0 ? "miss" : ""}>
            <span>{ticketLabel(x)}</span>
            <span>
              {p.me.coin.emoji}
              {fmt(x.amount)}
            </span>
            {x.payout !== undefined && (
              <b>
                {x.payout > 0
                  ? `的中！ ×${fmtOdds(x.odds!)} → ${fmt(x.payout)}`
                  : "はずれ"}
              </b>
            )}
          </li>
        ))}
      </ul>
      {s.phase === "result" && (
        <p
          class={`kb-net ${paid - bet > 0 ? "c-win" : paid - bet < 0 ? "c-lose" : "c-even"}`}
        >
          {paid - bet > 0
            ? `+${fmt(paid - bet)}`
            : paid - bet < 0
              ? fmt(paid - bet)
              : "±0"}{" "}
          {p.me.coin.name}
        </p>
      )}
      {s.phase === "betting" && (
        <form
          method="post"
          action={`/casino/t/${p.t.id}/act`}
          class="c-actions"
        >
          <input type="hidden" name="_csrf" value={p.me.session.csrfToken} />
          <button
            type="submit"
            name="action"
            value="cancel"
            class="c-btn c-btn-ghost c-confirm"
            data-confirm="このレースの馬券を全部取り消して、銭を戻しますか？"
          >
            全部取り消す
          </button>
        </form>
      )}
    </section>
  );
}

/** みんなの馬券（だれが何に賭けたか） */
function Everyone(p: { s: KbState; coin: Coin }) {
  const by = new Map<string, KbTicket[]>();
  for (const t of p.s.tickets)
    by.set(t.memberId, [...(by.get(t.memberId) ?? []), t]);
  return (
    <section class="c-panel">
      <h2>
        👥 みんなの馬券（{by.size} 人・{p.coin.emoji}
        {fmt(p.s.real)}）
      </h2>
      {by.size === 0 ? (
        <p class="c-muted">まだだれも買っていません。</p>
      ) : (
        <ul class="kb-everyone">
          {[...by.values()].map((list) => {
            const paid = list.reduce((n, x) => n + (x.payout ?? 0), 0);
            return (
              <li>
                <b>{list[0]!.name}</b>
                <span class="kb-chips">
                  {list.map((x) => (
                    <span class={`kb-chip${x.payout ? " hit" : ""}`}>
                      {ticketLabel(x)} {fmt(x.amount)}
                    </span>
                  ))}
                </span>
                {p.s.phase === "result" && paid > 0 && (
                  <span class="c-win">🎉 {fmt(paid)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** 払い戻し（結果） */
function Payouts(p: { s: KbState }) {
  const f = p.s.final;
  if (!f) return null;
  const row = (name: string, label: string, odds: number) => (
    <tr class={odds >= 1000 ? "kb-man" : ""}>
      <th>{name}</th>
      <td>{label}</td>
      <td class="kb-odds">
        ×{fmtOdds(odds)}
        {odds >= 1000 && <span class="kb-man-tag">万馬券！</span>}
      </td>
    </tr>
  );
  return (
    <section class="c-panel">
      <h2>💴 払い戻し</h2>
      <table class="kb-pay">
        <tbody>
          {row("単勝", noMark(f.win[0]), f.win[1])}
          {f.place.map(([no, o], i) =>
            row(i === 0 ? "複勝" : "", noMark(no), o),
          )}
          {row("馬連", pairLabel(f.quinella[0]), f.quinella[1])}
          {f.wide.map(([k, o], i) =>
            row(i === 0 ? "ワイド" : "", pairLabel(k), o),
          )}
          {(["exacta", "trio", "trifecta"] as const).map((t) =>
            ((x) =>
              x ? row(KB_BET_LABEL[t].name, pairLabel(x[0]), x[1]) : null)(
              f[t],
            ),
          )}
        </tbody>
      </table>
      <p class="c-muted">
        賭けた銭 × 倍率 が戻ります（BOT のお客さんの分も含めたオッズです）。
      </p>
    </section>
  );
}

export function KeibaView(p: {
  t: CasinoTable;
  s: KbState;
  me: CasinoMe;
  casino: CasinoConfig;
  now: number;
  seatControls: Child;
  countdown: Child;
}) {
  const { s, me } = p;
  const uid = me.session.userId;
  const seated = s.seats.some((x) => x.id === uid);
  const mine = s.tickets.filter((x) => x.memberId === uid);
  const net = mine.reduce((n, x) => n + (x.payout ?? 0) - x.amount, 0);
  // いま結果を出しているレースは「これまで」に入れない
  const past = s.history
    .filter((h) => !(s.phase === "result" && h.n === s.race.n))
    .slice(0, 5);
  const phaseText =
    s.phase === "betting"
      ? "🎫 受付中・発走まで"
      : s.phase === "racing"
        ? "🏇 レース中"
        : `🏁 結果（${KB_RESULT_SECONDS} 秒で次のレースの受付）・次まで`;
  return (
    <div class="kb-layout">
      <div class="kb-main">
        <section
          class="kb-stage"
          data-kb-net={
            s.phase === "result" && mine.length ? String(net) : undefined
          }
        >
          <div class="kb-head">
            <div>
              <p class="kb-kicker">
                第 {s.race.n} レース
                <span
                  class={`kb-cls${isGraded(s.race.cls) ? ` g${s.race.cls - 5}` : ""}`}
                >
                  {KB_CLASSES[s.race.cls] ?? ""}
                </span>
              </p>
              <h2 class={`kb-title${s.race.cls === 8 ? " g1" : ""}`}>
                {s.race.name}
              </h2>
              <p class="kb-cond">{raceLine(s)}</p>
              <p class="kb-prize">
                🏆 1 着賞金 {me.coin.emoji}
                {fmt(
                  (s.prizes ??
                    racePrizes(s.race.cls, s.real, kbPayConf(p.casino)))[0] ??
                    0,
                )}
                <small>
                  （賭けが増えるほど上がる。最低{" "}
                  {fmt(p.casino.keibaPurse[s.race.cls] ?? 0)}。馬主の馬が 1〜5
                  着なら馬主に）
                </small>
              </p>
            </div>
            <div class="c-phase">
              {phaseText}
              {s.phase !== "racing" && p.countdown}
            </div>
          </div>
          <Tv
            s={s}
            mine={[...new Set(mine.flatMap((x) => keyNos(x.key)))]}
            {...(s.phase === "result" && mine.length
              ? {
                  reveal: {
                    net,
                    paid: mine.reduce((n, x) => n + (x.payout ?? 0), 0),
                    big: mine.some(
                      (x) => (x.odds ?? 0) >= 1000 && (x.payout ?? 0) > 0,
                    ),
                  },
                }
              : {})}
          />
          {past.length > 0 && (
            <div class="kb-history">
              <span class="c-muted">これまで:</span>
              {past.map((h) => (
                <span
                  class="kb-hist"
                  title={`${h.name}: ${h.names.join("・")}`}
                >
                  {h.n}R {h.order.map((no) => noMark(no)).join("")} ×
                  {fmtOdds(h.win)}
                </span>
              ))}
            </div>
          )}
        </section>
        {s.phase === "betting" && seated && s.hostId === uid && (
          <form
            method="post"
            action={`/casino/t/${p.t.id}/act`}
            class="c-actions kb-start"
          >
            <input type="hidden" name="_csrf" value={me.session.csrfToken} />
            <button
              type="submit"
              name="action"
              value="start"
              class="c-btn c-confirm"
              data-confirm="受付を締め切って、いますぐ発走しますか？"
            >
              🏁 締め切って発走（開いた人だけ）
            </button>
          </form>
        )}
        <section class="c-panel">
          <h2>
            📋 出馬表
            {s.phase === "betting"
              ? "（オッズは発走まで動きます）"
              : s.phase === "racing"
                ? "（確定オッズ）"
                : ""}
          </h2>
          <RaceCard s={s} clickable={seated && s.phase === "betting"} />
          <details class="kb-pair-odds">
            <summary>馬連・ワイドのオッズ表</summary>
            <h3>馬連</h3>
            <PairOdds s={s} t="quinella" />
            <h3>ワイド（いちばん低いとき）</h3>
            <PairOdds s={s} t="wide" />
          </details>
        </section>
        {s.phase === "result" && s.run && (
          <section class="c-panel">
            <h2>⏱ ラップ</h2>
            <p class="kb-laps">
              {s.run.laps.map((x) => x.toFixed(1)).join(" - ")}
            </p>
            <p class="c-muted">
              先頭の 200m ごとのタイムです。勝ち時計 {s.run.times[0]}。
            </p>
          </section>
        )}
        {s.phase === "result" && <Payouts s={s} />}
      </div>
      {/* PC では右に並べる（レースを見ながら買える） */}
      <div class="kb-side">
        {seated && s.phase === "betting" && (
          <BetPanel t={p.t} s={s} me={me} casino={p.casino} />
        )}
        <MyTickets t={p.t} s={s} me={me} mine={mine} />
        <Everyone s={s} coin={me.coin} />
        <div class="c-panel">
          <p class="c-muted">
            {s.seats.length} 人が参加しています（
            {s.seats.map((x) => x.name).join("・")}）。
            {seated
              ? ""
              : "見ているだけでもレースは見られます。馬券を買うには参加してください。"}
          </p>
          {p.seatControls}
        </div>
      </div>
    </div>
  );
}

/** 馬連・ワイドの組の数（テスト用） */
export const KB_PAIR_COUNT = allPairs().length;

// ───────── 🐴 馬主の部屋 ─────────

const classLabel = (h: { starts: number; wins: number }) =>
  KB_CLASSES[classOf(h)]!;

export type StableHorse = KeibaHorseRow & {
  fatigueNow: number;
  foals?: number;
};
export type LeadingView = {
  ownerId: string;
  name: string;
  prize: number;
  wins: number;
  runs: number;
};

/** リーディングオーナー（今月） */
function Leading(p: { rows: LeadingView[]; coin: Coin; me: string }) {
  return (
    <section class="c-panel">
      <h2>👑 今月のリーディングオーナー</h2>
      {p.rows.length === 0 ? (
        <p class="c-muted">今月はまだだれも賞金を取っていません。</p>
      ) : (
        <ol class="kb-leading">
          {p.rows.map((r, i) => (
            <li class={r.ownerId === p.me ? "me" : ""}>
              <span class="kb-leading-rank">{i + 1}</span>
              <b>{r.name}</b>
              <span>
                {p.coin.emoji}
                {fmt(r.prize)}
              </span>
              <span class="c-muted">
                {r.wins} 勝 / {r.runs} 走
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** みんなでダービーの入口に出す: 馬主の部屋への案内とリーディング */
export function KbLobbyExtra(p: {
  me: CasinoMe;
  horses: KeibaHorseRow[];
  price: number;
  leading: LeadingView[];
}) {
  const active = p.horses.filter((h) => !h.retiredAt);
  return (
    <>
      <section class="c-panel kb-owner-cta">
        <h2>🐴 馬主になる</h2>
        <p class="c-muted">
          {p.price > 0
            ? `${p.me.coin.emoji}${fmt(p.price)} ${p.me.coin.name}で馬を買って、名前と勝負服を決めて走らせられます。賞金・出走手当・調教・売り買い・産駒も。`
            : "いまは馬を買えません（運営が止めています）。"}
        </p>
        {active.length > 0 && (
          <ul class="kb-mini-stable">
            {active.map((h) => (
              <li>
                <b>
                  <a href={`/casino/keiba/horse/${h.id}`}>{h.name}</a>
                </b>
                <span class="c-muted">
                  {classLabel(h)}・{h.starts} 戦 {h.wins} 勝・賞金{" "}
                  {p.me.coin.emoji}
                  {fmt(h.prize)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <a class="c-btn c-btn-gold" href="/casino/keiba/stable">
          🐴 馬主の部屋へ
        </a>
      </section>
      <section class="c-panel kb-rec-links">
        <h2>📊 成績</h2>
        <p class="c-actions">
          <a class="c-btn" href="/casino/keiba/mine">
            🎫 あなたの馬券成績
          </a>
          <a class="c-btn" href="/casino/keiba/horses">
            📖 馬名鑑（馬ごとの成績）
          </a>
        </p>
      </section>
      <Leading
        rows={p.leading.slice(0, 5)}
        coin={p.me.coin}
        me={p.me.session.userId}
      />
    </>
  );
}

const SILK_COLORS = [
  "#e53935",
  "#1e63d6",
  "#f4c430",
  "#2e9e4f",
  "#ffffff",
  "#222222",
  "#8e44ad",
  "#f08a24",
  "#f48fb1",
  "#00a6a6",
  "#8b1a1a",
  "#0b3d91",
] as const;
const COLOR_NAMES = [
  "赤",
  "青",
  "黄",
  "緑",
  "白",
  "黒",
  "紫",
  "橙",
  "桃",
  "水色",
  "えんじ",
  "紺",
] as const;
const PATTERNS = ["無地", "縦縞", "襷", "輪", "山形", "星"] as const;

/** 勝負服を決める */
function SilkForm(p: {
  csrf: string;
  silk?: { base: string; accent: string; pattern: number };
}) {
  const cur = p.silk ?? {
    base: SILK_COLORS[0],
    accent: SILK_COLORS[4],
    pattern: 0,
  };
  const colorPick = (name: string, value: string) => (
    <div class="kb-swatches" role="radiogroup">
      {SILK_COLORS.map((c, i) => (
        <label class="kb-swatch" title={COLOR_NAMES[i]}>
          <input type="radio" name={name} value={c} checked={c === value} />
          <span
            class="kb-silk kb-pat0"
            data-base={c}
            data-accent={c}
            aria-label={COLOR_NAMES[i]}
          ></span>
        </label>
      ))}
    </div>
  );
  return (
    <form method="post" action="/casino/keiba/stable/silk" class="kb-silk-form">
      <input type="hidden" name="_csrf" value={p.csrf} />
      <div class="kb-silk-preview">
        <span
          class={`kb-silk big kb-pat${cur.pattern}`}
          data-base={cur.base}
          data-accent={cur.accent}
          aria-label="いまの勝負服"
        ></span>
      </div>
      <p class="kb-step">服の色</p>
      {colorPick("base", cur.base)}
      <p class="kb-step">柄の色</p>
      {colorPick("accent", cur.accent)}
      <p class="kb-step">柄</p>
      <div class="kb-swatches">
        {PATTERNS.map((name, i) => (
          <label class="kb-type">
            <input
              type="radio"
              name="pattern"
              value={String(i)}
              checked={i === cur.pattern}
            />
            <span>{name}</span>
          </label>
        ))}
      </div>
      <button type="submit" class="c-btn c-btn-gold">
        🎽 この勝負服にする
      </button>
    </form>
  );
}

export function KbStablePage(p: {
  /** 馬主への還元の設定 */
  pay?: Pick<
    CasinoConfig,
    | "keibaPrizeMult"
    | "keibaPurse"
    | "keibaFanPct"
    | "keibaRoyaltyPct"
    | "keibaRetirePerWin"
  >;
  me: CasinoMe;
  horses: StableHorse[];
  price: number;
  max: number;
  trainPrice: number;
  silk?: { base: string; accent: string; pattern: number };
  forSale: (KeibaHorseRow & { ownerName: string | null })[];
  leading: LeadingView[];
  msg?: string;
}) {
  const csrf = p.me.session.csrfToken;
  const active = p.horses.filter((h) => !h.retiredAt);
  const coin = p.me.coin;
  const now = Date.now();
  const foalPrice = Math.floor(p.price / 2);
  const Hidden = () => <input type="hidden" name="_csrf" value={csrf} />;
  return (
    <CasinoLayout title="馬主の部屋" me={p.me}>
      <p class="c-back">
        <a href="/casino/tables/keiba">← みんなでダービーへ</a>
      </p>
      <h1 class="c-h1">🐴 馬主の部屋</h1>
      {p.msg && <Msg msg={p.msg} />}
      <section class="c-panel">
        <h2>
          🏠 あなたの馬（{active.length} / {p.max} 頭）
        </h2>
        {p.horses.length === 0 ? (
          <p class="c-muted">
            まだいません。下の「馬を買う」から迎えましょう。
          </p>
        ) : (
          <div class="kb-stable">
            {p.horses.map((h) => {
              const resting = h.restUntil && h.restUntil.getTime() > now;
              const cooldown = h.trainedAt
                ? h.trainedAt.getTime() + 6 * 3_600_000 - now
                : 0;
              return (
                <div class={`kb-stable-card${h.retiredAt ? " retired" : ""}`}>
                  <div class="kb-stable-head">
                    <b>
                      <span
                        class={`kb-silk kb-pat${h.silk.pattern}`}
                        data-base={h.silk.base}
                        data-accent={h.silk.accent}
                        aria-hidden="true"
                      ></span>
                      <a href={`/casino/keiba/horse/${h.id}`}>{h.name}</a>
                    </b>
                    <span class="c-tag">
                      {h.retiredAt
                        ? h.breeding
                          ? "繁殖"
                          : "引退"
                        : classLabel(h)}
                    </span>
                  </div>
                  <p class="c-muted">
                    {KB_SEXES[h.sex]}
                    {h.age}・{KB_COATS[h.coat]}・
                    {h.starts
                      ? `${KB_STYLES[h.style]}・${KB_APT[h.apt]}`
                      : "脚質・得意はデビューしてから"}
                  </p>
                  <p>
                    {h.starts} 戦 {h.wins} 勝 [{h.wins}-{h.seconds}-{h.thirds}-
                    {Math.max(0, h.starts - h.wins - h.seconds - h.thirds)}
                    ]・獲得賞金 {coin.emoji}
                    {fmt(h.prize)}
                  </p>
                  {!h.retiredAt && (
                    <div class="kb-condbar" aria-label={`疲れ ${h.fatigueNow}`}>
                      <span>疲れ</span>
                      <span class="kb-popbar">
                        <i data-w={String(h.fatigueNow)}></i>
                      </span>
                      <span class="c-muted">
                        {resting
                          ? "🌿 放牧中"
                          : h.fatigueNow >= 80
                            ? "休ませて（出走しません）"
                            : h.fatigueNow >= 50
                              ? "疲れぎみ（調子 −1）"
                              : "元気"}
                        {h.trainBoost > 0
                          ? "・💪 調教ずみ（次のレース調子 +1）"
                          : ""}
                      </span>
                    </div>
                  )}
                  {h.recent.length > 0 && (
                    <p class="kb-stable-recent">
                      近走:
                      {h.recent.map((r) => (
                        <span
                          class={`kb-run${r.pos <= 3 ? ` p${r.pos}` : ""}`}
                          title={`${r.race}（${KB_SURFACES[r.surface]} ${r.dist}m）`}
                        >
                          {r.pos}
                        </span>
                      ))}
                    </p>
                  )}
                  {!h.retiredAt ? (
                    <div class="kb-stable-actions">
                      {p.trainPrice > 0 && (
                        <form
                          method="post"
                          action={`/casino/keiba/stable/${h.id}/train`}
                        >
                          <Hidden />
                          <button
                            type="submit"
                            class="c-btn c-btn-small"
                            disabled={Boolean(resting) || cooldown > 0}
                          >
                            💪 調教（{coin.emoji}
                            {fmt(p.trainPrice)}）
                            {cooldown > 0
                              ? ` あと ${Math.ceil(cooldown / 3_600_000)} 時間`
                              : ""}
                          </button>
                        </form>
                      )}
                      <form
                        method="post"
                        action={`/casino/keiba/stable/${h.id}/rest`}
                      >
                        <Hidden />
                        <button
                          type="submit"
                          class="c-btn c-btn-small"
                          disabled={Boolean(resting)}
                        >
                          🌿 放牧（1 時間休む）
                        </button>
                      </form>
                      {h.starts === 0 && (
                        <form
                          method="post"
                          action={`/casino/keiba/stable/${h.id}/name`}
                          class="c-bet-custom"
                        >
                          <Hidden />
                          <input
                            type="text"
                            name="name"
                            value={h.name}
                            maxlength={18}
                            required
                            aria-label="馬の名前"
                          />
                          <button type="submit" class="c-btn c-btn-small">
                            名前を変える
                          </button>
                        </form>
                      )}
                      <form
                        method="post"
                        action={`/casino/keiba/stable/${h.id}/sale`}
                        class="c-bet-custom"
                      >
                        <Hidden />
                        {h.salePrice !== null ? (
                          <button
                            type="submit"
                            name="cancel"
                            value="1"
                            class="c-btn c-btn-small c-btn-ghost"
                          >
                            売りに出し中（{coin.emoji}
                            {fmt(h.salePrice)}）→ 取り下げる
                          </button>
                        ) : (
                          <>
                            <input
                              type="number"
                              name="price"
                              min={100}
                              max={10000000}
                              placeholder="値段"
                              required
                              aria-label="売る値段"
                            />
                            <button type="submit" class="c-btn c-btn-small">
                              💱 売りに出す
                            </button>
                          </>
                        )}
                      </form>
                      {h.wins > 0 && (
                        <form
                          method="post"
                          action={`/casino/keiba/stable/${h.id}/breed`}
                        >
                          <Hidden />
                          <button
                            type="submit"
                            class="c-btn c-btn-small c-btn-ghost c-confirm"
                            data-confirm={`${h.name} を引退させて繁殖入りさせますか？（もう走りません。産駒を ${KB_FOALS_MAX} 頭まで迎えられます）`}
                          >
                            🌸 引退して繁殖入り
                          </button>
                        </form>
                      )}
                      <form
                        method="post"
                        action={`/casino/keiba/stable/${h.id}/retire`}
                      >
                        <Hidden />
                        <button
                          type="submit"
                          class="c-btn c-btn-small c-btn-ghost c-confirm"
                          data-confirm={`${h.name} を引退させますか？（戻せません）`}
                        >
                          引退させる
                        </button>
                      </form>
                    </div>
                  ) : (
                    h.breeding && (
                      <div class="kb-stable-actions">
                        {(h.foals ?? 0) < KB_FOALS_MAX &&
                        active.length < p.max ? (
                          <form
                            method="post"
                            action={`/casino/keiba/stable/${h.id}/foal`}
                            class="c-bet-custom"
                          >
                            <Hidden />
                            <input
                              type="text"
                              name="name"
                              maxlength={18}
                              required
                              placeholder="産駒の名前"
                              aria-label="産駒の名前"
                            />
                            <button
                              type="submit"
                              class="c-btn c-btn-small c-btn-gold c-confirm"
                              data-confirm={`${fmt(foalPrice)} ${coin.name}で産駒を迎えますか？`}
                            >
                              🐣 産駒を迎える（{coin.emoji}
                              {fmt(foalPrice)}・あと{" "}
                              {KB_FOALS_MAX - (h.foals ?? 0)} 頭）
                            </button>
                          </form>
                        ) : (
                          <p class="c-muted">
                            {(h.foals ?? 0) >= KB_FOALS_MAX
                              ? "産駒はもう迎えきりました"
                              : "持てる頭数に届いています"}
                          </p>
                        )}
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      <section class="c-panel">
        <h2>🎽 勝負服</h2>
        <p class="c-muted">
          あなたの馬は、みんなこの勝負服で走ります（帽子の色は枠の色）。
        </p>
        <SilkForm csrf={csrf} silk={p.silk} />
      </section>
      <section class="c-panel">
        <h2>🆕 馬を買う</h2>
        {p.price <= 0 || p.max <= 0 ? (
          <p class="c-muted">いまは馬を買えません。</p>
        ) : active.length >= p.max ? (
          <p class="c-muted">
            持てるのは {p.max} 頭までです（引退させると、また買えます）。
          </p>
        ) : (
          <form
            method="post"
            action="/casino/keiba/stable/buy"
            class="c-bet-custom"
          >
            <Hidden />
            <label>
              馬の名前（1〜18 文字。ほかの馬と同じ名前はつけられません）
              <input
                type="text"
                name="name"
                maxlength={18}
                required
                placeholder="例: サクラノミヤビ"
              />
            </label>
            <button
              type="submit"
              class="c-btn c-btn-gold c-confirm"
              data-confirm={`${fmt(p.price)} ${coin.name}で馬を買いますか？（戻せません）`}
            >
              {coin.emoji}
              {fmt(p.price)} で買う
            </button>
          </form>
        )}
      </section>
      <section class="c-panel">
        <h2>💱 売りに出ている馬</h2>
        {p.forSale.length === 0 ? (
          <p class="c-muted">いまはありません。</p>
        ) : (
          <ul class="kb-market">
            {p.forSale.map((h) => (
              <li>
                <span>
                  <b>{h.name}</b>
                  <span class="c-muted">
                    {" "}
                    {classLabel(h)}・{KB_SEXES[h.sex]}
                    {h.age}・{h.starts} 戦 {h.wins} 勝・賞金 {fmt(h.prize)}
                    ・馬主 {h.ownerName ?? ""}
                  </span>
                </span>
                {h.ownerId === p.me.session.userId ? (
                  <span class="c-muted">あなたの馬</span>
                ) : (
                  <form
                    method="post"
                    action={`/casino/keiba/stable/buy/${h.id}`}
                  >
                    <Hidden />
                    <button
                      type="submit"
                      class="c-btn c-btn-small c-btn-gold c-confirm"
                      data-confirm={`${h.name} を ${fmt(h.salePrice ?? 0)} ${coin.name}で買いますか？`}
                    >
                      {coin.emoji}
                      {fmt(h.salePrice ?? 0)} で買う
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <p class="c-muted">
          売れると、値段から手数料 {KB_SALE_FEE}%
          を引いた銭が売った人に入ります。
        </p>
      </section>
      <Leading rows={p.leading} coin={coin} me={p.me.session.userId} />
      <section class="c-panel">
        <h2>📖 馬主のきまり</h2>
        <ul class="c-muted kb-owner-rules">
          <li>
            買った馬はまず「新馬」戦から。勝つと 未勝利 → 1 勝クラス → 2 勝 → 3
            勝 → オープン と上がり、オープンの馬は重賞（G3・G2・G1）にも出ます。
          </li>
          <li>
            強さ（速さ・スタミナ・脚質・得意な距離と馬場）は生まれつき。走ってみるまで分かりません。
          </li>
          <li>
            レースの 8
            頭は名簿から選ばれます。あなたがみんなでダービーの卓に座っていると、あなたの馬が優先して出走します。
          </li>
          <li>
            1〜5 着に入ると賞金（メンバーが賭けた合計の数
            %・クラスが上ほど多い）。
            {p.pay && p.pay.keibaPurse.some((v) => v > 0)
              ? `賭けが少なくても、1 着なら最低 ${fmt(p.pay.keibaPurse[0] ?? 0)}（新馬）〜 ${fmt(p.pay.keibaPurse[8] ?? 0)}（G1）は出ます。`
              : ""}
            着外でも出走手当が入ります。
          </li>
          {p.pay && p.pay.keibaFanPct > 0 && (
            <li>
              📣 応援金: ほかの人があなたの馬の単勝・複勝に賭けると、その{" "}
              {p.pay.keibaFanPct}% が着順に関係なく入ります。
            </li>
          )}
          {p.pay && p.pay.keibaRoyaltyPct > 0 && (
            <li>
              🧬 血統ロイヤリティ: あなたの繁殖馬の産駒が賞金を取ると、その{" "}
              {p.pay.keibaRoyaltyPct}%
              があなたにも入ります（産駒を売っても続きます）。
            </li>
          )}
          {p.pay && p.pay.keibaRetirePerWin > 0 && (
            <li>
              🎖 功労金: 引退させるとき（繁殖入りも）、1 勝につき{" "}
              {p.me.coin.emoji}
              {fmt(p.pay.keibaRetirePerWin)}（重賞の勝ちは 3 倍）が入ります。
            </li>
          )}
          <li>
            💪 調教（6 時間に 1 回）: 次のレースの調子が 1
            つ上がり、速さも少し伸びます。疲れが少したまります。
          </li>
          <li>
            🌿 疲れ: 1 走で 25 たまり、1 時間に 10 抜けます。50 から調子 −1、80
            からは出走しません。放牧すると 1
            時間休む代わりに疲れがすっかり抜けます。
          </li>
          <li>
            🌸 1
            勝以上した馬は、引退して繁殖入りできます。親の能力を受け継ぎやすい産駒を、半額で{" "}
            {KB_FOALS_MAX} 頭まで迎えられます。
          </li>
          <li>
            💱 自分の馬に値段をつけて売りに出せます。馬主の馬が勝つと、Discord
            でお祝いが流れることがあります。
          </li>
        </ul>
      </section>
    </CasinoLayout>
  );
}
