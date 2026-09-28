import { ChannelType, MessageFlags, type ChatInputCommandInteraction, type Guild, type GuildMember, type Interaction, type TextChannel } from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { coreName } from '../lib/names.js';
import { logger } from '../lib/logger.js';
import { activeLinkOf, inviteCodeOf, inviteCountOf, matchJoin, recordInvite, revokeSharedLink, saveLink, SHARED_INVITER, sharedLinkNamed, sharedLinks } from '../services/invites.js';

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
      // 共通の招待リンク（SNS・宣伝用）で入った人は、だれの招待にもしない
      if (inviterId === SHARED_INVITER) return void logger.info({ memberId: member.id }, 'joined by shared invite link');
      if (inviterId && inviterId !== member.id && (await recordInvite(this.db, member.id, inviterId, 'link'))) {
        logger.info({ memberId: member.id, inviterId }, 'joined by invite link');
      }
    });
    this.queue = run.catch((err: unknown) => logger.warn({ err }, 'invite link match failed'));
    return this.queue.then(() => undefined);
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand() || (interaction.commandName !== 'invite' && interaction.commandName !== 'sharedinvite')) return;
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      if (interaction.commandName === 'sharedinvite') return void (await this.shared(interaction));
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

  /** 🔗 /共通招待リンク: 運営が作る、期限なし・回数なしの共通リンク（SNS・ポスター用。だれの招待にもならない） */
  private async shared(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    if (!adminLevelOf(this.cfg(), [...i.member.roles.cache.keys()])) {
      return void (await i.reply({ content: '神職・宮司だけが使えます。', ...EPHEMERAL }));
    }
    this.guild ??= i.guild;
    const sub = i.options.getSubcommand();
    await i.deferReply(EPHEMERAL);
    // 回数の覚え直し（matchJoin）は、入った人を調べる順番（queue）に任せる。ここでは今の回数を見るだけ
    const current = await this.current();
    const uses = new Map((current ?? []).map((c) => [c.code, c.uses]));
    const alive = (code: string) => !current || uses.has(code);
    const nameOf = (label: string | null) => (label ? `「${label}」` : '（名前なし）');

    if (sub === 'list') {
      const links = (await sharedLinks(this.db)).filter((l) => alive(l.code));
      if (!links.length) return void (await i.editReply('共通の招待リンクはまだありません。`/共通招待リンク 作る` で作れます。'));
      const lines = links.map((l) => `- ${nameOf(l.label)} https://discord.gg/${l.code} … 👥 ${uses.get(l.code) ?? l.uses} 回${l.createdBy ? `・作った人 <@${l.createdBy}>` : ''}`);
      return void (await i.editReply({
        content: ['🔗 **共通の招待リンク**（期限なし・回数なし）', ...lines, '-# 回数は、そのリンクから入った人の数です（抜けた人も数えます）'].join('\n').slice(0, 2000),
        allowedMentions: { parse: [] },
      }));
    }

    if (sub === 'delete') {
      const raw = i.options.getString('link', true).trim();
      const links = await sharedLinks(this.db);
      const code = inviteCodeOf(raw);
      const target = links.find((l) => l.code === code) ?? links.find((l) => (l.label ?? '') === raw.replace(/^「|」$/g, ''));
      if (!target) return void (await i.editReply(`「${raw}」という共通の招待リンクは見つかりませんでした。\`/共通招待リンク 一覧\` で確かめてください。`));
      await i.guild.invites.delete(target.code, `共通招待リンクを消す（${i.member.displayName}）`).catch((err: unknown) => {
        // もう Discord にないなら、記録だけ直せばよい
        if ((err as { code?: number }).code !== 10006) throw err;
      });
      await revokeSharedLink(this.db, target.code);
      return void (await i.editReply(`🗑 ${nameOf(target.label)} の招待リンク（https://discord.gg/${target.code}）を使えなくしました。`));
    }

    // make
    const label = i.options.getString('label')?.trim().slice(0, 40) || null;
    const ch = this.entrance();
    if (!ch) return void (await i.editReply('入口のチャンネル（#鳥居）が見つかりません。設定で入口のチャンネルを確かめてください。'));
    const existing = await sharedLinkNamed(this.db, label);
    let code = existing && current && uses.has(existing.code) ? existing.code : undefined;
    const made = !code;
    if (!code) {
      const inv = await ch.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `共通招待リンク${label ? `「${label}」` : ''}（${i.member.displayName}）` });
      await saveLink(this.db, { code: inv.code, inviterId: SHARED_INVITER, channelId: ch.id, uses: inv.uses ?? 0, label, createdBy: i.user.id });
      code = inv.code;
    }
    const url = `https://discord.gg/${code}`;
    await i.editReply({
      content: [
        `🔗 **共通の招待リンク** ${nameOf(label)}${made ? '' : '（前に作ったもの）'}`,
        '```',
        url,
        '```',
        '期限なし・回数なしです。SNS やポスターにそのまま使えます。入った人は #鳥居 に着きます。',
        '-# このリンクで入った人は、だれの招待にもなりません（招待のお礼は出ません）',
        `-# 使われた回数: ${uses.get(code) ?? 0} 回・\`/共通招待リンク 一覧\` で全部見る・\`/共通招待リンク 消す\` で使えなくする`,
        '-# 名前を変えて作ると別のリンクになるので、どこから来た人が多いか分けて数えられます',
      ].join('\n'),
    });
    await i.followUp({ content: url, ...EPHEMERAL });
  }
}
