import type { GuildMember, PartialGuildMember } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { KeyedLock } from '../lib/lock.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { appointRoleChanges, loadAppointRoles } from '../services/appointRoles.js';

/** 🎖 任命したときに一緒に付けるロール（衛士 ＋ 新役衛士 など）を、ロールの変化を見て付け外しする */
export class AppointRolesApp {
  private readonly lock = new KeyedLock();
  constructor(private readonly db: Db, private readonly cfg: () => GuildConfig) {}

  async onMemberUpdate(old: GuildMember | PartialGuildMember, m: GuildMember): Promise<void> {
    const c = this.cfg();
    // 前のロールが分からないとき（キャッシュにない）は、付いたかどうか決められないので何もしない
    if (m.guild.id !== c.guildId || m.user.bot || old.partial) return;
    const map = await loadAppointRoles(this.db);
    if (!Object.keys(map).length) return;
    const { add, remove } = appointRoleChanges(c.ranks, map, new Set(old.roles.cache.keys()), new Set(m.roles.cache.keys()));
    if (!add.length && !remove.length) return;
    await this.lock.run(m.id, async () => {
      for (const id of add) {
        if (m.roles.cache.has(id)) continue;
        try {
          await m.roles.add(id, '役職を任命したので、一緒のロールも付ける');
          await audit(this.db, { actorId: 'system', targetId: m.id, action: 'ranks.appoint_role_add', detail: { roleId: id }, via: 'discord' });
        } catch (err) { logger.warn({ err, memberId: m.id, roleId: id }, 'appoint role add failed（BOT のロールの位置・「ロールの管理」を確かめる）'); }
      }
      for (const id of remove) {
        if (!m.roles.cache.has(id)) continue;
        try {
          await m.roles.remove(id, '役職が上がった・外れたので、前の一緒のロールを外す');
          await audit(this.db, { actorId: 'system', targetId: m.id, action: 'ranks.appoint_role_remove', detail: { roleId: id }, via: 'discord' });
        } catch (err) { logger.warn({ err, memberId: m.id, roleId: id }, 'appoint role remove failed（BOT のロールの位置・「ロールの管理」を確かめる）'); }
      }
    });
  }
}
