import type { GuildMember, PartialGuildMember } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { altNameTargets } from '../services/memberAlts.js';

/**
 * 🏷 承認ずみのサブアカウントの名前を、本アカウントの名前に合わせる（「本アカウントの名前 サブ」）。
 * 本アカウントの名前が変わったら、サブの名前も変える。サブが 2 つ以上あれば「サブ」「サブ2」「サブ3」…。
 */
export class AltNameApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
  ) {}

  /** 本アカウントの表示名が変わったら、そのサブの名前を合わせる */
  async onMemberUpdate(old: GuildMember | PartialGuildMember, m: GuildMember): Promise<void> {
    if (m.guild.id !== this.cfg().guildId || m.user.bot) return;
    if (!old.partial && old.displayName === m.displayName) return;
    await this.syncAlts(m, m.displayName);
  }

  /** 本アカウント main の承認ずみサブを、今の本アカウントの名前に合わせる。変えた数を返す */
  async syncAlts(main: GuildMember, mainName: string): Promise<number> {
    const targets = await altNameTargets(this.db, main.id, mainName);
    let changed = 0;
    for (const t of targets) {
      const alt = await main.guild.members.fetch(t.altId).catch(() => undefined);
      if (!alt || alt.nickname === t.nick) continue;
      if (!alt.manageable) {
        logger.warn({ altId: t.altId }, 'alt rename: not manageable');
        continue;
      }
      await alt
        .setNickname(t.nick, 'サブアカウントの名前を本アカウントに合わせる')
        .then(() => {
          changed++;
        })
        .catch((err: unknown) => logger.warn({ err, altId: t.altId }, 'alt rename failed'));
    }
    return changed;
  }
}
