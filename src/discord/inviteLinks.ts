import { ChannelType, MessageFlags, type ChatInputCommandInteraction, type Guild, type GuildMember, type Interaction, type TextChannel } from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { coreName } from '../lib/names.js';
import { logger } from '../lib/logger.js';
import { activeLinkOf, inviteCountOf, matchJoin, recordInvite, saveLink } from '../services/invites.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/**
 * 招待リンクは BOT だけが作る。/招待リンク で、その人専用のリンク（期限なし）を渡し、
 * だれかが入ったら、使われた回数が増えたリンクから「だれの招待か」を記録する（招待のお礼に使う）。
 */
export class InviteLinkApp {
  private guild?: Guild;
  /** 入った人を 1 人ずつ調べる（回数の比べ合いがずれないように） */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
  ) {}

  /** 起動したとき: 止まっていた間に使われた分は、だれか分からないので回数だけ覚え直す */
  async attach(guild: Guild): Promise<void> {
    this.guild = guild;
    const current = await this.current().catch((err: unknown) => (logger.warn({ err }, 'invite links fetch failed'), undefined));
    if (current) await matchJoin(this.db, current);
  }

  /** 招待リンクを置く入口（#鳥居） */
  private entrance(): TextChannel | undefined {
    const g = this.guild;
    if (!g) return undefined;
    const id = this.cfg().channels.entrance;
    const ch = (id && g.channels.cache.get(id)) || g.channels.cache.find((c) => c.type === ChannelType.GuildText && coreName(c.name) === '鳥居');
    return ch && ch.type === ChannelType.GuildText ? ch : undefined;
  }

  private async current(): Promise<{ code: string; uses: number }[] | undefined> {
    const ch = this.entrance();
    if (!ch) return undefined;
    const invites = await ch.fetchInvites(false);
    return [...invites.values()].map((i) => ({ code: i.code, uses: i.uses ?? 0 }));
  }

  onMemberAdd(member: GuildMember): Promise<void> {
    if (member.guild.id !== this.cfg().guildId || member.user.bot) return Promise.resolve();
    const run = this.queue.then(async () => {
      const current = await this.current();
      if (!current) return;
      const inviterId = await matchJoin(this.db, current);
      if (inviterId && inviterId !== member.id && (await recordInvite(this.db, member.id, inviterId, 'link'))) {
        logger.info({ memberId: member.id, inviterId }, 'joined by invite link');
      }
    });
    this.queue = run.catch((err: unknown) => logger.warn({ err }, 'invite link match failed'));
    return this.queue.then(() => undefined);
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'invite') return;
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      await this.link(interaction);
    } catch (err) {
      logger.warn({ err }, 'invite link failed');
      const content = '招待リンクを作れませんでした。BOT に「招待を作成」「チャンネルの管理」の権限があるか、神職に確かめてもらってください。';
      await (interaction.deferred || interaction.replied ? interaction.editReply({ content }) : interaction.reply({ content, ...EPHEMERAL })).catch(() => undefined);
    }
  }

  private async link(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const cfg = this.cfg();
    const roleIds = [...i.member.roles.cache.keys()];
    if (!cfg.ranks.some((r) => roleIds.includes(r.roleId)) && !adminLevelOf(cfg, roleIds)) {
      return void (await i.reply({ content: '招待リンクは、🔰参拝者 になってから使えます。', ...EPHEMERAL }));
    }
    this.guild ??= i.guild;
    const ch = this.entrance();
    if (!ch) return void (await i.reply({ content: '入口のチャンネル（#鳥居）が見つかりません。神職に知らせてください。', ...EPHEMERAL }));
    await i.deferReply(EPHEMERAL);
    const existing = await activeLinkOf(this.db, i.user.id);
    const current = await this.current();
    let code = existing && current?.some((c) => c.code === existing.code) ? existing.code : undefined;
    if (!code) {
      const inv = await ch.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `招待リンク（${i.member.displayName}）` });
      await saveLink(this.db, { code: inv.code, inviterId: i.user.id, channelId: ch.id, uses: inv.uses ?? 0 });
      code = inv.code;
    }
    const n = await inviteCountOf(this.db, i.user.id);
    const e = cfg.economy;
    const url = `https://discord.gg/${code}`;
    await i.editReply({
      content: [
        '🔗 **あなた専用の招待リンク**',
        '```',
        url,
        '```',
        '-# すぐ下に、リンクだけのメッセージも出します。長押し（右クリック）→「テキストをコピー」でそのままコピーできます',
        'このリンクで入った人は、あなたの招待として記録されます（申請で選ばなくても分かります）。',
        e.inviteReward > 0 ? `招待した人が 🔰参拝者 になると ${e.currencyEmoji}${e.inviteReward} 枚のお礼${e.inviteActiveReward > 0 ? `、その人が浮上した日ごとに ${e.inviteActiveReward} 枚` : ''}が届きます。` : '',
        `-# これまでに招待した人: 参拝者になった ${n.joined} 人${n.pending ? `・まだ ${n.pending} 人` : ''}`,
        '-# 招待リンクは BOT だけが作ります。何度打っても同じリンクです',
      ]
        .filter(Boolean)
        .join('\n'),
    });
    // コピーしやすいように、リンクだけのメッセージ（本人にだけ見える）
    await i.followUp({ content: url, ...EPHEMERAL });
  }
}
