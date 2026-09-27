import type { Guild, GuildMember, PartialGuildMember } from 'discord.js';
import type { GuildConfig } from '../config.js';
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

  /** 承認されて絵馬待ち・役職になったら外す（付け忘れていたら付ける） */
  async onMemberUpdate(_old: GuildMember | PartialGuildMember, m: GuildMember): Promise<void> {
    if (m.guild.id !== this.cfg().guildId) return;
    const roleId = guideRoleOf(this.cfg(), m.guild.roles.cache.values());
    if (roleId) await this.reconcile(m, roleId);
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
