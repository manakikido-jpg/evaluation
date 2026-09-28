import { describe, expect, it } from 'vitest';
import { parseGuildConfig } from '../src/config.js';
import { giftableShopItem } from '../src/services/gacha.js';
import { planOf, roomPrice } from '../src/services/rooms.js';
import { applyOverrides, overridesSchema } from '../src/services/settings.js';
import { canBuyVip, vipCategoryOf, vipHubOverwrites } from '../src/services/vip.js';
import { categoryOf } from '../src/discord/shopViews.js';
import { cfg, ROLE } from './helpers.js';

const VIP = '970000000000000001';
const HUB = '970000000000000002';
const BOT = '970000000000000003';
const ADULT = '970000000000000004';
const CAT = '970000000000000010';
const VIEW = 1n << 10n;
const CONNECT = 1n << 20n;

describe('💎 極（遊郭の VIP）', () => {
  it('入口の権限: ロールと @everyone は見えない・入れない。VIP のロールと BOT だけ。運営のロールはそのまま', () => {
    const category = [
      { id: cfg.guildId, type: 0 as const, allow: '0', deny: String(VIEW) },
      { id: ADULT, type: 0 as const, allow: String(VIEW | CONNECT), deny: '0' },
      { id: ROLE.guji, type: 0 as const, allow: String(VIEW | CONNECT), deny: '0' },
      { id: '970000000000000099', type: 1 as const, allow: String(VIEW), deny: '0' },
    ];
    const o = vipHubOverwrites(category, cfg, VIP, BOT);
    const find = (id: string) => o.find((x) => x.id === id)!;
    expect(BigInt(find(ADULT).allow) & VIEW).toBe(0n);
    expect(BigInt(find(ADULT).deny) & (VIEW | CONNECT)).toBe(VIEW | CONNECT);
    expect(BigInt(find(cfg.guildId).deny) & (VIEW | CONNECT)).toBe(VIEW | CONNECT);
    expect(BigInt(find(ROLE.guji).allow) & VIEW).toBe(VIEW);
    expect(BigInt(find(VIP).allow) & (VIEW | CONNECT)).toBe(VIEW | CONNECT);
    expect(find(BOT).type).toBe(1);
    // 人ごとの上書きは持ってこない
    expect(o.some((x) => x.id === '970000000000000099')).toBe(false);
  });

  it('入口を置くカテゴリ: 名前に遊郭・宵宮。VIP を買えるのは宵参りの人だけ', () => {
    const channels = [
      { id: '970000000000000011', name: '⛩ 鳥居', type: 4, parent_id: null, position: 0 },
      { id: CAT, name: '🏮 遊郭', type: 4, parent_id: null, position: 1 },
    ];
    expect(vipCategoryOf(cfg, channels)?.id).toBe(CAT);
    const adultCfg = { ...cfg, roles: { ...cfg.roles, yoimairi: ADULT } };
    expect(canBuyVip(adultCfg, [ADULT])).toBe(true);
    expect(canBuyVip(adultCfg, [ROLE.sanpaisha])).toBe(false);
  });

  it('設定に入れると、極の入口が通話部屋の入口に足され、部屋代はなし', () => {
    const o = overridesSchema.parse({ rooms: { vip: { roleId: VIP, hubId: HUB } } });
    const c = applyOverrides(parseGuildConfig({ ...cfg }), o);
    expect(c.tempVoice.hubs.find((h) => h.channelId === HUB)).toMatchObject({ plan: 'free', name: '💎 {name}の極の部屋' });
    expect(planOf(c, HUB)).toBe('free');
    expect(roomPrice({ ...c, rooms: { ...c.rooms, once: { public: 50, invite: 100, secret: 300, twoshot: 400 } } }, 'free', 'secret')).toBe(0);
    // 物御籤・全員へのプレゼントでは渡さない。授与所では「極」の仲間
    const item = { kind: 'role', roleId: VIP, roleGroup: 'vip' } as Parameters<typeof giftableShopItem>[0];
    expect(giftableShopItem(item)).toBe(false);
    expect(categoryOf(item)).toBe('vip');
  });
});
