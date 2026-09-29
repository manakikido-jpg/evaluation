import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { activityDaily, members, omikuji, onboardingDone, shuin } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { addCoins } from './economy.js';

/**
 * 「はじめての参拝」: 入ったばかりの人が、サーバーの遊び方をひと通り試せるようにするチェックリスト。
 * おみくじ・朱印・通話 を全部できたら、お祝いの花びら（1 人 1 回）。
 * /はじめて で進み具合を見られる。BOT も 10 分ごとに確かめて、できた人にはお祝いを送る。
 */

export type OnboardingKey = 'omikuji' | 'shuin' | 'voice';
export type OnboardingStep = { key: OnboardingKey; label: string; hint: string; done: boolean };
export type OnboardingProgress = { steps: OnboardingStep[]; allDone: boolean; rewarded: boolean };

/** 通話は合わせてこの分数 */
export const ONBOARDING_VOICE_MINUTES = 10;
/** BOT が自動で確かめるのは、入ってからこの日数まで */
const WATCH_DAYS = 60;
const DAY = 86_400_000;

const link = (id: string | undefined, name: string) => (id ? `<#${id}>` : `#${name}`);

export async function onboardingOf(db: Db, cfg: GuildConfig, memberId: string, roleIds?: readonly string[]): Promise<OnboardingProgress> {
  const [drew] = await db.select({ n: sql<number>`1` }).from(omikuji).where(eq(omikuji.memberId, memberId)).limit(1);
  const [gave] = await db.select({ n: sql<number>`1` }).from(shuin).where(eq(shuin.giverId, memberId)).limit(1);
  const [vc] = await db
    .select({ minutes: sql<number>`coalesce(sum(${activityDaily.vcMinutes}), 0)::int` })
    .from(activityDaily)
    .where(eq(activityDaily.memberId, memberId));
  const roles = roleIds ?? (await db.select({ roleIds: members.roleIds }).from(members).where(eq(members.id, memberId)))[0]?.roleIds ?? [];
  const [done] = await db.select().from(onboardingDone).where(eq(onboardingDone.memberId, memberId));
  const coin = cfg.economy.currencyName;
  const steps: OnboardingStep[] = [
    { key: 'omikuji', label: 'おみくじを引く', hint: `${link(cfg.channels.omikuji, 'おみくじ')} で \`/おみくじ\`（毎日${coin}がもらえます）`, done: Boolean(drew) },
    { key: 'shuin', label: 'だれかに朱印を押す', hint: '相手の名前を右クリック（スマホは長押し）→「アプリ」→「プロフィール」→「🌸 朱印を押す」', done: Boolean(gave) },
    {
      key: 'voice',
      label: `通話に ${ONBOARDING_VOICE_MINUTES} 分いる`,
      hint: `拝殿や、募集している人の通話へ（いま ${Math.min(vc?.minutes ?? 0, ONBOARDING_VOICE_MINUTES)}/${ONBOARDING_VOICE_MINUTES} 分）`,
      done: (vc?.minutes ?? 0) >= ONBOARDING_VOICE_MINUTES,
    },
  ];
  return { steps, allDone: steps.every((s) => s.done), rewarded: Boolean(done) };
}

export type ClaimResult = { status: 'rewarded'; amount: number } | { status: 'already' | 'not_yet' };

/** 全部できていれば、お祝いを渡す（1 人 1 回） */
export async function claimOnboarding(db: Db, cfg: GuildConfig, memberId: string, roleIds?: readonly string[]): Promise<ClaimResult> {
  const p = await onboardingOf(db, cfg, memberId, roleIds);
  if (p.rewarded) return { status: 'already' };
  if (!p.allDone) return { status: 'not_yet' };
  const amount = cfg.economy.onboardingReward;
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(onboardingDone).values({ memberId, reward: amount }).onConflictDoNothing().returning();
    if (!row) return { status: 'already' as const };
    if (amount > 0) await addCoins(tx, memberId, amount, 'onboarding', {});
    return { status: 'rewarded' as const, amount };
  });
}

/** /はじめて と DM の文面 */
export function onboardingText(cfg: GuildConfig, p: OnboardingProgress, claimed?: ClaimResult): string {
  const e = cfg.economy;
  const done = p.steps.filter((s) => s.done).length;
  const lines = [
    `# 🌸 はじめての参拝（${done}/${p.steps.length}）`,
    ...p.steps.map((s) => (s.done ? `✅ ~~${s.label}~~` : `⬜ **${s.label}**\n-# ${s.hint}`)),
    '',
  ];
  if (claimed?.status === 'rewarded') {
    lines.push(`🎉 全部できました！お祝いに ${e.currencyEmoji}${e.currencyName} を ${claimed.amount} 枚お渡ししました。`);
  } else if (p.rewarded) {
    lines.push('🎉 全部できています。これからも咲楽ノ宮をお楽しみください。');
  } else {
    lines.push(
      e.onboardingReward > 0 ? `全部できたら、お祝いに ${e.currencyEmoji}${e.currencyName} ${e.onboardingReward} 枚をお渡しします。` : '全部できたら、咲楽ノ宮の遊び方はばっちりです。',
    );
    lines.push('-# 困ったことは `/相談` から、匿名で神職に聞けます');
  }
  return lines.join('\n');
}

/**
 * 10 分ごと: 最近入った人（参拝者以上）で、全部できた人にお祝いを渡して DM で知らせる。
 */
export async function onboardingTick(ctx: { db: Db; cfg: GuildConfig; discord: Pick<DiscordActions, 'sendDm'> }, now = new Date()): Promise<string[]> {
  const rankRoles = ctx.cfg.ranks.map((r) => r.roleId);
  if (!rankRoles.length) return [];
  const rows = await ctx.db
    .select({ id: members.id, roleIds: members.roleIds })
    .from(members)
    .leftJoin(onboardingDone, eq(onboardingDone.memberId, members.id))
    .where(and(isNull(members.leftAt), eq(members.isBot, false), gte(members.joinedAt, new Date(now.getTime() - WATCH_DAYS * DAY)), isNull(onboardingDone.memberId)));
  const done: string[] = [];
  for (const m of rows) {
    if (!m.roleIds.some((r) => rankRoles.includes(r))) continue;
    const r = await claimOnboarding(ctx.db, ctx.cfg, m.id, m.roleIds);
    if (r.status !== 'rewarded') continue;
    done.push(m.id);
    const p = await onboardingOf(ctx.db, ctx.cfg, m.id, m.roleIds);
    await ctx.discord.sendDm(m.id, onboardingText(ctx.cfg, p, r)).catch((err: unknown) => logger.warn({ err }, 'onboarding dm failed'));
  }
  return done;
}
