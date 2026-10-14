import type { GuildMember } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { isNewAccount, JoinCounter, raidState, startRaid } from '../services/raid.js';
import { watchOf } from '../services/securityWatch.js';

/**
 * 🛡 荒らし対策（入口）: 要注意リストの人が入ったら、運営のログに知らせる。
 * 案内待ちのまま止める（案内人のロール付与は guideReception で断る）
 */
export class SecurityApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: Pick<DiscordActions, 'sendMessage'>,
  ) {}

  private readonly joins = new JoinCounter();

  async onMemberAdd(m: GuildMember, now = new Date()): Promise<void> {
    if (m.guild.id !== this.cfg().guildId || m.user.bot) return;
    const sec = this.cfg().security;
    const say = async (content: string) => {
      const ch = this.cfg().channels.log;
      if (!ch) return;
      await this.discord.sendMessage(ch, { content, allowed_mentions: { parse: [] } }).catch((err: unknown) => logger.warn({ err }, 'security alert failed'));
    };
    // 🚨 レイド検知: 短い時間にたくさん入ったら警戒モード
    if (sec.raidJoins > 0) {
      const n = this.joins.add(now.getTime(), sec.raidMinutes * 60_000);
      if (n >= sec.raidJoins && !(await raidState(this.db, now))) {
        await startRaid(this.db, 'system', sec.raidHoldMinutes, now, n);
        await audit(this.db, { actorId: 'system', action: 'security.raid_start', detail: { joins: n, minutes: sec.raidMinutes }, via: 'system' });
        logger.warn({ joins: n }, 'raid detected');
        await say(
          [
            `🚨 **警戒モードにしました**: ${sec.raidMinutes} 分で ${n} 人が入りました（レイドのおそれ）。`,
            `${sec.raidHoldMinutes} 分のあいだ、案内人のロール付与と入鯖申請の自動承認を止めます。荒らしのタイムアウトは K-PRO に任せます。`,
            '落ち着いたら、社務所Web の「🛡 荒らし対策」で早めに終えられます。',
          ].join('\n'),
        );
      }
    }
    const w = await watchOf(this.db, m.id);
    const fresh = isNewAccount(m.user.createdAt, sec.newAccountDays, now);
    if (!w && !fresh) return;
    if (w) logger.warn({ memberId: m.id }, 'watched member joined');
    const days = Math.floor((now.getTime() - m.user.createdAt.getTime()) / 86_400_000);
    await say(
      [
        w ? `🛡 **要注意リストの人が入りました**: <@${m.id}>（${m.user.username}・ID ${m.id}）` : `🐣 **新しいアカウントが入りました**: <@${m.id}>（${m.user.username}・ID ${m.id}）`,
        w ? `理由: ${w.reason}` : '',
        fresh ? `アカウントを作って ${days} 日です。` : '',
        w ? '案内待ちのまま止めています。案内人はロールを付けられません。対応は神職・宮司で決めてください（社務所Web の「🛡 荒らし対策」）。' : '案内のときは、サブアカウントや荒らしでないか気をつけてください。',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}
