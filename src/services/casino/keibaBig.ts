import { and, eq } from 'drizzle-orm';
import type { GuildConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import { casinoTables } from '../../db/schema.js';
import type { DiscordActions } from '../../lib/discordRest.js';
import { logger } from '../../lib/logger.js';
import { jstDate } from '../activity.js';
import { KB_CLASSES } from './keiba.js';
import { loadRoster } from './keibaStable.js';
import { BIG_MIN, bigField } from './tables/keiba.js';
import { createTable } from './tables/service.js';

/**
 * 🏆 決まった時刻の大レース。1 分ごとに呼ぶ。
 * 30 分前: 予告（出走予定）／ 10 分前: BOT が卓を開いて受付（4 頭そろわなければ中止を知らせる）／ 時刻: 発走（卓が自動で走らせる）
 */

export const BIG_HOST = { id: 'bot:keiba', name: '🏇 咲楽ノ宮競馬会' };
export const BIG_NOTICE_MIN = 30;
export const BIG_OPEN_MIN = 10;

type Slot = GuildConfig['casino']['keibaBigRaces'][number];
type Ctx = { db: Db; cfg: GuildConfig; discord: Pick<DiscordActions, 'sendMessage'>; baseUrl?: string };

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
export const slotLabel = (s: Slot) => `${s.day < 0 ? '毎日' : `毎週${WEEK[s.day]}曜`} ${s.time}「${s.name}」（${KB_CLASSES[s.cls]}）`;

/** その日（日本時間）の発走時刻。曜日が合わなければ undefined */
export function startOf(slot: Slot, now: Date): Date | undefined {
  const day = jstDate(now);
  const at = new Date(`${day}T${slot.time}:00+09:00`);
  const weekday = new Date(`${day}T12:00:00+09:00`).getUTCDay();
  if (slot.day >= 0 && slot.day !== weekday) return undefined;
  return at;
}

/** いまが発走の何分前か（ちょうどの分だけ）。次の日の 0 時をまたぐ分も見る */
function minutesBefore(slot: Slot, now: Date): { at: Date; left: number } | undefined {
  for (const d of [0, 1]) {
    const at = startOf(slot, new Date(now.getTime() + d * 86_400_000));
    if (!at) continue;
    const left = Math.round((at.getTime() - Math.floor(now.getTime() / 60_000) * 60_000) / 60_000);
    if (left >= 0 && left <= BIG_NOTICE_MIN) return { at, left };
  }
  return undefined;
}

export async function keibaBigTick(ctx: Ctx, now = new Date()): Promise<void> {
  const c = ctx.cfg.casino;
  if (!c.enabled || !c.games.includes('keiba')) return;
  const say = async (content: string) => {
    if (!c.keibaAnnounceChannelId) return;
    await ctx.discord.sendMessage(c.keibaAnnounceChannelId, { content, allowed_mentions: { parse: [] } }).catch((err: unknown) => logger.warn({ err }, 'keiba big announce failed'));
  };
  for (const slot of c.keibaBigRaces) {
    const m = minutesBefore(slot, now);
    if (!m) continue;
    const title = `${slot.name}（${KB_CLASSES[slot.cls]}）`;
    const hhmm = slot.time;
    if (m.left === BIG_NOTICE_MIN) {
      const field = bigField(await loadRoster(ctx.db, now));
      await say(
        field.length >= BIG_MIN
          ? [`🏆 **${title}** は ${BIG_NOTICE_MIN} 分後（${hhmm}）に発走です。${BIG_OPEN_MIN} 分前から馬券の受付をはじめます。`, `出走予定: ${field.map((h) => h.name).join('・')}`].join('\n')
          : `🏆 **${title}**（${hhmm}）は、出られる馬（馬主のいるオープンの馬）が ${BIG_MIN} 頭そろっていません。このままだと中止です。`,
      );
    }
    if (m.left === BIG_OPEN_MIN) {
      const key = `${m.at.toISOString()}|${slot.name}`;
      const open = await ctx.db.select({ id: casinoTables.id, state: casinoTables.state }).from(casinoTables).where(and(eq(casinoTables.kind, 'keiba'), eq(casinoTables.status, 'open')));
      if (open.some((t) => (t.state as { big?: { key: string } }).big?.key === key)) continue;
      const r = await createTable(ctx.db, ctx.cfg, 'keiba', BIG_HOST, { big: '1', cls: String(slot.cls), title: slot.name, at: String(m.at.getTime()), key }, now);
      if (r.status === 'too_few') {
        await say(`🏆 **${title}** は、出られる馬（馬主のいるオープンの馬）が ${BIG_MIN} 頭そろわなかったので中止です。`);
        continue;
      }
      if (r.status !== 'ok' || !('table' in r)) {
        logger.warn({ status: r.status, slot }, 'keiba big race open failed');
        continue;
      }
      const link = ctx.baseUrl ? `\n${ctx.baseUrl}/casino/t/${r.table.id}` : '';
      await say(`🏆 **${title}** の馬券の受付をはじめました！ ${hhmm} 発走です。${link}`);
    }
  }
}

/** 社務所Web の書き方: 1 行に「曜日 時刻 クラス 名前」（例: 毎日 21:00 G2 咲楽ノ宮記念 / 日 22:00 G1 咲楽ノ宮大賞典） */
export const formatBigRaces = (slots: readonly Slot[]) => slots.map((s) => `${s.day < 0 ? '毎日' : WEEK[s.day]} ${s.time} ${s.cls === 8 ? 'G1' : 'G2'} ${s.name}`).join('\n');

export function parseBigRaces(text: string): Slot[] | undefined {
  const out: Slot[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(毎日|[日月火水木金土])曜?\s+(\d{1,2}):(\d{2})\s+(G1|G2)\s+(.{1,20})$/i.exec(line);
    if (!m) return undefined;
    const h = Number(m[2]);
    const min = Number(m[3]);
    if (h > 23 || min > 59) return undefined;
    out.push({ name: m[5]!.trim(), day: m[1] === '毎日' ? -1 : WEEK.indexOf(m[1]!), time: `${String(h).padStart(2, '0')}:${m[3]}`, cls: m[4]!.toUpperCase() === 'G1' ? 8 : 7 });
  }
  return out.length <= 10 ? out : undefined;
}
