import { describe, expect, it } from 'vitest';
import { commandDefinitions } from '../src/discord/commands.js';
import { parseShuinId, shuinId } from '../src/discord/ids.js';
import { breakdownLine, giveReply, goshuinchoReply, giversReply, promotionAnnouncement, revokeReply } from '../src/discord/views.js';
import { decidePromotion } from '../src/domain/ranks.js';
import { KeyedLock } from '../src/lib/lock.js';
import { cfg, ROLE } from './helpers.js';

const B = '200000000000000002';

describe('customId', () => {
  it('作って読み戻せる', () => {
    expect(parseShuinId(shuinId('give', B))).toEqual({ action: 'give', userId: B });
    expect(parseShuinId(shuinId('list', B))).toEqual({ action: 'list', userId: B });
  });

  it('知らない形式は無視', () => {
    expect(parseShuinId('shuin:hack:' + B)).toBeUndefined();
    expect(parseShuinId('other:give:' + B)).toBeUndefined();
    expect(parseShuinId('shuin:give:abc')).toBeUndefined();
  });
});

describe('コマンド定義', () => {
  it('右クリックメニュー・全員用・神職用', () => {
    const defs = commandDefinitions(cfg);
    expect(defs.map((d) => d.name)).toEqual(['プロフィール', 'goshuin', 'zandaka', 'yougo', 'menzaifu', 'omikuji', 'gacha', 'bell', 'invite', 'sharedinvite', 'hajimete', 'soudan', 'help', 'panel', 'yaku', 'ban', 'kick', 'gift', 'roomadmin', 'role', 'temprole', 'tempperm', 'minutes', 'memo', 'member']);
    // 神職用は「メンバーをタイムアウト」権限がある人にだけ表示
    const staff = defs.filter((d) => ['sharedinvite', 'panel', 'yaku', 'ban', 'kick', 'gift', 'roomadmin', 'role', 'temprole', 'tempperm', 'minutes', 'memo', 'member'].includes(d.name));
    expect(staff.length).toBe(13);
    expect(staff.every((d) => d.default_member_permissions === '1099511627776')).toBe(true);
    const yaku = defs.find((d) => d.name === 'yaku') as { options: { options?: { name: string; choices?: { value: string }[] }[] }[] };
    expect(yaku.options[0]!.options!.find((o) => o.name === 'reason')!.choices!.map((c) => c.value)).toContain('その他');
  });
});

describe('表示', () => {
  it('押した結果', () => {
    const r = giveReply(B, { kind: 'given', giverRank: cfg.ranks[2]!, weight: 3, goen: 42, restamped: false });
    expect(r.content).toBe(`🌸 <@${B}> さまに朱印を押しました（格 3・ご縁 +3）`);
    expect(r.components?.[0]?.components).toHaveLength(2);
  });

  it('すでに押している', () => {
    expect(giveReply(B, { kind: 'already', weight: 2, goen: 10 }).content).toContain('すでに朱印を押しています（格 2）');
  });

  it('押せない理由', () => {
    expect(giveReply(B, { kind: 'denied', reason: 'yakudoshi' }).content).toContain('厄年');
    expect(giveReply(B, { kind: 'denied', reason: 'self' }).components).toBeUndefined();
  });

  it('取り消し', () => {
    expect(revokeReply(B, { status: 'revoked', weight: 3, goen: 0 }).content).toContain('取り消しました（ご縁 -3）');
    expect(revokeReply(B, { status: 'not_found', goen: 0 }).content).toContain('まだ朱印を押していません');
  });

  it('役職別の内訳は格の高い順', () => {
    expect(breakdownLine(cfg.ranks, { ujiko: 19, shinshoku: 3, sewayaku: 17, old_rank: 1 })).toBe(
      '🎐 神職 3 ・ 🎋 世話役 17 ・ 🍃 氏子 19 ・ old_rank 1',
    );
  });

  it('御朱印帳', () => {
    const r = goshuinchoReply(
      cfg.ranks,
      { id: B, displayName: 'さくら', roleIds: [ROLE.sewayaku] },
      { goen: 142, receivedCount: 51, byRank: { sodai: 8, sewayaku: 17 }, recentGiverIds: ['1', '2'], givenCount: 63 },
    );
    const embed = r.embeds![0]!;
    expect(embed.title).toBe('📕 さくら さまのプロフィール');
    expect(embed.description).toBe('🎋 世話役 ・ ご縁 **142**（総代まで あと 158）');
    const field = (name: string) => embed.fields?.find((f) => f.name === name)?.value;
    expect(field('頂いた朱印')).toContain('51 人');
    expect(field('押した朱印')).toBe('63 人');
  });

  it('プロフィール: 性別・DM・フレンド・称号・参拝した日・自己紹介。ここから朱印を押せる（自分には出さない）', () => {
    const data = { goen: 10, receivedCount: 1, byRank: {}, recentGiverIds: [], givenCount: 0 };
    const owner = { id: B, displayName: 'さくら', roleIds: [ROLE.sanpaisha] };
    const r = goshuinchoReply(cfg.ranks, owner, data, undefined, {
      gender: '♀ 女性',
      dm: '⭕ OK',
      friend: '💬 要相談',
      titles: ['🌙夜更かし'],
      joinedAt: new Date('2026-09-20T03:00:00Z'),
      intro: { url: 'https://discord.com/channels/1/2/3', excerpt: '【名前】さくら' },
      bannerUrl: 'https://cdn.discordapp.com/banners/1/b.png?size=1024',
    });
    expect(r.embeds![0]!.image?.url).toBe('https://cdn.discordapp.com/banners/1/b.png?size=1024');
    const json = JSON.stringify(r);
    for (const t of ['♀ 女性', '⭕ OK', '💬 要相談', '🌙夜更かし', '2026年9月20日', '【名前】さくら', 'https://discord.com/channels/1/2/3']) expect(json).toContain(t);
    expect(json).toContain(`shuin:give:${B}`);
    const mine = JSON.stringify(goshuinchoReply(cfg.ranks, owner, data, undefined, { self: true }));
    expect(mine).not.toContain(`shuin:give:${B}`);
    expect(mine).toContain('まだありません');
  });

  it('いちばん上の役職なら「あと○○」は出ない', () => {
    const r = goshuinchoReply(
      cfg.ranks,
      { id: B, displayName: 'さくら', roleIds: [ROLE.sodai] },
      { goen: 500, receivedCount: 0, byRank: {}, recentGiverIds: [], givenCount: 0 },
    );
    expect(r.embeds![0]!.description).toBe('🏮 総代 ・ ご縁 **500**');
    expect(r.embeds![0]!.fields?.find((f) => f.name === '頂いた朱印')?.value).toBe('まだありません');
  });

  it('朱印をくれた人の一覧（100 人を超えたら「ほか」）', () => {
    const r = giversReply(B, [{ giverId: '1' }], 120);
    expect(r.embeds![0]!.title).toBe('朱印をくれた人（120 人）');
    expect(r.embeds![0]!.description).toContain('ほか 119 人');
  });

  it('昇格の発表', () => {
    const p = decidePromotion(cfg.ranks, [ROLE.ujiko], 100)!;
    expect(promotionAnnouncement(B, p, 100)).toBe(`🌸 <@${B}> さまのご縁が花ひらき、**🎋 世話役** になられました。（ご縁 100）`);
  });
});

describe('KeyedLock', () => {
  it('同じキーは順番に、違うキーは並行に動く', async () => {
    const lock = new KeyedLock();
    const order: string[] = [];
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await Promise.all([
      lock.run('a', async () => {
        await wait(30);
        order.push('a1');
      }),
      lock.run('a', async () => {
        order.push('a2');
      }),
      lock.run('b', async () => {
        order.push('b1');
      }),
    ]);
    expect(order).toEqual(['b1', 'a1', 'a2']);
  });

  it('前の処理が失敗しても次は動く', async () => {
    const lock = new KeyedLock();
    await expect(lock.run('a', async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(lock.run('a', async () => 1)).resolves.toBe(1);
  });
});
