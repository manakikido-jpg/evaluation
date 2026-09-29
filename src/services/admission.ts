import { adminLevelOf, type GuildConfig } from '../config.js';
import { autoRanks, currentAutoRank } from '../domain/ranks.js';
import { logger } from '../lib/logger.js';
import {
  decideApplication,
  dueOmairi,
  extendOmairi,
  getApplication,
  getOmairi,
  setAgeGroup,
  setOmairiStatus,
  startOmairi,
  submitApplication,
  type ApplicationKind,
} from './applications.js';
import { audit } from './audit.js';
import { getMember } from './members.js';
import { activeYakuCount } from './yaku.js';
import { grantJoinBonus } from './economy.js';
import { inviterOf, recordInvite, rewardInviter } from './invites.js';
import { CONTACT_KINDS, isContactLevel, setContact, type ContactLevel } from './contact.js';
import { checkTarget, SYSTEM, type Actor, type ModCtx } from './moderation.js';
import { appendFromStaff, getSoudan, senderOf, setSoudanStatus } from './soudan.js';

/**
 * 入鯖申請・宵参り申請・お参り期間・年齢区分・相談の返信。
 * BOT（Discord のボタン）と管理画面の両方から同じ処理を使う。
 */

const SIGN = '⛩ 咲楽ノ宮 社務所より';
const DAY = 86_400_000;

async function safely(what: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    logger.warn({ err, what }, 'discord action failed');
    return false;
  }
}

export type AgeGroup = 'minor' | 'adult';

export type Gender = 'male' | 'female';
export const GENDER_LABEL: Record<Gender, string> = { male: '男性', female: '女性' };
export const isGender = (v: unknown): v is Gender => v === 'male' || v === 'female';

export type JoinAnswers = { name: string; age: AgeGroup; gender?: Gender; dm?: ContactLevel; friend?: ContactLevel; inviter?: string; purpose: string; message: string };

/** 自己紹介を書くチャンネル（女性は #絵馬-女性、ほかは #絵馬-男性） */
export function introChannelOf(cfg: ModCtx['cfg'], gender: Gender | undefined): string | undefined {
  return gender === 'female' ? (cfg.channels.emaFemale ?? cfg.channels.ema) : cfg.channels.ema;
}

/** 性別のロール */
export function genderRoleOf(cfg: ModCtx['cfg'], gender: Gender | undefined): string | undefined {
  return gender === 'female' ? cfg.roles.female : gender === 'male' ? cfg.roles.male : undefined;
}

/** ロールから性別 */
export function genderOfRoles(cfg: ModCtx['cfg'], roleIds: readonly string[]): Gender | undefined {
  if (cfg.roles.female && roleIds.includes(cfg.roles.female)) return 'female';
  if (cfg.roles.male && roleIds.includes(cfg.roles.male)) return 'male';
  return undefined;
}

/**
 * 入鯖を仕上げる: 🔰参拝者 にして、お参り期間を始め、初期配布を渡し、ようこその DM を送る。
 * 自己紹介を書いたとき（絵馬待ちがあるとき）か、承認したとき（絵馬待ちがないとき）に呼ぶ。
 */
export async function completeJoin(ctx: ModCtx, memberId: string, now = new Date(), opts: { introChannelId?: string; introUrl?: string } = {}): Promise<boolean> {
  const g = ctx.cfg.guildId;
  const first = autoRanks(ctx.cfg.ranks)[0];
  if (first) await safely('add first rank', () => ctx.discord.addRole(g, memberId, first.roleId, '入鯖（自己紹介を書いた・承認）'));
  // BAN を解除して入り直した人などで厄が残っていれば、👹厄年 を付け直す
  const yakudoshi = ctx.cfg.roles.yakudoshi;
  if (yakudoshi && (await activeYakuCount(ctx.db, memberId)) > 0) {
    await safely('add yakudoshi', () => ctx.discord.addRole(g, memberId, yakudoshi, '厄が残っている'));
  }
  await startOmairi(ctx.db, memberId, ctx.cfg.omairi.days, now);
  // 初期配布（1 人 1 回。入り直した人にはもう配らない）
  const e = ctx.cfg.economy;
  const bonus = await grantJoinBonus(ctx.db, memberId, e.joinBonus);
  // 招待してくれた人にお礼（1 回だけ）
  await rewardInviter(ctx, memberId, now).catch((err: unknown) => logger.warn({ err }, 'invite reward failed'));
  // #お出迎え に「参拝しました」（通知は飛ばさない）
  const welcome = ctx.cfg.channels.welcome;
  const invitedBy = welcome ? await inviterOf(ctx.db, memberId).catch(() => undefined) : undefined;
  if (welcome) {
    await safely('welcome post', () =>
      ctx.discord.sendMessage(welcome, {
        content: [
          `🌸 <@${memberId}> さんが参拝しました！`,
          'みなさん、ひと声かけてあげてください。',
          ...(opts.introUrl ? [`📝 自己紹介: ${opts.introUrl}`] : []),
          ...(invitedBy ? [`🤝 招待: <@${invitedBy}> さん`] : []),
        ].join('\n'),
      }),
    );
  }
  return ctx.discord.sendDm(
    memberId,
    [
      SIGN,
      `ようこそ、咲楽ノ宮へお参りくださいました。`,
      ...(opts.introChannelId ? [`まだの方は、<#${opts.introChannelId}> に自己紹介を書いてください（いちばん下のひな形をコピーして使えます）。`] : []),
      `今日から ${ctx.cfg.omairi.days} 日間は「お参り期間」です。いいと思った方に朱印を押し、ご縁を結んでいってください。`,
      '相手の名前を右クリック（スマホは長押し）→「アプリ」→「プロフィール」→「🌸 朱印を押す」でできます。',
      ...(bonus > 0 ? [`お近づきのしるしに ${e.currencyEmoji}${e.currencyName} を ${bonus} 枚お渡ししました。`] : []),
      '',
      `まずは \`/はじめて\` で「はじめての参拝」（おみくじ・朱印・通話）を見てみてください。${e.onboardingReward > 0 ? `全部できたら ${e.currencyEmoji}${e.onboardingReward} 枚のお祝いがあります。` : ''}`,
    ].join('\n'),
  );
}

export type IntroResult = { status: 'not_pending' } | { status: 'wrong_channel'; expected: string } | { status: 'too_short' } | { status: 'completed' };

/** 自己紹介を書かないと入れない、の最低の文字数（空白を除く） */
export const INTRO_MIN_CHARS = 10;

/**
 * #絵馬-男性・#絵馬-女性 に書き込まれたとき。絵馬待ちの人なら、自分の性別のチャンネルかを確かめて、入鯖を仕上げる。
 * content が undefined（BOT が本文を読めない。Discord の「Message Content」がオフ）のときは、長さは確かめない。
 */
export async function onIntroPosted(
  ctx: ModCtx,
  author: { id: string; roleIds: readonly string[] },
  channelId: string,
  content: string | undefined,
  now = new Date(),
  messageId?: string,
): Promise<IntroResult> {
  const pending = ctx.cfg.roles.emaPending;
  if (!pending || !author.roleIds.includes(pending)) return { status: 'not_pending' };
  const expected = introChannelOf(ctx.cfg, genderOfRoles(ctx.cfg, author.roleIds));
  if (expected && channelId !== expected) return { status: 'wrong_channel', expected };
  if (content !== undefined && content.replace(/\s/g, '').length < INTRO_MIN_CHARS) return { status: 'too_short' };
  await safely('remove ema pending', () => ctx.discord.removeRole(ctx.cfg.guildId, author.id, pending, '自己紹介を書いた'));
  await completeJoin(ctx, author.id, now, messageId ? { introUrl: `https://discord.com/channels/${ctx.cfg.guildId}/${channelId}/${messageId}` } : {});
  await audit(ctx.db, { actorId: author.id, targetId: author.id, action: 'join.intro', detail: { channelId }, via: 'discord' });
  return { status: 'completed' };
}

// ───────── 入鯖申請 ─────────

export type SubmitJoinResult =
  | { status: 'pending'; id: number }
  | { status: 'auto_approved'; id: number }
  | { status: 'duplicate' }
  | { status: 'already_member' }
  | { status: 'pending_intro'; channelId?: string };

/** 入鯖申請を出す。アカウントが十分古ければ自動で承認（半自動モード） */
export async function submitJoin(
  ctx: ModCtx,
  applicant: { id: string; roleIds: readonly string[]; accountCreatedAt: Date },
  answers: JoinAnswers,
  now = new Date(),
): Promise<SubmitJoinResult> {
  if (ctx.cfg.ranks.some((r) => applicant.roleIds.includes(r.roleId))) return { status: 'already_member' };
  // 承認済みで、自己紹介がまだの人
  if (ctx.cfg.roles.emaPending && applicant.roleIds.includes(ctx.cfg.roles.emaPending)) {
    return { status: 'pending_intro', channelId: introChannelOf(ctx.cfg, genderOfRoles(ctx.cfg, applicant.roleIds)) };
  }
  const r = await submitApplication(ctx.db, { memberId: applicant.id, kind: 'join', answers });
  if (r.status === 'duplicate') return r;

  const days = ctx.cfg.applications.autoApproveAccountDays;
  if (days > 0 && now.getTime() - applicant.accountCreatedAt.getTime() >= days * DAY) {
    await decide(ctx, SYSTEM, r.id, true, '半自動承認（アカウント作成から十分な日数）', now);
    return { status: 'auto_approved', id: r.id };
  }
  return { status: 'pending', id: r.id };
}

export type SubmitYoimairiResult =
  | { status: 'pending'; id: number }
  | { status: 'auto_approved'; id: number; dmSent: boolean }
  | { status: 'auto_rejected'; id: number }
  | { status: 'duplicate' }
  | { status: 'not_adult' }
  | { status: 'already' }
  | { status: 'disabled' };

const normRoleName = (name: string) => name.normalize('NFKC').replace(/\s/g, '');
const MINOR_NAME = /1[0-7][歳才]以下|18[歳才]未満|未成年/;
const ADULT_NAME = /(1[89]|[2-9]\d)[歳才]以上|成人/;

/**
 * 持っている年齢のロール（Discord の参加時の質問で付く）。両方あれば 17 歳以下を優先。
 * ロールは設定（roles.ageMinor / ageAdult）か、名前に「17歳以下」「18歳以上」などを含むロール
 */
export function ageFromRoles(cfg: GuildConfig, held: Iterable<{ id: string; name: string }>): AgeGroup | undefined {
  let adult = false;
  for (const r of held) {
    const name = normRoleName(r.name);
    if (r.id === cfg.roles.ageMinor || (!cfg.roles.ageMinor && MINOR_NAME.test(name))) return 'minor';
    if (r.id === cfg.roles.ageAdult || (!cfg.roles.ageAdult && ADULT_NAME.test(name))) adult = true;
  }
  return adult ? 'adult' : undefined;
}

/**
 * 宵参り（成人エリア）の申請。
 * - 17 歳以下のロールがある（か、13〜17 歳と記録されている）人は自動で却下
 * - 18 歳以上のロールがある人は自動で承認（年齢区分も 18 歳以上にする）
 * - どちらのロールもなければ、入鯖のときに 18 歳以上と申告した人だけ受け付けて、神職が判定する
 */
export async function submitYoimairi(ctx: ModCtx, memberId: string, roleIds: readonly string[], ageRole?: AgeGroup): Promise<SubmitYoimairiResult> {
  const role = ctx.cfg.roles.yoimairi;
  if (!role) return { status: 'disabled' };
  if (roleIds.includes(role)) return { status: 'already' };
  const m = await getMember(ctx.db, memberId);
  if (ageRole === 'minor' || (ageRole === 'adult' && m?.ageGroup === 'minor')) {
    const r = await submitApplication(ctx.db, { memberId, kind: 'yoimairi', answers: { ageRole } });
    if (r.status !== 'created') return r;
    await decide(ctx, SYSTEM, r.id, false, ageRole === 'minor' ? '自動却下（17 歳以下のロール）' : '自動却下（13〜17 歳と記録されている）');
    return { status: 'auto_rejected', id: r.id };
  }
  if (ageRole === 'adult' && m) {
    if (m.ageGroup !== 'adult') await setAgeGroup(ctx.db, memberId, 'adult');
    const r = await submitApplication(ctx.db, { memberId, kind: 'yoimairi', answers: { ageRole } });
    if (r.status !== 'created') return r;
    const d = await decide(ctx, SYSTEM, r.id, true, '自動承認（18 歳以上のロール）');
    return d.status === 'approved' ? { status: 'auto_approved', id: r.id, dmSent: d.dmSent } : { status: 'pending', id: r.id };
  }
  if (m?.ageGroup !== 'adult') return { status: 'not_adult' };
  const r = await submitApplication(ctx.db, { memberId, kind: 'yoimairi', answers: {} });
  return r.status === 'created' ? { status: 'pending', id: r.id } : r;
}

export type DecideResult =
  | { status: 'approved' | 'rejected'; kind: ApplicationKind; memberId: string; dmSent: boolean }
  | { status: 'already_decided' | 'not_found' }
  | { status: 'not_adult' };

/** 申請の承認・却下 */
export async function decide(ctx: ModCtx, actor: Actor, id: number, approve: boolean, note = '', now = new Date()): Promise<DecideResult> {
  const app = await getApplication(ctx.db, id);
  if (!app) return { status: 'not_found' };
  if (app.status !== 'pending') return { status: 'already_decided' };
  const kind = app.kind as ApplicationKind;
  const g = ctx.cfg.guildId;

  // 宵参りは、承認の時点でも 18 歳以上であることを確かめる
  if (approve && kind === 'yoimairi') {
    const m = await getMember(ctx.db, app.memberId);
    if (m?.ageGroup !== 'adult') return { status: 'not_adult' };
  }
  const row = await decideApplication(ctx.db, id, { approve, by: actor.id, note });
  if (!row) return { status: 'already_decided' };

  let dmSent: boolean;
  if (kind === 'join') {
    if (approve) {
      const answered = app.answers.age === 'adult' || app.answers.age === 'minor' ? app.answers.age : 'unknown';
      // 前に 13〜17 と記録された人（宮司が変えた場合も）は、入り直して「18 歳以上」と申告しても変えない
      const prev = (await getMember(ctx.db, app.memberId))?.ageGroup;
      const age = prev === 'minor' && answered !== 'minor' ? 'minor' : answered === 'unknown' && prev ? prev : answered;
      await setAgeGroup(ctx.db, app.memberId, age as 'minor' | 'adult' | 'unknown');
      const gender = isGender(app.answers.gender) ? app.answers.gender : undefined;
      const genderRole = genderRoleOf(ctx.cfg, gender);
      if (genderRole) await safely('add gender', () => ctx.discord.addRole(g, app.memberId, genderRole, '入鯖申請（性別）'));
      // 招待してくれた人（申請で選んだ人）。お礼は 🔰参拝者 になったときに
      await recordInvite(ctx.db, app.memberId, app.answers.inviter).catch((err: unknown) => logger.warn({ err }, 'record invite failed'));
      // DM・フレンド追加（申請で選んだもの）
      for (const kind of CONTACT_KINDS) {
        const level = app.answers[kind];
        if (isContactLevel(level)) await safely('set contact', () => setContact(ctx, app.memberId, kind, level));
      }
      const intro = introChannelOf(ctx.cfg, gender);
      const pending = ctx.cfg.roles.emaPending;
      if (pending && intro) {
        // 自己紹介を書くまでは 📝絵馬待ち（自己紹介のチャンネルだけ見える）。書くと 🔰参拝者 になる
        await safely('add ema pending', () => ctx.discord.addRole(g, app.memberId, pending, '入鯖申請を承認（自己紹介待ち）'));
        dmSent = await ctx.discord.sendDm(
          app.memberId,
          [
            SIGN,
            '入鯖申請を承認しました。',
            `最後に、<#${intro}> に自己紹介を書いてください。書くと、咲楽ノ宮の全部のチャンネルが見えるようになります。`,
            `-# チャンネルのいちばん下のひな形をコピーして使えます（${INTRO_MIN_CHARS} 文字以上）`,
          ].join('\n'),
        );
      } else {
        dmSent = await completeJoin(ctx, app.memberId, now, { introChannelId: intro });
      }
    } else {
      dmSent = await ctx.discord.sendDm(app.memberId, [SIGN, '申し訳ありませんが、今回は入鯖をお見送りとさせていただきました。'].join('\n'));
      if (ctx.cfg.applications.kickOnReject) await safely('kick rejected', () => ctx.discord.kick(g, app.memberId, '入鯖申請を却下'));
    }
  } else {
    const role = ctx.cfg.roles.yoimairi;
    if (approve && role) await safely('add yoimairi', () => ctx.discord.addRole(g, app.memberId, role, '宵参り申請を承認'));
    dmSent = await ctx.discord.sendDm(
      app.memberId,
      approve
        ? [SIGN, '🔞 宵参りの申請を承認しました。宵宮（18 歳以上のエリア）に入れるようになりました。'].join('\n')
        : [SIGN, '宵参りの申請は、今回はお見送りとなりました。'].join('\n'),
    );
  }
  // #申請受付 のカードを「承認済み／却下」に書き換える（Discord・管理画面どちらで判定しても）
  if (app.channelId && app.messageId) {
    const by = actor.id === SYSTEM.id ? '自動' : `<@${actor.id}>`;
    const label = approve ? `✅ 承認しました（${by}）` : `❌ 却下しました（${by}）${note ? `: ${note}` : ''}`;
    await safely('edit application card', () => ctx.discord.editMessage(app.channelId!, app.messageId!, { content: label, components: [] }));
  }
  await audit(ctx.db, {
    actorId: actor.id,
    targetId: app.memberId,
    action: approve ? 'application.approve' : 'application.reject',
    detail: { id, kind, note },
    via: actor.via,
  });
  return { status: approve ? 'approved' : 'rejected', kind, memberId: app.memberId, dmSent };
}

// ───────── 年齢区分・宵参り ─────────

/** 年齢区分の変更（宮司のみ）。13〜17 歳にしたら宵参りも外す */
export async function changeAgeGroup(ctx: ModCtx, actor: Actor, memberId: string, age: AgeGroup | 'unknown'): Promise<'ok' | 'forbidden' | 'not_found'> {
  if (actor.level !== 'guji') return 'forbidden';
  const m = await getMember(ctx.db, memberId);
  if (!m) return 'not_found';
  if (await checkTarget(ctx, actor, memberId)) return 'forbidden';
  await setAgeGroup(ctx.db, memberId, age);
  const role = ctx.cfg.roles.yoimairi;
  if (age !== 'adult' && role && m.roleIds.includes(role)) {
    await safely('remove yoimairi', () => ctx.discord.removeRole(ctx.cfg.guildId, memberId, role, '年齢区分の変更'));
  }
  await audit(ctx.db, { actorId: actor.id, targetId: memberId, action: 'member.age', detail: { from: m.ageGroup, to: age }, via: actor.via });
  return 'ok';
}

/** 宵参りを外す（神職・宮司） */
export async function removeYoimairi(ctx: ModCtx, actor: Actor, memberId: string, reason: string): Promise<'ok' | 'denied' | 'disabled'> {
  const role = ctx.cfg.roles.yoimairi;
  if (!role) return 'disabled';
  if (await checkTarget(ctx, actor, memberId)) return 'denied';
  await safely('remove yoimairi', () => ctx.discord.removeRole(ctx.cfg.guildId, memberId, role, reason));
  await audit(ctx.db, { actorId: actor.id, targetId: memberId, action: 'member.yoimairi.remove', detail: { reason }, via: actor.via });
  return 'ok';
}

// ───────── お参り期間 ─────────

/** 氏子（2 段目の自動役職）以上になっているか */
function isPastFirstRank(ctx: ModCtx, roleIds: readonly string[]): boolean {
  const current = currentAutoRank(ctx.cfg.ranks, roleIds);
  const first = autoRanks(ctx.cfg.ranks)[0];
  return Boolean(current && first && current.key !== first.key) || Boolean(adminLevelOf(ctx.cfg, roleIds));
}

/**
 * 期間が終わった人を判定する（BOT が定期的に呼ぶ）。
 * 氏子になっていれば完了 / まだなら 1 回だけ自動延長 / それでもだめなら神職の判定待ちにする
 */
export async function checkOmairi(ctx: ModCtx, now = new Date()): Promise<{ promoted: string[]; extended: string[]; review: string[] }> {
  const out = { promoted: [] as string[], extended: [] as string[], review: [] as string[] };
  for (const o of await dueOmairi(ctx.db, now)) {
    const m = await getMember(ctx.db, o.memberId);
    if (!m || m.leftAt) {
      await setOmairiStatus(ctx.db, o.memberId, 'removed', 'system');
      continue;
    }
    if (isPastFirstRank(ctx, m.roleIds)) {
      await setOmairiStatus(ctx.db, o.memberId, 'promoted', 'system');
      out.promoted.push(o.memberId);
      continue;
    }
    const ext = ctx.cfg.omairi.extendDays;
    if (o.extendedCount === 0 && ext > 0) {
      await extendOmairi(ctx.db, o.memberId, ext, now);
      await ctx.discord.sendDm(o.memberId, [SIGN, `お参り期間を ${ext} 日延長しました。引き続き、ご縁を結んでいってください。`].join('\n'));
      out.extended.push(o.memberId);
      continue;
    }
    await setOmairiStatus(ctx.db, o.memberId, 'review', 'system', ['ongoing']);
    out.review.push(o.memberId);
  }
  return out;
}

/** 昇格したらお参り期間を完了にする（BOT の昇格処理から呼ぶ） */
export async function omairiPromoted(ctx: ModCtx, memberId: string): Promise<void> {
  await setOmairiStatus(ctx.db, memberId, 'promoted', 'system');
}

export type OmairiAction = 'extend' | 'promote' | 'remove';

/** 神職によるお参り期間の判定 */
export async function decideOmairi(
  ctx: ModCtx,
  actor: Actor,
  memberId: string,
  action: OmairiAction,
  now = new Date(),
): Promise<'ok' | 'not_found' | 'denied'> {
  const o = await getOmairi(ctx.db, memberId);
  if (!o || !['ongoing', 'review'].includes(o.status)) return 'not_found';
  if (await checkTarget(ctx, actor, memberId)) return 'denied';
  const g = ctx.cfg.guildId;

  if (action === 'extend') {
    await extendOmairi(ctx.db, memberId, ctx.cfg.omairi.extendDays || 7, now, actor.id);
  } else if (action === 'promote') {
    // 先に「判定済み」にできた 1 回だけが動く（二重に押しても昇格・記録は 1 回）
    if (!(await setOmairiStatus(ctx.db, memberId, 'promoted', actor.id))) return 'not_found';
    const [first, second] = autoRanks(ctx.cfg.ranks);
    if (second) await safely('add second rank', () => ctx.discord.addRole(g, memberId, second.roleId, 'お参り期間の判定で昇格'));
    if (first) await safely('remove first rank', () => ctx.discord.removeRole(g, memberId, first.roleId, 'お参り期間の判定で昇格'));
  } else {
    if (!(await setOmairiStatus(ctx.db, memberId, 'removed', actor.id))) return 'not_found';
    await ctx.discord.sendDm(memberId, [SIGN, 'お参り期間が終わりました。申し訳ありませんが、今回は退出とさせていただきます。'].join('\n'));
    await safely('kick after omairi', () => ctx.discord.kick(g, memberId, 'お参り期間の判定'));
  }
  await audit(ctx.db, { actorId: actor.id, targetId: memberId, action: `omairi.${action}`, via: actor.via });
  return 'ok';
}

// ───────── 相談 ─────────

/** 神職が相談に返信する（相談した人に BOT から DM。神職の名前は出さない） */
export async function replySoudan(ctx: ModCtx, actor: Actor, soudanId: number, body: string): Promise<{ status: 'ok'; dmSent: boolean } | { status: 'not_found' }> {
  if (!(await appendFromStaff(ctx.db, soudanId, actor.id, body))) return { status: 'not_found' };
  const sender = await senderOf(ctx.db, soudanId);
  const dmSent = sender
    ? await ctx.discord.sendDm(
        sender,
        [`${SIGN}（相談 #${soudanId} への返信）`, '', body, '', `続けて相談するときは、サーバーで \`/soudan\` を使い「番号」に ${soudanId} を入れてください。`].join('\n'),
      )
    : false;
  await audit(ctx.db, { actorId: actor.id, action: 'soudan.reply', detail: { soudanId, dmSent }, via: actor.via });
  return { status: 'ok', dmSent };
}

/** 相談した人を確認する（宮司のみ・緊急時用）。確認したことは記録に残る */
export async function revealSoudanSender(ctx: ModCtx, actor: Actor, soudanId: number, reason: string): Promise<string | 'forbidden' | 'not_found'> {
  if (actor.level !== 'guji') return 'forbidden';
  const sender = await senderOf(ctx.db, soudanId);
  if (!sender) return 'not_found';
  // 相談した人は記録の「相手」に残さない（記録は神職も見られるので、匿名が守れなくなる）
  await audit(ctx.db, { actorId: actor.id, targetId: null, action: 'soudan.reveal', detail: { soudanId, reason }, via: actor.via });
  return sender;
}

/** 相談を完了にする（カードも書き換える） */
export async function closeSoudan(ctx: ModCtx, actor: Actor, soudanId: number): Promise<'ok' | 'not_found'> {
  const s = await getSoudan(ctx.db, soudanId);
  if (!s) return 'not_found';
  await setSoudanStatus(ctx.db, soudanId, 'done', s.assigneeId ?? actor.id);
  if (s.channelId && s.messageId) {
    await safely('edit soudan card', () => ctx.discord.editMessage(s.channelId!, s.messageId!, { content: `✅ 相談 #${soudanId} は完了しました（<@${actor.id}>）`, components: [] }));
  }
  await audit(ctx.db, { actorId: actor.id, action: 'soudan.done', detail: { soudanId }, via: actor.via });
  return 'ok';
}
