import { describe, expect, it } from 'vitest';
import { parseGuildConfig } from '../src/config.js';
import { applyLayout, mergeIntoConfig, SetupError, tidyGuild, type ApiChannel, type ApiGuild, type ApiRole, type CreateChannelBody, type SetupApi } from '../src/setup/apply.js';
import { FULL, MINIMAL, P, RETIRED, ROLES } from '../src/setup/layout.js';
import example from '../config/guild.example.json' with { type: 'json' };

const GUILD = '960000000000000000';
const BOT = '960000000000000001';
const BOT_ROLE = '960000000000000002';

/** メモリ上の偽 Discord */
function fakeDiscord(opts: { admin?: boolean; community?: boolean; hubPerms?: boolean } = {}) {
  let seq = 100;
  const nextId = () => String(960000000000000000n + BigInt(seq++));
  const roles: ApiRole[] = [
    { id: GUILD, name: '@everyone', position: 0, permissions: String(P.ViewChannel | P.SendMessages), managed: false },
    {
      id: BOT_ROLE,
      name: 'Sakura BOT',
      position: 1,
      permissions: String(opts.admin === false ? 0n : P.Administrator | (opts.hubPerms === false ? 0n : P.ManageChannels | P.MoveMembers)),
      managed: true,
    },
  ];
  const channels: (ApiChannel & { body?: CreateChannelBody })[] = [];
  const messages: { channelId: string; body: unknown }[] = [];
  const created: Parameters<SetupApi['createRole']>[1][] = [];
  let afk: string | null = null;
  const guild: ApiGuild = { id: GUILD, name: 'テスト鯖', afk_channel_id: null, features: opts.community ? ['COMMUNITY'] : [] };
  const api: SetupApi = {
    me: async () => ({ id: BOT }),
    guild: async () => ({ ...guild, afk_channel_id: afk }),
    roles: async () => roles.map((r) => ({ ...r })),
    member: async () => ({ roles: [BOT_ROLE] }),
    createRole: async (_g, body) => {
      created.push(body);
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
      // 本物と同じく、新しいチャンネルは同じ場所のいちばん下にできる
      const ch = { id: nextId(), name, type: body.type, parent_id: body.parent_id ?? null, position: channels.length, body };
      channels.push(ch);
      return ch;
    },
    modifyGuild: async (_g, body) => {
      if (body.afk_channel_id) afk = body.afk_channel_id;
      Object.assign(guild, { ...body, afk_channel_id: null });
    },
    sendMessage: async (channelId, body) => void messages.push({ channelId, body }),
    deleteChannel: async (id) => {
      // 本物と同じく、コミュニティ設定で使われているチャンネルは消せない
      if ([guild.rules_channel_id, guild.public_updates_channel_id].includes(id)) throw new Error('50074 Cannot delete a channel required for Community Servers');
      const i = channels.findIndex((c) => c.id === id);
      if (i < 0) throw new Error('Unknown Channel');
      channels.splice(i, 1);
    },
    reorderChannels: async (_g, body) => {
      for (const o of body) channels.find((c) => c.id === o.id)!.position = o.position;
    },
  };
  /** Discord が最初から作るもの・自分で作ったものを置く */
  const seed = (name: string, type: number, parentName?: string) => {
    const parent = parentName ? channels.find((c) => c.type === 4 && c.name === parentName) : undefined;
    const ch = { id: nextId(), name, type, parent_id: parent?.id ?? null, position: channels.length };
    channels.push(ch);
    return ch;
  };
  return { api, roles, channels, messages, guild, seed, created, getAfk: () => afk };
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
    expect(r.created.roles).toHaveLength(ROLES.length);
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
    expect(r1.panelsPosted).toEqual(['#社務所（入鯖申請）', '#社務所（宵参り申請）', '#授与所（お守り）']);
    expect(d.messages.filter((m) => m.channelId === find(d, '社務所', 0).id)).toHaveLength(2);
    expect(d.messages.filter((m) => m.channelId === find(d, '授与所', 0).id)).toHaveLength(1);
    expect(JSON.stringify(d.messages[0]!.body)).toContain('apply:start');
    expect(JSON.stringify(d.messages[1]!.body)).toContain('yoimairi:start');

    const r2 = await applyLayout(d.api, GUILD, FULL);
    expect(r2.panelsPosted).toEqual([]);
    const r3 = await applyLayout(d.api, GUILD, FULL, { postPanels: true });
    expect(r3.panelsPosted).toHaveLength(3);
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
    expect(r.created.roles).toHaveLength(ROLES.length);
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

describe('片付け（--tidy）', () => {
  const names = (d: ReturnType<typeof fakeDiscord>, catName: string) => {
    const cat = find(d, catName, 4);
    return d.channels.filter((c) => c.parent_id === cat.id).sort((a, b) => a.position! - b.position!).map((c) => c.name);
  };

  it('最小構成のあとで全部の構成にすると、境内に残った 絵馬・慶事・通話テスト を消す（設定の ID は新しいほう）', async () => {
    const d = fakeDiscord();
    await applyLayout(d.api, GUILD, MINIMAL);
    const r = await applyLayout(d.api, GUILD, FULL);
    const done = await tidyGuild(d.api, GUILD, FULL);
    expect(done).toContain('削除: 🌳 境内 / 絵馬');
    expect(done).toContain('削除: 🌳 境内 / 慶事');
    expect(done).toContain('削除: 🌳 境内 / 通話テスト');
    expect(names(d, '🌳 境内')).not.toContain('絵馬');
    expect(names(d, '🌳 境内')).toContain('境内');
    expect(names(d, '📜 掲示')).toContain('絵馬');
    expect(d.channels.some((c) => c.id === r.channelIds.ema)).toBe(true);
    expect(d.channels.some((c) => c.id === r.channelIds.keiji)).toBe(true);
  });

  it('カテゴリとチャンネルを配置どおりに並べる', async () => {
    const d = fakeDiscord();
    await applyLayout(d.api, GUILD, MINIMAL);
    await applyLayout(d.api, GUILD, FULL);
    // 最小構成のカテゴリが先にあるので、掲示・縁日・宿坊は下にできている
    const cats = () => d.channels.filter((c) => c.type === 4).sort((a, b) => a.position! - b.position!).map((c) => c.name);
    expect(cats().indexOf('📜 掲示')).toBeGreaterThan(cats().indexOf('🔒 社務所裏'));
    await tidyGuild(d.api, GUILD, FULL);
    expect(cats()).toEqual(FULL.categories.map((c) => c.name));
    expect(names(d, '🔒 社務所裏').slice(0, 5)).toEqual(['寄合', '申請受付', 'お参り判定', '相談窓口', '記録']);
    // 2 回目はすることがない
    expect(await tidyGuild(d.api, GUILD, FULL)).toEqual([]);
  });

  it('Discord が最初から作る「一般」は消す。自分で作ったチャンネルとそのカテゴリは残す', async () => {
    const d = fakeDiscord();
    d.seed('テキストチャンネル', 4);
    d.seed('一般', 0, 'テキストチャンネル');
    d.seed('雑談部屋', 0, 'テキストチャンネル');
    d.seed('ボイスチャンネル', 4);
    d.seed('一般', 2, 'ボイスチャンネル');
    await applyLayout(d.api, GUILD, FULL);
    const done = await tidyGuild(d.api, GUILD, FULL);
    expect(done).toContain('削除: テキストチャンネル / 一般');
    expect(done).toContain('削除: ボイスチャンネル / 一般');
    expect(done).toContain('削除: カテゴリ ボイスチャンネル');
    expect(d.channels.some((c) => c.name === '雑談部屋')).toBe(true);
    expect(d.channels.some((c) => c.name === 'テキストチャンネル')).toBe(true);
    expect(d.channels.some((c) => c.name === 'ボイスチャンネル')).toBe(false);
    // 配置にないカテゴリは、配置のカテゴリのあとに並ぶ
    const cats = d.channels.filter((c) => c.type === 4).sort((a, b) => a.position! - b.position!).map((c) => c.name);
    expect(cats.at(-1)).toBe('テキストチャンネル');
  });

  it('コミュニティ: ルール・お知らせを #しきたり・#寄合 に付け替えてから、#rules・#moderator-only を消す', async () => {
    const d = fakeDiscord({ community: true });
    d.seed('テキストチャンネル', 4);
    const rules = d.seed('rules', 0, 'テキストチャンネル');
    const mod = d.seed('moderator-only', 0, 'テキストチャンネル');
    Object.assign(d.guild, { rules_channel_id: rules.id, public_updates_channel_id: mod.id });
    await applyLayout(d.api, GUILD, FULL);
    await tidyGuild(d.api, GUILD, FULL);
    expect(d.guild.rules_channel_id).toBe(find(d, 'しきたり', 0).id);
    expect(d.guild.public_updates_channel_id).toBe(find(d, '寄合', 0).id);
    expect(d.guild.safety_alerts_channel_id).toBe(find(d, '寄合', 0).id);
    expect(d.channels.some((c) => c.name === 'rules' || c.name === 'moderator-only')).toBe(false);
    expect(d.channels.some((c) => c.name === 'テキストチャンネル')).toBe(false);
  });

  it('コミュニティでなければ、#rules という名前のチャンネルも消さない', async () => {
    const d = fakeDiscord();
    d.seed('rules', 0);
    await applyLayout(d.api, GUILD, FULL);
    await tidyGuild(d.api, GUILD, FULL);
    expect(d.channels.some((c) => c.name === 'rules')).toBe(true);
  });

  it('最小構成のときは、全部の構成にしかないチャンネルを消さない', async () => {
    const d = fakeDiscord();
    await applyLayout(d.api, GUILD, FULL);
    const before = d.channels.length;
    const done = await tidyGuild(d.api, GUILD, MINIMAL);
    expect(done.filter((t) => t.startsWith('削除'))).toEqual([]);
    expect(d.channels).toHaveLength(before);
  });

  it('確認だけ（--dry-run）は、何を消すかだけ出して何も変えない', async () => {
    const d = fakeDiscord();
    await applyLayout(d.api, GUILD, MINIMAL);
    await applyLayout(d.api, GUILD, FULL);
    const snapshot = JSON.stringify(d.channels);
    const done = await tidyGuild(d.api, GUILD, FULL, { dryRun: true });
    expect(done).toContain('削除: 🌳 境内 / 絵馬');
    expect(JSON.stringify(d.channels)).toBe(snapshot);
  });
});

describe('自分の通話部屋（➕ ○○をひらく）', () => {
  it('入口の通話を作り、設定ファイルの tempVoice.hubs に書く', async () => {
    const d = fakeDiscord();
    const r = await applyLayout(d.api, GUILD, FULL);
    expect(r.hubs.map((h) => h.name)).toEqual(['🍵 {name}の縁側', '🎮 {name}の屋台', '🌙 {name}の宿坊', '🍶 {name}の部屋']);
    expect(r.hubs[0]!.channelId).toBe(find(d, '➕ 縁側をひらく', 2).id);
    const cfg = parseGuildConfig(mergeIntoConfig(example as Record<string, unknown>, GUILD, r));
    expect(cfg.tempVoice.hubs).toEqual(r.hubs);
  });

  it('BOT に「チャンネルの管理」「メンバーを移動」がなければ注意を出す', async () => {
    const d = fakeDiscord({ hubPerms: false });
    d.roles.find((x) => x.id === BOT_ROLE)!.position = 99;
    const r = await applyLayout(d.api, GUILD, FULL);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('チャンネルの管理');
  });

  it('片付けで、前の版の固定の通話（縁側 一 など）を消す。今の配置の通話は残す', async () => {
    const d = fakeDiscord();
    await applyLayout(d.api, GUILD, FULL);
    // 前の版で作られていた通話
    for (const r of RETIRED) d.seed(r.name, 2, r.category);
    d.seed('みんなの部屋', 2, '🌳 境内');
    const done = await tidyGuild(d.api, GUILD, FULL);
    expect(done).toContain('削除: 🌳 境内 / 縁側 一');
    expect(done).toContain('削除: 🔞 宵宮 / 御神酒処');
    for (const r of RETIRED) expect(d.channels.some((c) => c.name === r.name && c.type === 2), r.name).toBe(false);
    // 同じ名前のテキストチャンネル（#御神酒処）と、自分で作った通話は残る
    expect(d.channels.some((c) => c.name === '御神酒処' && c.type === 0)).toBe(true);
    expect(d.channels.some((c) => c.name === 'みんなの部屋')).toBe(true);
    expect(d.channels.some((c) => c.name === '➕ 縁側をひらく')).toBe(true);
  });
});

describe('お守り', () => {
  it('お守りのロールは誰でも @ で呼べる（ほかの役職は呼べない）。設定ファイルに書き、#授与所 にボタンを置く', async () => {
    const d = fakeDiscord();
    const r = await applyLayout(d.api, GUILD, FULL);
    const role = (name: string) => d.roles.find((x) => x.name === name)!;
    const created = d.created;
    expect(created.find((c) => c.name === '🌙 寝落ちのお守り')?.mentionable).toBe(true);
    expect(created.find((c) => c.name === '🔰 参拝者')?.mentionable).toBe(false);

    const cfg = parseGuildConfig(mergeIntoConfig(example as Record<string, unknown>, GUILD, r));
    expect(cfg.roles.omamori.map((o) => [o.label, o.adultOnly])).toEqual([
      ['寝落ち', false],
      ['ゲーム', false],
      ['雑談', false],
      ['宵宮', true],
    ]);
    expect(cfg.roles.omamori[0]!.roleId).toBe(role('🌙 寝落ちのお守り').id);

    const panel = d.messages.find((m) => m.channelId === find(d, '授与所', 0).id)!.body as { components: { components: { custom_id: string }[] }[] };
    expect(panel.components[0]!.components.map((b) => b.custom_id)).toEqual(cfg.roles.omamori.map((o) => `omamori:${o.roleId}`));
  });
});

describe('募集ボタン', () => {
  it('#宿帳・#縁日・#手水舎・#御神酒処 に、お守りと同じカテゴリの ➕ を結びつけて設定に書く', async () => {
    const d = fakeDiscord();
    const r = await applyLayout(d.api, GUILD, FULL);
    const cfg = parseGuildConfig(mergeIntoConfig(example as Record<string, unknown>, GUILD, r));
    const role = (name: string) => d.roles.find((x) => x.name === name)!.id;
    const byLabel = Object.fromEntries(cfg.recruit.panels.map((p) => [p.label, p]));
    expect(Object.keys(byLabel).sort()).toEqual(['ゲーム', '宵宮', '寝落ち', '雑談'].sort());
    expect(byLabel['寝落ち']).toMatchObject({ channelId: find(d, '宿帳', 0).id, roleId: role('🌙 寝落ちのお守り'), hubId: find(d, '➕ 宿坊をひらく', 2).id });
    expect(byLabel['雑談']).toMatchObject({ channelId: find(d, '手水舎', 0).id, hubId: find(d, '➕ 縁側をひらく', 2).id });
    expect(byLabel['宵宮']).toMatchObject({ channelId: find(d, '御神酒処', 0).id, adultOnly: true, hubId: find(d, '➕ 宵宮の部屋をひらく', 2).id });
    expect(cfg.recruit.cooldownMinutes).toBe(10);
  });
});
