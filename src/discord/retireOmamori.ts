import { ChannelType, type Guild } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { RETIRED_OMAMORI_NAMES } from '../setup/layout.js';

const KEY = 'omamori_retired';

/** 消すお守りのロール（設定に残っているものと、前の版の名前のもの。役職・連携のロールは消さない） */
export function omamoriRolesToDelete(cfg: GuildConfig, roles: { id: string; name: string; managed: boolean }[]): string[] {
  const keep = new Set(cfg.ranks.map((r) => r.roleId));
  const byConfig = new Set(cfg.roles.omamori.map((o) => o.roleId));
  return roles.filter((r) => !r.managed && !keep.has(r.id) && r.id !== cfg.guildId && (byConfig.has(r.id) || RETIRED_OMAMORI_NAMES.includes(r.name))).map((r) => r.id);
}

/** BOT の書き込みに、お守りのボタンが付いているか */
export function isOmamoriPanel(rows: { components?: { custom_id?: string }[] }[]): boolean {
  return rows.some((row) => (row.components ?? []).some((b) => b.custom_id?.startsWith('omamori:')));
}

/**
 * 🧧 お守り（募集の通知のロール）をなくした（2026-09）: BOT が起きたときに 1 回だけ、
 * お守りのロールと、#授与所 などに置いたお守りのボタンを消す。全部できたら覚えて、次からはしない
 */
export async function retireOmamori(db: Db, cfg: GuildConfig, guild: Guild, discord: Pick<DiscordActions, 'sendMessage'>): Promise<void> {
  const [done] = await db.select().from(settings).where(eq(settings.key, KEY));
  if (done) return;
  let failed = 0;
  let roles = 0;
  let panels = 0;
  const me = guild.client.user.id;
  for (const ch of guild.channels.cache.values()) {
    if (ch.type !== ChannelType.GuildText) continue;
    const msgs = await ch.messages.fetch({ limit: 50 }).catch(() => undefined);
    for (const m of msgs?.values() ?? []) {
      if (m.author.id !== me || !isOmamoriPanel(m.components.map((r) => r.toJSON()) as { components?: { custom_id?: string }[] }[])) continue;
      if (await m.delete().then(() => true, () => false)) panels++;
      else failed++;
    }
  }
  const all = [...guild.roles.cache.values()].map((r) => ({ id: r.id, name: r.name, managed: r.managed }));
  for (const id of omamoriRolesToDelete(cfg, all)) {
    const ok = await guild.roles.delete(id, 'お守り（募集の通知）をなくした').then(
      () => true,
      (err: unknown) => (logger.warn({ err, roleId: id }, 'omamori role delete failed'), false),
    );
    if (ok) roles++;
    else failed++;
  }
  if (roles || panels) {
    logger.info({ roles, panels }, 'omamori retired');
    const log = cfg.channels.log;
    if (log) await discord.sendMessage(log, { content: `🧧 お守り（募集の通知）をなくしたので、お守りのロール ${roles} 個と、お守りのボタン ${panels} 個を消しました。` }).catch(() => undefined);
  }
  // 消せなかったもの（BOT の権限・ロールの位置）があれば、次に起きたときにもう一度
  if (failed === 0) {
    await db
      .insert(settings)
      .values({ key: KEY, value: { roles, panels }, updatedBy: 'system' })
      .onConflictDoNothing();
  }
}
