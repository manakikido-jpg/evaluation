import { AuditLogEvent, PermissionFlagsBits, type GuildMember, type PartialGuildMember } from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { judgeRoleChange } from '../services/roleGuard.js';

/** 監査ログに出るまで少し待つ */
const AUDIT_WAIT_MS = 1500;
/** この時間より前の監査ログは、今の変更ではない */
const AUDIT_FRESH_MS = 15_000;

/**
 * 🛡 BOT を通さないロールの変更を見張る。このBOT・信用する BOT・宮司・サーバーの持ち主・本人の選択（参加時の質問など）以外が
 * ロールを変えたら、設定（security.roleGuard）で 知らせる / 元に戻して知らせる
 */
export class RoleGuardApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: Pick<DiscordActions, 'sendMessage'>,
    private readonly wait = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async onMemberUpdate(old: GuildMember | PartialGuildMember, m: GuildMember): Promise<void> {
    const c = this.cfg();
    if (m.guild.id !== c.guildId || c.security.roleGuard === 'off') return;
    if (!old.partial && old.roles.cache.size === m.roles.cache.size && old.roles.cache.every((_, id) => m.roles.cache.has(id))) return;
    await this.wait(AUDIT_WAIT_MS);
    let entry;
    try {
      const logs = await m.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 10 });
      entry = logs.entries.find((e) => e.targetId === m.id && Date.now() - e.createdTimestamp < AUDIT_FRESH_MS);
    } catch (err) {
      logger.warn({ err }, 'role guard: audit log unreadable（BOT に「監査ログを表示」があるか）');
    }
    if (!entry) return;
    const added = (entry.changes.find((x) => x.key === '$add')?.new as { id: string }[] | undefined) ?? [];
    const removed = (entry.changes.find((x) => x.key === '$remove')?.new as { id: string }[] | undefined) ?? [];
    // 自動で付くロール（ブースター・連携）は見ない
    const watch = (ids: { id: string }[]) => ids.map((r) => r.id).filter((id) => !m.guild.roles.cache.get(id)?.managed);
    const add = watch(added);
    const remove = watch(removed);
    if (!add.length && !remove.length) return;
    const executorId = entry.executorId;
    const executor = executorId ? await m.guild.members.fetch(executorId).catch(() => null) : null;
    const isGuji = Boolean(executor && adminLevelOf(c, [...executor.roles.cache.keys()]) === 'guji') || executorId === m.guild.ownerId;
    const selfSelect = executorId === m.id && !executor?.permissions.has(PermissionFlagsBits.ManageRoles);
    const verdict = judgeRoleChange({
      mode: c.security.roleGuard,
      executorId,
      executorIsBot: Boolean(executor?.user.bot),
      selfId: m.client.user.id,
      trustedBotIds: c.security.trustedBotIds,
      executorIsGuji: isGuji,
      selfSelect,
    });
    if (verdict === 'ok') return;
    let reverted = false;
    if (verdict === 'revert') {
      try {
        if (add.length) await m.roles.remove(add, '🛡 BOT を通さないロールの変更を戻す');
        if (remove.length) await m.roles.add(remove, '🛡 BOT を通さないロールの変更を戻す');
        reverted = true;
      } catch (err) {
        logger.warn({ err, memberId: m.id }, 'role guard revert failed（BOT のロールの位置か権限）');
      }
    }
    await audit(this.db, { actorId: executorId ?? 'unknown', targetId: m.id, action: reverted ? 'security.role_reverted' : 'security.role_alert', detail: { added: add, removed: remove }, via: 'discord' });
    const ch = c.channels.log;
    if (!ch) return;
    const roles = (ids: string[]) => ids.map((id) => `<@&${id}>`).join(' ');
    await this.discord
      .sendMessage(ch, {
        content: [
          `🛡 **BOT を通さないロールの変更**: ${executorId ? `<@${executorId}>` : 'だれか（監査ログが読めません）'} が <@${m.id}> のロールを変えました。`,
          add.length ? `付けた: ${roles(add)}` : '',
          remove.length ? `外した: ${roles(remove)}` : '',
          reverted ? '↩ 元に戻しました。' : verdict === 'revert' ? '⚠ 元に戻せませんでした（BOT のロールの位置か権限を確かめてください）。' : '（知らせるだけの設定です。戻すには社務所Web の「🛡 荒らし対策」で「元に戻す」にしてください）',
        ]
          .filter(Boolean)
          .join('\n'),
        allowed_mentions: { parse: [] },
      })
      .catch((err: unknown) => logger.warn({ err }, 'role guard alert failed'));
  }
}
