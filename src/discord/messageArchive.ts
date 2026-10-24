import { AuditLogEvent, type Guild, type Message, type PartialMessage } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { messageArchive } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { archiveDeleted, archiveEdit, archiveMessage, pruneArchive } from '../services/messageArchive.js';

/** 写真の中身を取る（Discord の CDN から。8MB まで） */
async function download(url: string): Promise<Uint8Array | undefined> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return undefined;
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * 📚 書き込みの記録（宮司だけが社務所Web で見る）。中身は MESSAGE CONTENT INTENT がオンのときだけ分かる。
 * 消した人は Discord の監査ログから（本人が消したときは残らないので空）。
 */
export class MessageArchiveApp {
  private lastPrune = 0;
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly fetchFile: (url: string) => Promise<Uint8Array | undefined> = download,
  ) {}

  onMessage(m: Message): void {
    if (!m.inGuild() || m.guildId !== this.cfg().guildId || m.author.bot || m.system || m.webhookId) return;
    void archiveMessage(this.db, {
      id: m.id, channelId: m.channelId, authorId: m.author.id, authorName: m.member?.displayName ?? m.author.username,
      content: m.content, createdAt: m.createdAt,
      attachments: [...m.attachments.values()].map((a) => ({ name: a.name, size: a.size, contentType: a.contentType, url: a.url })),
    }, this.fetchFile).catch((err) => logger.warn({ err }, 'message archive failed'));
  }

  onUpdate(m: Message | PartialMessage): void {
    if (m.guildId !== this.cfg().guildId || m.partial || typeof m.content !== 'string') return;
    void archiveEdit(this.db, m.id, m.content, m.editedAt ?? new Date()).catch((err) => logger.warn({ err }, 'message archive edit failed'));
  }

  async onDelete(m: Pick<Message | PartialMessage, 'id' | 'channelId' | 'guildId'> & { guild?: Guild | null }): Promise<void> {
    if (m.guildId !== this.cfg().guildId) return;
    const [row] = await this.db.select({ authorId: messageArchive.authorId }).from(messageArchive).where(eq(messageArchive.messageId, m.id));
    if (!row) return;
    // 本人以外が消したときだけ、監査ログに消した人が残る
    const logs = m.guild ? await m.guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 5 }).catch(() => undefined) : undefined;
    const hit = logs?.entries.find((e) => e.targetId === row.authorId && e.extra?.channel.id === m.channelId && Date.now() - e.createdTimestamp < 60_000);
    await archiveDeleted(this.db, [m.id], hit?.executorId ?? undefined);
  }

  async onBulkDelete(ids: string[], guild?: Guild | null): Promise<void> {
    if (!guild || guild.id !== this.cfg().guildId) return;
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageBulkDelete, limit: 3 }).catch(() => undefined);
    const hit = logs?.entries.find((e) => Date.now() - e.createdTimestamp < 60_000);
    await archiveDeleted(this.db, ids, hit?.executorId ?? undefined);
  }

  /** BOT が自分で消したもの（🧹 抜けた人の片付けなど） */
  markDeleted(ids: string[], by: string): void {
    void archiveDeleted(this.db, ids, by).catch(() => undefined);
  }

  /** 1 分ごと: 1 日 1 回、90 日より前の記録を消す */
  async tick(now = new Date()): Promise<void> {
    if (now.getTime() - this.lastPrune < 86_400_000) return;
    this.lastPrune = now.getTime();
    const n = await pruneArchive(this.db, now);
    if (n) logger.info({ n }, 'message archive pruned');
  }
}
