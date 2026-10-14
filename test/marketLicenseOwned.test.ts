import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Interaction } from 'discord.js';
import type { Db } from '../src/db/client.js';
import { members, shopItems, shopPurchases } from '../src/db/schema.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { buyRole, updateItem } from '../src/services/shop.js';
import { bidRequest, createListing, createRequest, marketLicenseAccess } from '../src/services/market.js';
import { MarketApp } from '../src/discord/market.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { cfg, makeDb } from './helpers.js';
import { eq } from 'drizzle-orm';
const OWNER = '760000000000000001',
  OTHER = '760000000000000002',
  ROLE = '100000000000000088',
  NOW = new Date('2026-10-14T06:00:00Z');
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    { id: OWNER, username: 'owner', displayName: 'owner', ageGroup: 'adult' },
    { id: OTHER, username: 'other', displayName: 'other', ageGroup: 'adult' },
  ]);
});
afterEach(async () => close());
const listing = { category: 'voice', title: 'ボイメします', description: '歌', price: 50 };
async function license(name = '開業') {
  const [item] = await db.insert(shopItems).values({ kind: 'role', name, price: 3000, roleId: ROLE }).returning();
  return item!;
}
async function purchase() {
  const item = await license();
  await addCoins(db, OWNER, 5000, 'adjust');
  expect((await buyRole(db, item, OWNER)).status).toBe('ok');
  return item;
}
it('授与所がもう持っていますとなる所有者は、ロールなしでも入口・出品・引受けを通す', async () => {
  const item = await purchase();
  expect((await buyRole(db, item, OWNER)).status).toBe('owned');
  const owner = { id: OWNER, roleIds: [] };
  expect((await createListing(db, cfg, owner, listing)).status).toBe('ok');
  const req = await createRequest(db, OTHER, { ...listing, budget: 50 });
  if (req.status !== 'ok') throw Error(req.status);
  expect((await bidRequest(db, cfg, req.request.id, owner, 50, '歌います')).status).toBe('ok');
  const reply = vi.fn().mockResolvedValue(undefined);
  const i = {
    inCachedGuild: () => true,
    guildId: cfg.guildId,
    isButton: () => true,
    isModalSubmit: () => false,
    customId: 'market:new',
    member: { id: OWNER, roles: { cache: new Map() } },
    user: { id: OWNER },
    reply,
  } as unknown as Interaction;
  await new MarketApp(db, () => cfg, {} as DiscordActions).onInteraction(i);
  expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('何を出品') }));
  expect((await walletOf(db, OWNER)).balance).toBe(2000);
});
it('設定にない授与品の開業ロールも認め、別の人の購入は認めない', async () => {
  await purchase();
  expect((await marketLicenseAccess(db, cfg, { id: OTHER, roleIds: [ROLE] }, NOW)).allowed).toBe(true);
  expect((await marketLicenseAccess(db, cfg, { id: OTHER, roleIds: [] }, NOW)).allowed).toBe(false);
});
it('開業権利という既定の名前も認める', async () => {
  const item = await license('開業権利');
  await db.insert(shopPurchases).values({ memberId: OWNER, itemId: item.id, kind: 'role', price: 3000, roleId: ROLE });
  expect((await createListing(db, cfg, { id: OWNER, roleIds: [] }, listing)).status).toBe('ok');
});
it('ロール変更や販売停止でも有効な同じ授与品の権利は残る', async () => {
  const item = await purchase();
  await updateItem(db, item.id, { roleId: '100000000000000099', enabled: false });
  expect((await marketLicenseAccess(db, cfg, { id: OWNER, roleIds: [] }, NOW)).allowed).toBe(true);
});
it('期限切れ・払い戻し・取り消し済みの購入は権利にならない', async () => {
  const item = await license();
  const [p] = await db
    .insert(shopPurchases)
    .values({ memberId: OWNER, itemId: item.id, kind: 'role', price: 3000, roleId: ROLE, expiresAt: NOW })
    .returning();
  expect((await marketLicenseAccess(db, cfg, { id: OWNER, roleIds: [] }, NOW)).allowed).toBe(false);
  await db.update(shopPurchases).set({ expiresAt: null, endedAt: NOW }).where(eq(shopPurchases.id, p!.id));
  expect((await marketLicenseAccess(db, cfg, { id: OWNER, roleIds: [] }, NOW)).allowed).toBe(false);
});
it('別の称号や色守り、ロール以外の購入で開業できない', async () => {
  const [item] = await db
    .insert(shopItems)
    .values({ kind: 'role', name: '開業', price: 3000, roleId: ROLE, roleGroup: 'title' })
    .returning();
  await db.insert(shopPurchases).values({ memberId: OWNER, itemId: item!.id, kind: 'role', price: 3000, roleId: ROLE });
  expect((await marketLicenseAccess(db, cfg, { id: OWNER, roleIds: [] }, NOW)).allowed).toBe(false);
  const real = await license();
  await updateItem(db, real.id, { roleId: '100000000000000099' });
  await db.insert(shopPurchases).values({ memberId: OWNER, itemId: real.id, kind: 'gift', price: 3000, roleId: '100000000000000099' });
  expect((await marketLicenseAccess(db, cfg, { id: OWNER, roleIds: [] }, NOW)).allowed).toBe(false);
});
it('購入済みでも年齢制限は変えない', async () => {
  await purchase();
  await db.update(members).set({ ageGroup: 'minor' }).where(eq(members.id, OWNER));
  expect((await createListing(db, cfg, { id: OWNER, roleIds: [] }, { ...listing, category: 'call' })).status).toBe('adult_only');
});
