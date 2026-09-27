import { MessageFlags, type AutocompleteInteraction, type ChatInputCommandInteraction, type Guild, type Interaction } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { GlossaryTerm } from '../db/schema.js';
import type { GuildChannel } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { byCategory, categoryHeading, GLOSSARY_CHANNEL, listTerms, searchTerms, termLine } from '../services/glossary.js';
import { findChannel, renderNotice } from '../services/notices.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const COLOR = 0xd7003a;

/** サーバーのチャンネル（{#チャンネル} の差し込み用） */
const channelsOf = (g: Guild): GuildChannel[] =>
  [...g.channels.cache.values()].map((c) => ({ id: c.id, name: c.name, type: c.type, parent_id: c.parentId, position: 'position' in c ? c.position : 0 }));

/** /用語（言葉なし）: カテゴリごとの言葉の一覧 */
export function glossaryIndexView(terms: GlossaryTerm[], render: (s: string) => string, hasChannel: boolean) {
  const groups = byCategory(terms);
  if (!groups.length) return { content: 'まだ用語集がありません。', embeds: [] };
  const lines = [
    ...groups.flatMap((g) => [`**${render(categoryHeading(g.category))}**`, g.terms.map((t) => render(t.term)).join(' ・ '), '']),
    `-# \`/用語 天井\` のように言葉を入れると、意味が出ます${hasChannel ? `（くわしい一覧は ${render(`{#${GLOSSARY_CHANNEL}}`)}）` : ''}`,
  ];
  return { embeds: [{ title: '📖 用語集', description: lines.join('\n').slice(0, 4000), color: COLOR }] };
}

/** /用語 言葉: 見つかった言葉の意味（いちばん近いもの。ほかの候補も） */
export function glossaryAnswerView(query: string, found: GlossaryTerm[], render: (s: string) => string) {
  if (!found.length) {
    return { content: `「${query.slice(0, 40)}」は用語集にありませんでした。\`/用語\` だけで一覧が見られます。`, embeds: [] };
  }
  const [top, ...rest] = found;
  const lines = [render(termLine(top!)).replace(/^- /, ''), ...(rest.length ? ['', `-# ほかに: ${rest.map((t) => render(t.term)).join(' ・ ')}`] : [])];
  return { embeds: [{ title: '📖 用語集', description: lines.join('\n').slice(0, 4000), color: COLOR }] };
}

/** /用語: 言葉の意味を自分にだけ出す（入れながら候補も出る） */
export class GlossaryApp {
  private cache?: { at: number; terms: GlossaryTerm[] };

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
  ) {}

  /** 入力のたびに DB を読まないよう 1 分だけ覚える */
  private async terms(): Promise<GlossaryTerm[]> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.terms;
    const terms = await listTerms(this.db, { enabledOnly: true });
    this.cache = { at: Date.now(), terms };
    return terms;
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      if (interaction.isAutocomplete() && interaction.commandName === 'yougo') return await this.suggest(interaction);
      if (interaction.isChatInputCommand() && interaction.commandName === 'yougo') return await this.answer(interaction);
    } catch (err) {
      logger.error({ err }, 'glossary failed');
      if (interaction.isChatInputCommand() && !interaction.replied) {
        await interaction.reply({ content: '用語集を出せませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL }).catch(() => undefined);
      }
    }
  }

  private async suggest(i: AutocompleteInteraction<'cached'>): Promise<void> {
    const cfg = this.cfg();
    const terms = await this.terms();
    const q = String(i.options.getFocused() ?? '');
    const hits = q.trim() ? searchTerms(terms, q, cfg.economy.currencyName, 25) : terms.slice(0, 25);
    const name = (t: GlossaryTerm) => `${t.emoji ? `${t.emoji} ` : ''}${t.term.replaceAll('{通貨}', cfg.economy.currencyName)}${t.reading ? `（${t.reading}）` : ''}`;
    await i.respond(hits.map((t) => ({ name: name(t).slice(0, 100), value: `#${t.id}` })));
  }

  private async answer(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const cfg = this.cfg();
    const terms = await this.terms();
    const channels = channelsOf(i.guild);
    const render = (s: string) => renderNotice(s, cfg, channels).text;
    const word = (i.options.getString('word') ?? '').trim();
    if (!word) return void (await i.reply({ ...glossaryIndexView(terms, render, Boolean(findChannel(channels, GLOSSARY_CHANNEL))), ...EPHEMERAL }));
    // 候補から選んだとき（#番号）
    const picked = /^#(\d+)$/.exec(word);
    const byId = picked ? terms.find((t) => t.id === Number(picked[1])) : undefined;
    const found = byId ? [byId] : searchTerms(terms, word, cfg.economy.currencyName, 5);
    await i.reply({ ...glossaryAnswerView(byId ? byId.term : word, found, render), ...EPHEMERAL });
  }
}
