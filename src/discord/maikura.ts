import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { AttachmentBuilder, MessageFlags, PermissionFlagsBits, type Guild, type Role, type Interaction } from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { audit } from '../services/audit.js';
import { logger } from '../lib/logger.js';

class MaikuraError extends Error {}

const ROLE_NAME = '舞倉';
const KEY = 'maikura_role';
const POP = fileURLToPath(new URL('../web/public/maikura-pop.png', import.meta.url));
const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const STAFF_PERMISSIONS = PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.KickMembers | PermissionFlagsBits.BanMembers | PermissionFlagsBits.ManageWebhooks | PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.ManageEvents | PermissionFlagsBits.ManageGuildExpressions | PermissionFlagsBits.MuteMembers | PermissionFlagsBits.DeafenMembers | PermissionFlagsBits.MoveMembers | PermissionFlagsBits.MentionEveryone;
const roleIds = (value: unknown): string[] => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(roleIds) : [];

export const maikuraPanel = () => ({
  content: '**舞倉に参加したい方はこちらへ**',
  files: [new AttachmentBuilder(POP, { name: 'maikura-pop.png', description: '舞倉に参加したい方はこちらへ。Minecraftのブロックと鳥居を描いた参加案内。' })],
  embeds: [{ color: 0x4c9865, image: { url: 'attachment://maikura-pop.png' } }],
  components: [{ type: 1 as const, components: [{ type: 2 as const, style: 3 as const, custom_id: 'maikura:join', label: '舞倉に参加する', emoji: { name: '🌿' } }] }],
  allowedMentions: { parse: [] as never[] },
});

export class MaikuraApp {
  constructor(private db: Db, private cfg: () => GuildConfig) {}
  private validate(role: Role) {
    const cfg = this.cfg();
    if (role.name.replace(/\s/g, '') !== ROLE_NAME || role.id === cfg.guildId || role.managed || role.permissions.any(STAFF_PERMISSIONS) || [...cfg.ranks.map(r => r.roleId), ...roleIds(cfg.roles)].includes(role.id)) throw new MaikuraError('参加用の「舞倉」ロールを確認してください。運営用・ほかの機能用のロールは使えません。');
    if (!role.editable) throw new MaikuraError('BOTに「ロールの管理」を許可し、BOTのロールを「舞倉」より上に置いてください。');
  }
  private async findRole(guild: Guild, create: boolean, db: Db) {
    await guild.members.fetchMe();
    const roles = await guild.roles.fetch();
    const [saved] = await db.select().from(settings).where(eq(settings.key, KEY));
    const id = (saved?.value as { roleId?: unknown } | undefined)?.roleId;
    let role = typeof id === 'string' ? roles.get(id) : undefined;
    if (!role) {
      const matches = roles.filter(r => r.name.replace(/\s/g, '') === ROLE_NAME);
      if (matches.size > 1) throw new MaikuraError('「舞倉」ロールが複数あります。参加用のロールを1つにしてください。');
      role = matches.first();
      if (!role && create) role = await guild.roles.create({ name: ROLE_NAME, color: 0x4c9865, permissions: 0n, mentionable: false, reason: '舞倉の参加用ロールを用意' });
    }
    if (!role) throw new MaikuraError('「舞倉」ロールがありません。運営に「/パネル 舞倉」で用意してもらってください。');
    this.validate(role);
    return role;
  }
  async onInteraction(i: Interaction) {
    const panel = i.isChatInputCommand() && i.commandName === 'panel' && i.options.getSubcommand(false) === 'maikura';
    const join = i.isButton() && i.customId === 'maikura:join';
    if ((!panel && !join) || !i.inCachedGuild() || i.guildId !== this.cfg().guildId) return;
    await i.deferReply(EPHEMERAL);
    try {
      const member = await i.guild.members.fetch({ user: i.user.id, force: true });
      if (member.user.bot) return void await i.editReply('サーバーのメンバーが使うボタンです。');
      if (panel) {
        if (!adminLevelOf(this.cfg(), [...member.roles.cache.keys()])) return void await i.editReply('神職・宮司のみ置けます。');
        const channel = i.channel;
        if (!channel?.isSendable()) return void await i.editReply('このチャンネルには置けません。');
        const role = await this.db.transaction(async tx => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${KEY}))`);
          const role = await this.findRole(i.guild, true, tx as Db);
          await tx.insert(settings).values({ key: KEY, value: { roleId: role.id }, updatedBy: i.user.id }).onConflictDoUpdate({ target: settings.key, set: { value: { roleId: role.id }, updatedBy: i.user.id, updatedAt: new Date() } });
          return role;
        });
        await channel.send(maikuraPanel());
        await audit(this.db, { actorId: i.user.id, action: 'maikura.panel', detail: { channelId: channel.id, roleId: role.id }, via: 'discord' });
        return void await i.editReply('舞倉のPOPと参加ボタンを置きました。');
      }
      const added = await this.db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`maikura:${i.user.id}`}))`);
        const role = await this.findRole(i.guild, false, tx as Db);
        const current = await i.guild.members.fetch({ user: i.user.id, force: true });
        if (current.roles.cache.has(role.id)) return false;
        await current.roles.add(role.id, '舞倉に参加（本人がボタンを押した）');
        const updated = await i.guild.members.fetch({ user: i.user.id, force: true });
        if (!updated.roles.cache.has(role.id)) throw new MaikuraError('ロールを確認できませんでした。時間をおいてもう一度押してください。');
        await audit(tx as Db, { actorId: i.user.id, targetId: i.user.id, action: 'maikura.join', detail: { roleId: role.id }, via: 'discord' });
        return true;
      });
      await i.editReply(added ? '「舞倉」ロールを付けました。舞倉へようこそ！' : '「舞倉」ロールはすでに付いています。');
    } catch (err) {
      logger.warn({ err }, 'maikura interaction failed');
      await i.editReply(err instanceof MaikuraError ? err.message : 'ロールを付けられませんでした。BOTの権限とロールの位置を運営に確認してください。').catch(() => undefined);
    }
  }
}
