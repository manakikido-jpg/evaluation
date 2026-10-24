import type { GuildMember, Role } from 'discord.js';
import type { Db } from '../db/client.js';
import { KeyedLock } from '../lib/lock.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { returningMemberIds } from '../services/members.js';

/** 飾りや空白は許可するが「出戻り疑い」などの別のロールは選ばない。 */
export function returnerRoleOf(roles: Iterable<Role>): Role | undefined {
  const matches = [...roles].filter(r => r.name.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '') === '出戻り');
  return matches.length === 1 && !matches[0]!.managed ? matches[0] : undefined;
}

export class ReturnerRoles {
  private readonly lock = new KeyedLock();
  constructor(private readonly db: Db) {}

  /** DBで再参加と確認した直後に呼ぶ。承認や自己紹介を待たない。 */
  async onDetected(m: GuildMember): Promise<void> {
    if (m.user.bot) return;
    await this.lock.run(m.id, async () => {
      const role = returnerRoleOf(m.guild.roles?.cache.values() ?? []);
      if (!role) {
        logger.warn({ memberId: m.id }, '出戻りロールが見つからないか、同名が複数あります');
        return;
      }
      if (m.roles.cache.has(role.id)) return;
      try {
        if (!role.editable) throw new Error('出戻りロールをBOTが付けられません');
        await m.roles.add(role.id, '過去の参加履歴から出戻りと判別');
      } catch (err) {
        logger.warn({ err, memberId: m.id, roleId: role.id }, '出戻りロール付与失敗・次の同期や更新で再試行');
        return;
      }
      await audit(this.db, { actorId: 'system', targetId: m.id, action: 'member.returner_role',
        detail: { roleId: role.id }, via: 'discord' }).catch(err => logger.warn({ err }, '出戻りロールの操作記録失敗'));
    });
  }

  async onMemberUpdate(m: GuildMember): Promise<void> {
    if (m.user.bot) return;
    const role = returnerRoleOf(m.guild.roles?.cache.values() ?? []);
    if (!role || m.roles.cache.has(role.id)) return;
    if ((await returningMemberIds(this.db, [m.id])).has(m.id)) await this.onDetected(m);
  }

  /** 起動時・全員同期で、停止中の再参加や付与失敗を復旧する。 */
  async sync(all: GuildMember[]): Promise<void> {
    const pending = all.filter(m => !m.user.bot && m.guild.roles &&
      returnerRoleOf(m.guild.roles?.cache.values() ?? []));
    if (!pending.length) return;
    const ids = await returningMemberIds(this.db, pending.map(m => m.id));
    for (const m of pending) if (ids.has(m.id)) await this.onDetected(m);
  }
}
