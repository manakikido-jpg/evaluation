import { eq } from 'drizzle-orm';
import { settings } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import type { Db } from '../db/client.js';
import { DEFAULT_GUIDES, DEFAULT_NOTICES } from './noticeDefaults.js';
import { findChannel, guildChannelsCached, listNotices, publishNotice, updateNotice, type NoticeCtx } from './notices.js';
import { listTerms, syncGlossaryNotices, updateTerm } from './glossary.js';
import { MUSUBI_TERM_SWAPS, type GlossaryCategory } from './glossaryDefaults.js';
import { newSystemStartedAt } from './shuin.js';
import { setMusubiMode } from '../domain/terms.js';

/**
 * 🧵 新制度④c：呼び名の切り替え（御朱印 → 結び）を、掲示と用語集に当てる。
 *
 * ④ご縁のリセットで「新制度のご縁の時代」が始まったら（settings の new_system_started）、BOT が自動で切り替える。
 * - 掲示：標準の文面のまま（運営が手を入れていない）ものだけ、結びの文面に入れかえて投稿し直す。
 *   手を入れた掲示は勝手に変えず、「手で直してほしい掲示」として返す。
 * - #絵馬 などのいちばん下の「朱印を押す」ボタンは、言葉を変えて投稿し直す。
 * - 用語集：標準のままの用語だけ入れかえ、用語集の掲示を作り直して投稿し直す。
 * 元に戻す（リセットの取り消し）と、同じ決まりで逆向きに戻す。
 */

const key = (channelName: string, title: string) => `${channelName}\n${title}`;

/** 一部だけ言葉を入れかえる掲示（今の標準の文面 → 結び）。どれも文面にそのまま入っている文 */
const SWAPS: Record<string, [string, string][]> = {
  [key('鳥居', 'ようこそ')]: [
    ['咲楽ノ宮（さくらのみや）は、御朱印をテーマにした通話・雑談サーバーです。', '咲楽ノ宮（さくらのみや）は、ご縁をテーマにした通話・雑談サーバーです。'],
    ['いいなと思った人に **朱印** を押して、ご縁を結んでいきましょう。', '出会った人と **結び**、いいなと思った人には **絵馬** を贈って、ご縁を広げていきましょう。'],
    ['（おみくじ・朱印・通話）', '（おみくじ・結び・通話）'],
  ],
  [key('しきたり', '厄と BAN')]: [['厄年の間は朱印を押せません', '厄年の間は結べません']],
  [key('しきたり', '花びら・相談')]: [
    ['- 朱印を押すと {朱印を押すと} 枚、押してもらうと {朱印を頂くと} 枚', '- 結ぶと {朱印を押すと} 枚、結んでもらうと {朱印を頂くと} 枚'],
    ['残高は自分の御朱印帳（`/御朱印帳`）で見られます', '残高は自分のご縁帳（`/ご縁帳`）で見られます'],
  ],
  [key('しきたり', '用語集')]: [
    ['- **御朱印帳** … 自分の評価カード', '- **ご縁帳** … 自分のカード（ご縁・絵馬・自己紹介）'],
    [
      '- **朱印** … 評価スタンプ ／ **ご縁** … 評価ポイント ／ **格** … 朱印 1 回で渡せるご縁',
      '- **結び** … はじめましてのあいさつ（同じ人と 1 回） ／ **ご縁** … 結びでたまる数（節目でごほうび） ／ **絵馬** … 評価の票（集まると役職が上がる）',
    ],
  ],
  [key('しきたり', 'チャンネル案内')]: [['（おみくじ・朱印・通話）', '（おみくじ・結び・通話）']],
  [key('絵馬-男性', '使い方')]: [['🌸 自己紹介を読んで気になった人がいたら、下の **「朱印を押す」** ボタンから朱印を押せます', '🧵 自己紹介を読んで気になった人がいたら、下の **「結ぶ」** ボタンから結べます']],
  [key('絵馬-女性', '使い方')]: [['🌸 自己紹介を読んで気になった人がいたら、下の **「朱印を押す」** ボタンから朱印を押せます', '🧵 自己紹介を読んで気になった人がいたら、下の **「結ぶ」** ボタンから結べます']],
};

/** まるごと書きかえる掲示（しくみの説明そのものが変わるもの） */
const FULL: Record<string, string> = {
  [key('しきたり', '朱印とご縁')]: `# 🧵 結び・ご縁・絵馬
咲楽ノ宮では、出会った人と **結び**、いいなと思った人には **絵馬** を贈ります。

## 結び方
相手の名前を右クリック（スマホは長押し）→「アプリ」→ **プロフィール** → **結ぶ**
- 同じ人とは **1 回だけ**（間違えたら、結んだあとに出るボタンで取り消せます）
- 自分と BOT とは結べません
- 結ぶと相手の **ご縁** が増えます。ご縁が節目に届くと、ごほうびがあります（役職には使いません）

## ご縁帳を見る
右クリック →「アプリ」→ **プロフィール**、または \`/ご縁帳\`（自己紹介・性別・DM とフレンド・役職・ご縁・絵馬が見られます）

## 絵馬と役職
役職は **絵馬**（評価の票）で上がります。世話役だけは **選挙** で決まります（上がると {#慶事} で発表されます）。
氏子以上の方が、いっしょに過ごした相手に、匿名の一言をそえて絵馬を贈れます。
{役職一覧（絵馬）}
-# 一度上がった役職は、自動では下がりません

## 世話役の選挙
条件を満たした氏子の方は、その週の **金・土・日** に選挙があります（{#慶事} でお知らせします）。投票できる方は、その方のご縁帳の **🗳 お世話役になってほしい** から匿名で投票できます（もう一度押すと取り消し）。選挙中の方と、自分が投票できるかは \`/世話役の投票\` で見られます。
- {世話役の投票}

## お参り期間
入ってから **{お参り期間} 日** は「お参り期間」です。この間に氏子以上の方から絵馬（氏子の票）を集めて、🍃氏子を目指しましょう。
- 要る数は毎週きまります：{氏子の絵馬}
- 招待した人が参拝者になると、1人につき絵馬1つ分になります（{招待の補い}つまで）。お参り期間も1日のびます
届かなかったときは {お参り延長} 日延長され、それでも届かなければ神職が今後を決めます（退出になることもあります）。`,
};

/** 標準の掲示の、結びの文面（入れかえの対象でなければ undefined） */
export function musubiNoticeBody(channelName: string, title: string, body: string): string | undefined {
  const k = key(channelName, title);
  if (FULL[k] !== undefined) return FULL[k];
  const swaps = SWAPS[k];
  if (!swaps) return undefined;
  let out = body;
  for (const [from, to] of swaps) out = out.split(from).join(to);
  return out;
}

/** 入れかえの対象の標準の掲示（今の文面と結びの文面） */
export function musubiNoticeTemplates(): { channelName: string; title: string; from: string; to: string }[] {
  const out: { channelName: string; title: string; from: string; to: string }[] = [];
  for (const t of [...DEFAULT_NOTICES, ...DEFAULT_GUIDES]) {
    const to = musubiNoticeBody(t.channelName, t.title, t.body);
    if (to !== undefined && to !== t.body) out.push({ channelName: t.channelName, title: t.title, from: t.body, to });
  }
  return out;
}

/**
 * 掲示を結びの文面に（on=false なら元の文面に）切り替えて、投稿ずみのものを出し直す。
 * 運営が手を入れた掲示は変えず、custom に名前を返す（手で直してもらう）。
 */
export async function syncMusubiNotices(ctx: NoticeCtx, on: boolean, by: string): Promise<{ changed: number; republished: number; custom: string[] }> {
  const channels = await guildChannelsCached(ctx.discord, ctx.cfg.guildId, true);
  const list = await listNotices(ctx.db);
  const changed = new Set<number>();
  const custom: string[] = [];
  for (const t of musubiNoticeTemplates()) {
    const ch = findChannel(channels, t.channelName);
    if (!ch) continue;
    const [from, to] = on ? [t.from, t.to] : [t.to, t.from];
    for (const n of list.filter((x) => x.channelId === ch.id && x.title === t.title)) {
      if (n.body === from) {
        await updateNotice(ctx.db, n.id, { title: n.title, body: to, by });
        changed.add(n.id);
      } else if (n.body !== to) {
        custom.push(`#${t.channelName}「${t.title}」`);
      }
    }
  }
  // 文面を変えたもの＋「朱印を押す」ボタン付きの掲示（ボタンの言葉が変わる）を、投稿ずみなら出し直す
  let republished = 0;
  for (const n of list) {
    if (!n.messageId || !(changed.has(n.id) || n.shuinButton)) continue;
    try {
      await publishNotice(ctx, n.id, by);
      republished++;
    } catch (err) {
      logger.warn({ err, id: n.id }, 'musubi notice republish failed');
    }
  }
  return { changed: changed.size, republished, custom };
}

/** 用語集を結びの言葉に（on=false なら元に）。標準のままの用語だけ入れかえ、用語集の掲示を作り直して出し直す */
export async function syncMusubiGlossary(ctx: NoticeCtx, on: boolean, by: string): Promise<number> {
  const terms = await listTerms(ctx.db);
  let changed = 0;
  for (const s of MUSUBI_TERM_SWAPS) {
    const [from, to] = on ? [s.from, s.to] : [s.to, s.from];
    const row = terms.find((t) => t.category === s.category && t.term === from.term && t.description === from.description);
    if (!row) continue;
    await updateTerm(ctx.db, row.id, { category: row.category as GlossaryCategory, term: to.term, reading: to.reading ?? '', emoji: to.emoji ?? '', description: to.description, aliases: row.aliases }, by);
    changed++;
  }
  if (!changed) return 0;
  // 用語集の掲示を作り直し、本文が変わった投稿ずみの掲示を出し直す
  const before = new Map((await listNotices(ctx.db)).map((n) => [n.id, n.body]));
  await syncGlossaryNotices(ctx, by).catch((err) => logger.warn({ err }, 'musubi glossary notice sync failed'));
  for (const n of await listNotices(ctx.db)) {
    if (!n.messageId || before.get(n.id) === n.body) continue;
    await publishNotice(ctx, n.id, by).catch((err) => logger.warn({ err, id: n.id }, 'musubi glossary republish failed'));
  }
  return changed;
}

const APPLIED_KEY = 'musubi_applied';

/** 最後に当てた呼び名（BOT が止まっていた間の切り替えも、次の起動で当てられるよう覚えておく） */
export async function musubiApplied(db: Db): Promise<boolean> {
  const [row] = await db.select().from(settings).where(eq(settings.key, APPLIED_KEY));
  return (row?.value as { on?: boolean } | undefined)?.on === true;
}

export async function setMusubiApplied(db: Db, on: boolean): Promise<void> {
  await db
    .insert(settings)
    .values({ key: APPLIED_KEY, value: { on }, updatedBy: 'system' })
    .onConflictDoUpdate({ target: settings.key, set: { value: { on }, updatedBy: 'system', updatedAt: new Date() } });
}

/**
 * 🧵 BOT の毎分の呼び名の切り替え（index.ts から使う）。
 * - ④の印（new_system_started）を見て言葉を決める（setMusubiMode）。
 * - 登録したときの言葉とずれたら、コマンドの表示名を登録し直す（registerCommands）。
 * - 最後に当てた言葉（musubi_applied）とずれたら、掲示・用語集を切り替えて出し直し、#記録 に知らせる。
 * 同時に二重に動かない。BOT が止まっていた間の切り替えも、次に呼んだときに当てる。
 */
export function createMusubiSync(deps: {
  db: Db;
  cfg: () => NoticeCtx['cfg'];
  discord: NoticeCtx['discord'];
  registerCommands: () => Promise<void>;
  /** 起動時に登録したときの言葉 */
  registered: boolean;
}): () => Promise<{ on: boolean; reregistered: boolean; applied?: { changed: number; republished: number; custom: string[]; terms: number } } | undefined> {
  let registered = deps.registered;
  let busy = false;
  return async () => {
    if (busy) return undefined;
    busy = true;
    try {
      const on = Boolean(await newSystemStartedAt(deps.db));
      setMusubiMode(on);
      let reregistered = false;
      if (on !== registered) {
        await deps.registerCommands();
        registered = on;
        reregistered = true;
      }
      if (on === (await musubiApplied(deps.db))) return { on, reregistered };
      const ctx = { db: deps.db, cfg: deps.cfg(), discord: deps.discord };
      const r = await syncMusubiNotices(ctx, on, 'system');
      const terms = await syncMusubiGlossary(ctx, on, 'system');
      await setMusubiApplied(deps.db, on);
      const log = ctx.cfg.channels.log;
      if (log) {
        const custom = r.custom.length ? `\n手を入れてある掲示は自動では変えていません。手で直してください：${r.custom.join('・')}` : '';
        await deps.discord
          .sendMessage(log, { content: `🧵 呼び名を「${on ? '結び' : '御朱印'}」に切り替えました（掲示 ${r.changed} 件・用語 ${terms} 件・出し直し ${r.republished} 件）。${custom}`, allowed_mentions: { parse: [] } })
          .catch(() => undefined);
      }
      return { on, reregistered, applied: { ...r, terms } };
    } catch (err) {
      logger.warn({ err }, 'musubi terms sync failed');
      return undefined;
    } finally {
      busy = false;
    }
  };
}
