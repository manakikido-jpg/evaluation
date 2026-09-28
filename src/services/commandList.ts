import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
import { commandDefinitions } from '../discord/commands.js';

/**
 * ⌨ コマンドのまとめ: BOT が登録するコマンド（src/discord/commands.ts）から作るので、コマンドを足すと自動で増える。
 * 社務所Web の「コマンド」ページと、掲示の {コマンド一覧} に使う。
 */

export type CommandOptionInfo = { name: string; description: string; required: boolean };
export type CommandInfo = {
  /** 日本語の名前（/ は付けない） */
  name: string;
  description: string;
  /** 運営だけ（「メンバーをタイムアウト」の権限がある人にだけ出る） */
  staff: boolean;
  /** menu = 名前を右クリック（スマホは長押し）→ アプリ */
  kind: 'slash' | 'menu';
  options: CommandOptionInfo[];
  subcommands: { name: string; description: string; options: CommandOptionInfo[] }[];
};

type RawOption = {
  type: number;
  name: string;
  name_localizations?: Loc;
  description: string;
  description_localizations?: Loc;
  required?: boolean;
  options?: RawOption[];
};

type Loc = { ja?: string | null } | null | undefined;
const ja = (name: string, loc?: Loc) => loc?.ja ?? name;
/** 日本語の説明がなければ出さない（英語の短い説明は中の目印なので） */
const jaDesc = (loc?: Loc) => loc?.ja ?? '';
/** 【神職】などの印は、ここでは分けて出すので外す */
const cleanDesc = (s: string) => s.replace(/【[^】]*】/g, '').trim();

const optionsOf = (list: RawOption[] | undefined): CommandOptionInfo[] =>
  (list ?? [])
    .filter((o) => o.type !== 1 && o.type !== 2)
    .map((o) => ({ name: ja(o.name, o.name_localizations), description: cleanDesc(jaDesc(o.description_localizations)), required: Boolean(o.required) }));

export function commandList(defs: RESTPostAPIApplicationCommandsJSONBody[] = commandDefinitions()): CommandInfo[] {
  return defs.map((d) => {
    const raw = d as RESTPostAPIApplicationCommandsJSONBody & { options?: RawOption[]; description?: string; description_localizations?: Loc };
    const menu = raw.type === 2 || raw.type === 3;
    const subs = (raw.options ?? []).filter((o) => o.type === 1);
    return {
      name: ja(raw.name, raw.name_localizations),
      description: menu ? '名前を右クリック（スマホは長押し）→「アプリ」から使う' : cleanDesc(jaDesc(raw.description_localizations) || raw.description || ''),
      staff: raw.default_member_permissions !== undefined && raw.default_member_permissions !== null,
      kind: menu ? 'menu' : 'slash',
      options: optionsOf(raw.options),
      subcommands: subs.map((s) => ({ name: ja(s.name, s.name_localizations), description: cleanDesc(jaDesc(s.description_localizations)), options: optionsOf(s.options) })),
    };
  });
}

/** 掲示の {コマンド一覧}: メンバーが使えるコマンドの箇条書き */
export function memberCommandsText(list: CommandInfo[] = commandList()): string {
  return list
    .filter((c) => !c.staff)
    .map((c) => (c.kind === 'menu' ? `- **${c.name}** … ${c.description}` : `- \`/${c.name}\` … ${c.description}`))
    .join('\n');
}

/** Discord の /コマンド: カードで出す（運営には運営のコマンドも） */
export function helpEmbeds(list: CommandInfo[], opts: { staff: boolean }): { title: string; description: string; color: number }[] {
  const line = (c: CommandInfo) => {
    if (c.kind === 'menu') return `- **🖱 ${c.name}** … ${c.description}`;
    const subs = c.subcommands.length ? `\n  -# ${c.subcommands.map((s) => s.name).join('・')}` : '';
    return `- \`/${c.name}\` … ${c.description}${subs}`;
  };
  const members = list.filter((c) => !c.staff);
  const out = [
    {
      title: '⌨ だれでも使えるコマンド',
      description: [...members.map(line), '', '-# `/` を打つと出てきます。名前を右クリック（スマホは長押し）→「アプリ」からも使えます'].join('\n').slice(0, 4000),
      color: 0xd7003a,
    },
  ];
  if (opts.staff) {
    out.push({ title: '🛡 運営のコマンド（神職・宮司）', description: list.filter((c) => c.staff).map(line).join('\n').slice(0, 4000), color: 0x8a6d3b });
  }
  return out;
}
