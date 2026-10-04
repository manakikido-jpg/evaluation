import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseGuildConfig, type GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { activityDaily, applications, bells, memberEvents, omairi, soudan } from '../src/db/schema.js';
import type { MessageBody } from '../src/lib/discordRest.js';
import { recordJoin } from '../src/services/members.js';
import { ago, isQuiet, opsWeekly, opsWeeklyText, opsWeeklyTick, staleItems, staleTick } from '../src/services/opsWatch.js';
import { cfg as baseCfg, makeDb } from './helpers.js';

const STAFF = '910000000000000077';
const cfg: GuildConfig = parseGuildConfig({ ...baseCfg, admin: { ...baseCfg.admin, shinshokuRoleIds: [STAFF] } });
const A = '700000000000000301';
const B = '700000000000000302';
const C = '700000000000000303';
// 2026-10-05（月）12:00 日本時間
const NOW = new Date('2026-10-05T03:00:00Z');
const H = 3_600_000;

let db: Db;
let close: () => Promise<void>;
let sent: { channel: string; body: MessageBody }[];
const discord = {
  sendMessage: async (channel: string, body: MessageBody) => {
    sent.push({ channel, body });
    return { id: '1' };
  },
} as never;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  sent = [];
  for (const [id, name] of [
    [A, 'あやめ'],
    [B, 'ぼたん'],
    [C, 'ちどり'],
  ] as const)
    await recordJoin(db, { id, username: id, displayName: name, avatarUrl: null, roleIds: [], isBot: false, joinedAt: new Date('2026-09-01') });
});
afterEach(async () => {
  await close();
});

describe('⏰ 対応待ちのお知らせ', () => {
  it('決めた時間そのままの申請・相談・お参り判定・呼び鈴を拾う（新しいものは拾わない）', async () => {
    await db.insert(applications).values([
      { memberId: A, kind: 'join', createdAt: new Date(NOW.getTime() - 13 * H) },
      { memberId: B, kind: 'join', createdAt: new Date(NOW.getTime() - 2 * H) },
      { memberId: C, kind: 'yoimairi', createdAt: new Date(NOW.getTime() - 20 * H) },
    ]);
    await db.insert(soudan).values({ createdAt: new Date(NOW.getTime() - 30 * H) });
    await db.insert(omairi).values({ memberId: B, endsAt: new Date(NOW.getTime() - 25 * H), status: 'review' });
    await db.insert(bells).values([
      { memberId: A, createdAt: new Date(NOW.getTime() - 45 * 60_000) },
      { memberId: B, createdAt: new Date(NOW.getTime() - 5 * 60_000) },
    ]);
    const items = await staleItems(db, cfg, NOW);
    expect(items.map((x) => x.kind).sort()).toEqual(['bell', 'join', 'omairi', 'soudan', 'yoimairi']);
    expect(items.find((x) => x.kind === 'soudan')?.memberId).toBeNull();
    // 0 にした種類は拾わない
    const off = parseGuildConfig({ ...cfg, opsWatch: { ...cfg.opsWatch, bellMinutes: 0, soudanHours: 0 } });
    expect((await staleItems(db, off, NOW)).map((x) => x.kind).sort()).toEqual(['join', 'omairi', 'yoimairi']);
  });

  it('1 回だけ知らせて、まだそのままなら 1 日後（呼び鈴は 3 時間後）にもう一度。夜は待つ。神職のロールに通知', async () => {
    await db.insert(applications).values({ memberId: A, kind: 'join', createdAt: new Date(NOW.getTime() - 13 * H) });
    expect(await staleTick({ db, cfg, discord }, NOW)).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.channel).toBe(cfg.channels.log);
    const text = sent[0]!.body.content!;
    expect(text).toContain(`<@&${STAFF}>`);
    expect(text).toContain('入鯖申請** 1 件（いちばん古いのは 13 時間前: あやめ）');
    expect(sent[0]!.body.allowed_mentions).toEqual({ parse: [], roles: [STAFF] });
    // 10 分後: 同じものは知らせない
    expect(await staleTick({ db, cfg, discord }, new Date(NOW.getTime() + 10 * 60_000))).toBe('none');
    // 新しくそのままになった呼び鈴があれば、まとめてもう一度（申請は「まだそのまま」）
    await db.insert(bells).values({ memberId: B, createdAt: new Date(NOW.getTime() - 40 * 60_000) });
    expect(await staleTick({ db, cfg, discord }, new Date(NOW.getTime() + 20 * 60_000))).toBe('sent');
    expect(sent[1]!.body.content).toContain('呼び鈴（だれも対応していない）** 1 件');
    expect(sent[1]!.body.content).toContain('…まだそのままです');
    // 1 日たってもそのまま: もう一度
    expect(await staleTick({ db, cfg, discord }, new Date(NOW.getTime() + 25 * H))).toBe('sent');
    // 夜（日本時間 1〜8 時）は待つ
    const night = new Date('2026-10-05T18:30:00Z'); // 3:30 JST
    expect(isQuiet(cfg, night)).toBe(true);
    expect(await staleTick({ db, cfg, discord }, night)).toBe('quiet');
    // 通知なし・止める
    const quietCfg = parseGuildConfig({ ...cfg, opsWatch: { ...cfg.opsWatch, mention: false } });
    sent = [];
    await db.insert(soudan).values({ createdAt: new Date(NOW.getTime() - 30 * H) });
    expect(await staleTick({ db, cfg: quietCfg, discord }, new Date(NOW.getTime() + 26 * H))).toBe('sent');
    expect(sent[0]!.body.content).not.toContain('<@&');
    expect(await staleTick({ db, cfg: parseGuildConfig({ ...cfg, opsWatch: { ...cfg.opsWatch, remindEnabled: false } }), discord }, NOW)).toBe('off');
  });

  it('どのくらい前か', () => {
    expect(ago(new Date(NOW.getTime() - 45 * 60_000), NOW)).toBe('45 分前');
    expect(ago(new Date(NOW.getTime() - 14 * H), NOW)).toBe('14 時間前');
    expect(ago(new Date(NOW.getTime() - 72 * H), NOW)).toBe('3 日前');
  });
});

describe('🗓 週報', () => {
  const day = (back: number) => {
    const j = new Date(NOW.getTime() + 9 * H - back * 24 * H);
    return j.toISOString().slice(0, 10);
  };

  it('出入り・にぎわい（先週との比べ）・よく来た人・静かになった人・対応の数', async () => {
    // 用意で入れた「入った」の記録は使わない
    await db.delete(memberEvents);
    await db.insert(memberEvents).values([
      { memberId: C, kind: 'join', at: new Date(NOW.getTime() - 20 * 24 * H) },
      { memberId: C, kind: 'join', at: new Date(NOW.getTime() - 1 * 24 * H) },
      { memberId: A, kind: 'leave', at: new Date(NOW.getTime() - 2 * 24 * H) },
      { memberId: B, kind: 'promote', at: new Date(NOW.getTime() - 3 * 24 * H) },
    ]);
    await db.insert(activityDaily).values([
      // この 1 週間: B がよく来た
      { memberId: B, date: day(1), messageCount: 10, vcMinutes: 180 },
      { memberId: B, date: day(3), messageCount: 5, vcMinutes: 60 },
      // 先週: B と C。C はこの 1 週間来ていない → 静かになった人
      { memberId: B, date: day(9), messageCount: 3, vcMinutes: 30 },
      { memberId: C, date: day(10), messageCount: 20, vcMinutes: 300 },
    ]);
    await db.insert(applications).values([
      { memberId: A, kind: 'join', status: 'approved', reviewedAt: new Date(NOW.getTime() - 24 * H), createdAt: new Date(NOW.getTime() - 30 * H) },
      { memberId: C, kind: 'join', createdAt: new Date(NOW.getTime() - 5 * H) },
    ]);
    await db.insert(bells).values({ memberId: B, status: 'done', createdAt: new Date(NOW.getTime() - 24 * H), takenAt: new Date(NOW.getTime() - 24 * H + 12 * 60_000) });
    // この 1 週間のものだけ数える
    const w = await opsWeekly(db, NOW);
    expect(w.joins).toBe(1);
    expect(w.leaves).toBe(1);
    expect(w.promotions).toBe(1);
    expect(w.messages).toBe(15);
    expect(w.prevMessages).toBe(23);
    expect(w.vcMinutes).toBe(240);
    expect(w.activeMembers).toBe(1);
    expect(w.quiet.map((q) => q.name)).toEqual(['ちどり']);
    expect(w.top.map((t) => t.name)).toEqual(['ぼたん']);
    expect(w.apps).toMatchObject({ handled: 1, pending: 1 });
    expect(w.bells).toMatchObject({ rung: 1, avgTakeMinutes: 12, open: 0 });
    const t = opsWeeklyText(w, NOW, 'https://example.test');
    expect(t.description).toContain('いま 3 人（この 1 週間で +0）');
    expect(t.description).toContain('静かになった人');
    expect(t.description).toContain('ちどり');
    expect(t.description).toContain('ぼたん（4 時間）');
    expect(t.description).toContain('対応までの平均 12 分');
    expect(t.description).toContain('https://example.test/');
  });

  it('決めた曜日・時（月曜 9 時）に 1 回だけ流す', async () => {
    const mon9 = new Date('2026-10-05T00:10:00Z'); // 月曜 9:10 JST
    expect(await opsWeeklyTick({ db, cfg, discord }, new Date('2026-10-05T01:10:00Z'))).toBe('not_time');
    expect(await opsWeeklyTick({ db, cfg, discord }, mon9)).toBe('sent');
    expect(sent[0]!.body.embeds?.[0]?.title).toBe('🗓 今週の咲楽ノ宮');
    expect(await opsWeeklyTick({ db, cfg, discord }, new Date(mon9.getTime() + 10 * 60_000))).toBe('already');
    expect(await opsWeeklyTick({ db, cfg: parseGuildConfig({ ...cfg, opsWatch: { ...cfg.opsWatch, reportEnabled: false } }), discord }, mon9)).toBe('off');
  });
});
