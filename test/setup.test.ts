import { describe, expect, it } from 'vitest';
import { parseGuildConfig } from '../src/config.js';
import { applyLayout, mergeIntoConfig, SetupError, type ApiChannel, type ApiRole, type CreateChannelBody, type SetupApi } from '../src/setup/apply.js';
import { FULL, MINIMAL, P } from '../src/setup/layout.js';
import example from '../config/guild.example.json' with { type: 'json' };

const GUILD = '960000000000000000';
const BOT = '960000000000000001';
const BOT_ROLE = '960000000000000002';

/** メモリ上の偽 Discord */
function fakeDiscord(opts: { admin?: boolean } = {}) {
  let seq = 100;
  const nextId = () => String(960000000000000000n + BigInt(seq++));
  const roles: ApiRole[] = [
    { id: GUILD, name: '@everyone', position: 0, permissions: String(P.ViewChannel | P.SendMessages), managed: false },
    { id: BOT_ROLE, name: 'Sakura BOT', position: 1, permissions: String(opts.admin === false ? 0n : P.Administrator), managed: true },
  ];
  const channels: (ApiChannel & { body?: CreateChannelBody })[] = [];
  const messages: { channelId: string; body: unknown }[] = [];
  let afk: string | null = null;
  const api: SetupApi = {
    me: async () => ({ id: BOT }),
    guild: async () => ({ id: GUILD, name: 'テスト鯖', afk_channel_id: afk }),
    roles: async () => roles.map((r) => ({ ...r })),
    member: async () => ({ roles: [BOT_ROLE] }),
    createRole: async (_g, body) => {
      // 本物の Discord と同じく、新しいロールは BOT のロールより下にはならない
      // （2026-09 の本番テストで確認。BOT のロールを先に上へ動かしておく必要がある）
      for (const r of roles) if (r.position >= 1 && !r.managed) r.position++;
      const role = { id: nextId(), name: body.name, position: 1, permissions: body.permissions, managed: false };
      roles.push(role);
      return role;
    },
    channels: async () => channels.map(({ body: _b, ...c }) => c),
    createChannel: async (_g, body) => {
      const name = body.type === 0 ? body.name.toLowerCase().replace(/\s+/g, '-') : body.name;
      const ch = { id: nextId(), name, type: body.type, parent_id: body.parent_id ?? null, body };
      channels.push(ch);
      return ch;
    },
    modifyGuild: async (_g, body) => void (afk = body.afk_channel_id),
    sendMessage: async (channelId, body) => void messages.push({ channelId, body }),
  };
  return { api, roles, channels, messages, getAfk: () => afk };
}

const find = (d: ReturnType<typeof fakeDiscord>, name: string, type?: number) => d.channels.find((c) => c.name === name && (type === undefined || c.type === type))!;
const ow = (ch: { body?: CreateChannelBody }, id: string) => ch.body!.permission_overwrites.find((o) => o.id === id);
const has = (bits: string | undefined, p: bigint) => (BigInt(bits ?? '0') & p) === p;

describe('セットアップ', () => {
  it('BOT に管理者権限がなければ、理由を出して止まる', async () => {
    const d = fakeDiscord({ admin: false });
    await expect(applyLayout(d.api, GUILD, FULL)).rejects.toThrow(SetupError);
    expect(d.channels).toHaveLength(0);
  });

  it('全部の構成: ロール 8・カテゴリ 7 と、チャンネルを作る', async () => {
    const d = fakeDiscord();
    const r = await applyLayout(d.api, GUILD, FULL);
    expect(r.created.roles).toHaveLength(8);
    const total = FULL.categories.reduce((n, c) => n + 1 + c.channels.length, 0);
    expect(r.created.channels).toHaveLength(total);
    // ロールの並び: 宮司がいちばん上、参拝者がいちばん下
    const pos = (name: string) => d.roles.find((x) => x.name === name)!.position;
    expect(pos('⛩ 宮司')).toBeGreaterThan(pos('🎐 神職'));
    expect(pos('🏮 総代')).toBeGreaterThan(pos('🔰 参拝者'));
    // BOT のロールが下のままなので、上に動かすよう注意が出る（本番で実際に出たもの）
    expect(r.warnings[0]).toContain('BOT のロールより上に');
    // AFK チャンネル
    expect(d.getAfk()).toBe(find(d, '奥の院').id);
  });

  it('見える範囲: 入口は全員、境内は参拝者以上、社務所裏は神職・宮司、宵宮は宵参り（年齢制限）', async () => {
    const d = fakeDiscord();
    const r = await applyLayout(d.api, GUILD, FULL);
    const ids = r.roleIds;

    const torii = find(d, '⛩ 鳥居', 4);
    expect(has(ow(torii, GUILD)?.allow, P.ViewChannel)).toBe(true);
    const shamusho = find(d, '社務所', 0);
    expect(has(ow(shamusho, GUILD)?.deny, P.SendMessages)).toBe(true);

    const keidai = find(d, '境内', 0);
    expect(has(ow(keidai, GUILD)?.deny, P.ViewChannel)).toBe(true);
    expect(has(ow(keidai, ids.sanpaisha)?.allow, P.ViewChannel)).toBe(true);
    expect(has(ow(keidai, ids.sodai)?.allow, P.ViewChannel)).toBe(true);
    expect(ow(keidai, ids.yoimairi)).toBeUndefined();

    const staff = find(d, '申請受付', 0);
    expect(has(ow(staff, ids.guji)?.allow, P.ViewChannel)).toBe(true);
    expect(ow(staff, ids.sanpaisha)).toBeUndefined();

    const yoimiya = d.channels.find((c) => c.name === '宵宮' && c.type === 0)!;
    expect(yoimiya.body?.nsfw).toBe(true);
    expect(has(ow(yoimiya, ids.yoimairi)?.allow, P.ViewChannel)).toBe(true);
    expect(ow(yoimiya, ids.sanpaisha)).toBeUndefined();

    // 慶事は一般の人は書き込めないが、神職は書ける
    const keiji = find(d, '慶事', 0);
    expect(has(ow(keiji, GUILD)?.deny, P.SendMessages)).toBe(true);
    expect(has(ow(keiji, ids.shinshoku)?.allow, P.SendMessages)).toBe(true);

    // BOT は管理者権限を外しても、どこでも見る・書くことができる
    for (const ch of d.channels) {
      const bot = ow(ch, BOT);
      expect(bot?.type).toBe(1);
      expect(has(bot?.allow, P.ViewChannel | P.SendMessages)).toBe(true);
    }
  });

  it('社務所に申請ボタンを置く（2 回目は置かない）', async () => {
    const d = fakeDiscord();
    const r1 = await applyLayout(d.api, GUILD, FULL);
    expect(r1.panelsPosted).toHaveLength(2);
    expect(d.messages.every((m) => m.channelId === find(d, '社務所', 0).id)).toBe(true);
    expect(JSON.stringify(d.messages[0]!.body)).toContain('apply:start');
    expect(JSON.stringify(d.messages[1]!.body)).toContain('yoimairi:start');

    const r2 = await applyLayout(d.api, GUILD, FULL);
    expect(r2.panelsPosted).toEqual([]);
    const r3 = await applyLayout(d.api, GUILD, FULL, { postPanels: true });
    expect(r3.panelsPosted).toHaveLength(2);
  });

  it('何度実行しても同じものは作らない', async () => {
    const d = fakeDiscord();
    const r1 = await applyLayout(d.api, GUILD, FULL);
    const before = { roles: d.roles.length, channels: d.channels.length };
    const r2 = await applyLayout(d.api, GUILD, FULL);
    expect(r2.created).toEqual({ roles: [], channels: [] });
    expect({ roles: d.roles.length, channels: d.channels.length }).toEqual(before);
    expect(r2.roleIds).toEqual(r1.roleIds);
    expect(r2.channelIds).toEqual(r1.channelIds);
  });

  it('最小構成のあとで全部の構成を実行すると、足りない分だけ作る', async () => {
    const d = fakeDiscord();
    await applyLayout(d.api, GUILD, MINIMAL);
    const r = await applyLayout(d.api, GUILD, FULL);
    expect(r.created.roles).toEqual([]);
    expect(r.reused.channels).toBeGreaterThan(0);
    expect(r.created.channels).not.toContain('⛩ 鳥居');
  });

  it('確認だけ（--dry-run）は何も作らない', async () => {
    const d = fakeDiscord();
    const r = await applyLayout(d.api, GUILD, FULL, { dryRun: true });
    expect(r.created.roles).toHaveLength(8);
    expect(d.roles).toHaveLength(2);
    expect(d.channels).toHaveLength(0);
    expect(d.messages).toHaveLength(0);
  });

  it('先に BOT のロールをいちばん上に動かしておけば、注意は出ない', async () => {
    const d = fakeDiscord();
    d.roles.find((r) => r.id === BOT_ROLE)!.position = 99;
    const r = await applyLayout(d.api, GUILD, FULL);
    expect(r.warnings).toEqual([]);
  });

  it('役職ロールが BOT のロールより上にあると注意を出す', async () => {
    const d = fakeDiscord();
    await applyLayout(d.api, GUILD, MINIMAL);
    d.roles.find((r) => r.name === '🔰 参拝者')!.position = 99;
    const r = await applyLayout(d.api, GUILD, MINIMAL);
    expect(r.warnings[0]).toContain('🔰 参拝者');
  });

  it('作った ID を設定ファイルに書くと、正しい設定になる', async () => {
    const d = fakeDiscord();
    const r = await applyLayout(d.api, GUILD, FULL);
    const cfg = parseGuildConfig(mergeIntoConfig(example as Record<string, unknown>, GUILD, r));
    expect(cfg.guildId).toBe(GUILD);
    expect(cfg.channels.applications).toBe(find(d, '申請受付', 0).id);
    expect(cfg.channels.keiji).toBe(find(d, '慶事', 0).id);
    expect(cfg.roles.yoimairi).toBe(r.roleIds.yoimairi);
    expect(cfg.ranks.find((x) => x.key === 'sanpaisha')?.roleId).toBe(r.roleIds.sanpaisha);
    expect(cfg.ranks.find((x) => x.key === 'guji')?.roleId).toBe(r.roleIds.guji);
    // 見本の経済設定などはそのまま
    expect(cfg.economy.menzaifuPrice).toBe(300);
  });
});
