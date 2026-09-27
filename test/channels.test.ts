import { describe, expect, it } from 'vitest';
import type { GuildChannel } from '../src/lib/discordRest.js';
import { cleanChannelName, listTextChannels, modeOf, planMode, WRITE } from '../src/services/channels.js';
import { cfg, ROLE } from './helpers.js';

const G = cfg.guildId;
const BOT = '970000000000000001';
const VIEW = (1n << 10n) | (1n << 16n);
const SEND = 1n << 11n;
const REACT = 1n << 6n;
const s = (n: bigint) => n.toString();

/** セットアップで作った「一般のメンバーが見られる・書ける」チャンネル */
const writable: GuildChannel = {
  id: '970000000000000010',
  name: '境内',
  type: 0,
  parent_id: null,
  position: 0,
  permission_overwrites: [
    { id: G, type: 0, allow: '0', deny: s(1n << 10n) },
    { id: ROLE.sanpaisha, type: 0, allow: s(VIEW), deny: '0' },
    { id: ROLE.shinshoku, type: 0, allow: s(VIEW), deny: '0' },
    { id: BOT, type: 1, allow: s(VIEW | SEND), deny: '0' },
  ],
};

describe('書き込める／読むだけ', () => {
  it('今の設定から読み取る', () => {
    expect(modeOf(writable, cfg)).toBe('writable');
    const ro = { ...writable, permission_overwrites: [{ id: G, type: 0 as const, allow: '0', deny: s((1n << 10n) | WRITE) }, ...writable.permission_overwrites!.slice(1)] };
    expect(modeOf(ro, cfg)).toBe('readonly');
  });

  it('読むだけにする: みんなは書けない（リアクションはできる）。神職は書ける。BOT の上書きは触らない', () => {
    const plan = planMode(writable, cfg, 'readonly');
    const everyone = plan.find((o) => o.id === G)!;
    expect(BigInt(everyone.deny) & SEND).toBe(SEND);
    expect(BigInt(everyone.deny) & REACT).toBe(0n);
    expect(BigInt(everyone.deny) & (1n << 10n)).toBe(1n << 10n); // 見える範囲はそのまま
    const staff = plan.find((o) => o.id === ROLE.shinshoku)!;
    expect(BigInt(staff.allow) & SEND).toBe(SEND);
    expect(plan.some((o) => o.id === BOT)).toBe(false);
    // 反映したあとは「読むだけ」と読める
    const after = { ...writable, permission_overwrites: writable.permission_overwrites!.map((o) => plan.find((p) => p.id === o.id) ?? o) };
    expect(modeOf(after, cfg)).toBe('readonly');
    // もう一度書き込めるに戻す
    const back = planMode(after, cfg, 'writable');
    const final = { ...after, permission_overwrites: after.permission_overwrites!.map((o) => back.find((p) => p.id === o.id) ?? o) };
    expect(modeOf(final, cfg)).toBe('writable');
    expect(BigInt(final.permission_overwrites!.find((o) => o.id === G)!.deny) & (1n << 10n)).toBe(1n << 10n);
  });

  it('変わらなければ何もしない', () => {
    expect(planMode(writable, cfg, 'writable')).toEqual([]);
  });

  it('上書きがないチャンネルでも、みんなの上書きを作って読むだけにできる', () => {
    const plan = planMode({ ...writable, permission_overwrites: [] }, cfg, 'readonly');
    expect(plan).toEqual([{ id: G, type: 0, allow: '0', deny: s(WRITE) }]);
  });

  it('一覧はカテゴリの順、テキストだけ', () => {
    const groups = listTextChannels([
      { id: 'c2', name: '掲示', type: 4, parent_id: null, position: 1 },
      { id: 'c1', name: '鳥居', type: 4, parent_id: null, position: 0 },
      { id: 'a', name: 'しきたり', type: 0, parent_id: 'c1', position: 1 },
      { id: 'b', name: '鳥居', type: 0, parent_id: 'c1', position: 0 },
      { id: 'v', name: '拝殿', type: 2, parent_id: 'c2', position: 0 },
      { id: 'd', name: '絵馬', type: 0, parent_id: 'c2', position: 0 },
    ]);
    expect(groups.map((g) => [g.category?.name, g.items.map((i) => i.name)])).toEqual([
      ['鳥居', ['鳥居', 'しきたり']],
      ['掲示', ['絵馬']],
    ]);
    expect(groups[1]!.voice.map((v) => v.name)).toEqual(['拝殿']);
  });

  it('名前: 前後の空白を除いて 1〜100 文字', () => {
    expect(cleanChannelName('  🌸｜絵馬 ')).toBe('🌸｜絵馬');
    expect(cleanChannelName('   ')).toBeUndefined();
    expect(cleanChannelName('a'.repeat(101))).toBeUndefined();
    expect(cleanChannelName(undefined)).toBeUndefined();
  });
});

describe('新しいチャンネルの見える範囲', () => {
  const VIEW = 1n << 10n;
  const SEND = 1n << 11n;
  const BOT_ID = '800000000000000099';
  const find = (list: { id: string; allow: string; deny: string }[], id: string) => list.find((o) => o.id === id);

  it('参拝者以上: みんなは見えず、自動の役職は見える。BOT も見て書ける', async () => {
    const { overwritesFor } = await import('../src/services/channels.js');
    const list = overwritesFor(cfg, { visibility: 'members', botId: BOT_ID });
    expect(BigInt(find(list, cfg.guildId)!.deny) & VIEW).toBe(VIEW);
    expect(BigInt(find(list, ROLE.sanpaisha)!.allow) & VIEW).toBe(VIEW);
    expect(BigInt(find(list, ROLE.guji)!.allow) & VIEW).toBe(VIEW);
    expect(BigInt(find(list, BOT_ID)!.allow) & (VIEW | SEND)).toBe(VIEW | SEND);
  });

  it('運営だけ・読むだけ・カテゴリと同じ', async () => {
    const { overwritesFor, modeOf } = await import('../src/services/channels.js');
    const staff = overwritesFor(cfg, { visibility: 'staff' });
    expect(find(staff, ROLE.sanpaisha)).toBeUndefined();
    expect(BigInt(find(staff, ROLE.shinshoku)!.allow) & VIEW).toBe(VIEW);

    const ro = overwritesFor(cfg, { visibility: 'public', readOnly: true });
    expect(modeOf({ id: 'x', name: 'x', type: 0, parent_id: null, position: 0, permission_overwrites: ro }, cfg)).toBe('readonly');

    const parent = { id: 'p', name: 'cat', type: 4, parent_id: null, position: 0, permission_overwrites: [{ id: ROLE.ujiko, type: 0 as const, allow: String(VIEW), deny: '0' }] };
    expect(overwritesFor(cfg, { visibility: 'category', parent })).toEqual(parent.permission_overwrites);
  });
});
