import { ChannelType, type Guild, type GuildMember, type Message, type PartialGuildMember, type TextChannel } from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * 🧭 案内待ち: サーバーに入った瞬間に付ける目印のロール（まだ承認されていない人）。
 * 入鯖申請が承認されて次の段階（📝絵馬待ち・役職）に進んだら外す。
 * ロールは設定（roles.guidePending）か、名前に「案内待ち」を含むロール。どちらもなければ何もしない。
 */

export type GuideMember = { isBot: boolean; completed: boolean; roleIds: readonly string[] };

/** 付ける・外す・そのまま（undefined） */
export function guideAction(cfg: GuildConfig, roleId: string, m: GuideMember): 'add' | 'remove' | undefined {
  const has = m.roleIds.includes(roleId);
  const approved = cfg.ranks.some((r) => m.roleIds.includes(r.roleId)) || Boolean(cfg.roles.emaPending && m.roleIds.includes(cfg.roles.emaPending));
  if (m.isBot || approved) return has ? 'remove' : undefined;
  return m.completed && !has ? 'add' : undefined;
}

/** 案内待ちのロール（設定になければ名前で探す） */
export function guideRoleOf(cfg: GuildConfig, roles: Iterable<{ id: string; name: string }>): string | undefined {
  if (cfg.roles.guidePending) return cfg.roles.guidePending;
  for (const r of roles) if (r.name.replace(/\s/g, '').includes('案内待ち')) return r.id;
  return undefined;
}

/** #面談日程（設定になければ、名前に「面談日程」を含むテキストチャンネル） */
export function scheduleChannelOf(cfg: GuildConfig, channels: Iterable<{ id: string; name: string; type: number }>): string | undefined {
  if (cfg.channels.interviewSchedule) return cfg.channels.interviewSchedule;
  for (const c of channels) if (c.type === ChannelType.GuildText && c.name.replace(/\s/g, '').includes('面談日程')) return c.id;
  return undefined;
}

/** 書いた人のようす（left: サーバーにいない / pending: 案内待ち / staff: 運営） */
export type ScheduleAuthor = { left: boolean; pending: boolean; staff: boolean };

/**
 * #面談日程 に残っている書き込みのうち、消すもの。
 * 案内待ちでなくなった人・抜けた人の書き込み（ピン留め・BOT・運営の書き込みは残す）
 */
export function leftoverIds(msgs: { id: string; authorId: string; bot: boolean; pinned: boolean }[], authorOf: (id: string) => ScheduleAuthor): string[] {
  return msgs
    .filter((m) => !m.pinned && !m.bot)
    .filter((m) => {
      const a = authorOf(m.authorId);
      return !a.staff && (a.left || !a.pending);
    })
    .map((m) => m.id);
}

/** 一度に見る書き込みの数（100 件 × この回数） */
const SCAN_PAGES = 5;
/** Discord がまとめて消せるのは 14 日以内（少し余裕を見る） */
const BULK_MAX_AGE_MS = 14 * 86_400_000 - 3_600_000;

export class GuidePendingApp {
  constructor(private readonly cfg: () => GuildConfig) {}

  /** 入った瞬間に付ける */
  async onMemberAdd(m: GuildMember): Promise<void> {
    if (m.guild.id !== this.cfg().guildId) return;
    const roleId = guideRoleOf(this.cfg(), m.guild.roles.cache.values());
    if (roleId) await this.reconcile(m, roleId);
  }

  /** 起動したとき: 止まっていた間に入った人・承認された人も合わせる */
  async attach(guild: Guild): Promise<void> {
    const roleId = guideRoleOf(this.cfg(), guild.roles.cache.values());
    if (!roleId) return;
    let changed = 0;
    for (const m of guild.members.cache.values()) if (await this.reconcile(m, roleId)) changed++;
    if (changed) logger.info({ changed }, 'guide pending synced');
  }

  /** 承認されて絵馬待ち・役職になったら外す（付け忘れていたら付ける）。外れたら #面談日程 の書き込みを消す */
  async onMemberUpdate(old: GuildMember | PartialGuildMember, m: GuildMember): Promise<void> {
    if (m.guild.id !== this.cfg().guildId) return;
    const roleId = guideRoleOf(this.cfg(), m.guild.roles.cache.values());
    if (!roleId) return;
    await this.reconcile(m, roleId);
    if (!old.partial && old.roles.cache.has(roleId) && !m.roles.cache.has(roleId)) await this.clearSchedule(m.guild, m.id);
  }

  /** 抜けた人の #面談日程 の書き込みも消す */
  async onMemberRemove(guild: Guild, memberId: string): Promise<void> {
    if (guild.id !== this.cfg().guildId) return;
    await this.clearSchedule(guild, memberId);
  }

  private scheduleChannel(guild: Guild): TextChannel | undefined {
    const id = scheduleChannelOf(this.cfg(), guild.channels.cache.values());
    const ch = id ? guild.channels.cache.get(id) : undefined;
    return ch?.type === ChannelType.GuildText ? ch : undefined;
  }

  private async recent(ch: TextChannel): Promise<Message<true>[]> {
    const out: Message<true>[] = [];
    let before: string | undefined;
    for (let i = 0; i < SCAN_PAGES; i++) {
      const page = await ch.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      out.push(...page.values());
      if (page.size < 100) break;
      before = page.last()?.id;
    }
    return out;
  }

  private async remove(ch: TextChannel, msgs: Message<true>[]): Promise<number> {
    const fresh = msgs.filter((m) => Date.now() - m.createdTimestamp < BULK_MAX_AGE_MS);
    const old = msgs.filter((m) => Date.now() - m.createdTimestamp >= BULK_MAX_AGE_MS);
    let n = 0;
    if (fresh.length >= 2) n += (await ch.bulkDelete(fresh.map((m) => m.id), true)).size;
    else for (const m of fresh) if (await m.delete().then(() => true, () => false)) n++;
    for (const m of old) if (await m.delete().then(() => true, () => false)) n++;
    return n;
  }

  /** その人の #面談日程 の書き込みを消す（ピン留めは残す） */
  async clearSchedule(guild: Guild, memberId: string): Promise<number> {
    const ch = this.scheduleChannel(guild);
    if (!ch) return 0;
    try {
      const mine = (await this.recent(ch)).filter((m) => m.author.id === memberId && !m.pinned);
      const n = mine.length ? await this.remove(ch, mine) : 0;
      if (n) logger.info({ memberId, n }, 'interview schedule cleared');
      return n;
    } catch (err) {
      logger.warn({ err, memberId }, 'interview schedule clear failed（BOT に「メッセージの管理」があるか）');
      return 0;
    }
  }

  /** 起動したとき・10 分ごと: 案内待ちでなくなった人・抜けた人の書き込みが残っていれば消す（取りこぼし用） */
  async sweepSchedule(guild: Guild): Promise<number> {
    if (guild.id !== this.cfg().guildId) return 0;
    const roleId = guideRoleOf(this.cfg(), guild.roles.cache.values());
    const ch = this.scheduleChannel(guild);
    if (!roleId || !ch) return 0;
    try {
      const msgs = await this.recent(ch);
      const authors = new Map<string, ScheduleAuthor>();
      for (const id of new Set(msgs.filter((m) => !m.author.bot).map((m) => m.author.id))) {
        const member = guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => undefined));
        const roles = member ? [...member.roles.cache.keys()] : [];
        authors.set(id, { left: !member, pending: roles.includes(roleId), staff: Boolean(adminLevelOf(this.cfg(), roles)) });
      }
      const ids = new Set(
        leftoverIds(
          msgs.map((m) => ({ id: m.id, authorId: m.author.id, bot: m.author.bot, pinned: m.pinned })),
          (id) => authors.get(id) ?? { left: false, pending: true, staff: false },
        ),
      );
      const n = ids.size ? await this.remove(ch, msgs.filter((m) => ids.has(m.id))) : 0;
      if (n) logger.info({ n }, 'interview schedule swept');
      return n;
    } catch (err) {
      logger.warn({ err }, 'interview schedule sweep failed（BOT に「メッセージの管理」があるか）');
      return 0;
    }
  }

  /** 付けた・外したら true */
  private async reconcile(m: GuildMember, roleId: string): Promise<boolean> {
    // 入った時点で付ける（参加時の質問を終えたかは問わない）
    const action = guideAction(this.cfg(), roleId, { isBot: m.user.bot, completed: true, roleIds: [...m.roles.cache.keys()] });
    if (!action) return false;
    try {
      if (action === 'add') await m.roles.add(roleId, 'サーバーに入った（案内待ち）');
      else await m.roles.remove(roleId, '次の段階に進んだ（案内待ちを外す）');
      return true;
    } catch (err) {
      logger.warn({ err, memberId: m.id, action }, 'guide pending role failed（BOT のロールの位置か権限）');
      return false;
    }
  }
}
