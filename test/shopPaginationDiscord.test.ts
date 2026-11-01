import { MessageFlags, type Interaction } from 'discord.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { ShopApp } from '../src/discord/shop.js';
import { GachaApp } from '../src/discord/gacha.js';
import { itemDetail } from '../src/discord/presents.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { listItems, seedDefaultItems, updateItem } from '../src/services/shop.js';
import { presentChoices } from '../src/services/presents.js';
import { ticketsOf } from '../src/services/tickets.js';
import { cfg, makeDb } from './helpers.js';

const MEMBER = '760000000000000091';
let db: Db, close: () => Promise<void>, shop: ShopApp;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await seedDefaultItems(db, {
    colors: Array.from({ length: 26 }, (_, n) => ({ roleId: String(760000000000001000n + BigInt(n)), name: `色${n}`, emoji: '🌸' })),
    titles: [],
  });
  await addCoins(db, MEMBER, 1000, 'adjust');
  shop = new ShopApp(db, () => cfg, {} as DiscordActions);
});
afterEach(async () => close());

function interaction(customId: string, value?: string) {
  const i = {
    customId, guildId: cfg.guildId, user: { id: MEMBER }, values: value ? [value] : [],
    member: { premiumSince: null, roles: { cache: new Map() } },
    inCachedGuild: () => true, isButton: () => value === undefined, isStringSelectMenu: () => value !== undefined,
    isModalSubmit: () => false, isChatInputCommand: () => false, isUserSelectMenu: () => false,
    isChannelSelectMenu: () => false, isRepliable: () => true,
    deferred: false, replied: false,
    deferReply: vi.fn(async () => { i.deferred = true; }), deferUpdate: vi.fn(async () => { i.deferred = true; }),
    reply: vi.fn().mockResolvedValue(undefined), editReply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined), showModal: vi.fn().mockResolvedValue(undefined),
  };
  return i;
}
const run = (i: ReturnType<typeof interaction>) => shop.onInteraction(i as unknown as Interaction);
const selected = (i: ReturnType<typeof interaction>): string[] => i.editReply.mock.calls[0]![0].components
  .flatMap((row: { components: { options?: { value: string }[] }[] }) => row.components.flatMap(c => c.options?.map(o => o.value) ?? []));

it('SHOPの次ページで札を選び、買って持ち物から名前の入力画面を開ける', async () => {
  const card = (await listItems(db)).find(i => i.kind === 'name_change')!;
  const first = interaction('shop:open'); await run(first);
  expect(first.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  expect(selected(first)).not.toContain(String(card.id));
  expect(JSON.stringify(first.editReply.mock.calls[0])).toContain('shop:page:1');
  const next = interaction('shop:page:1'); await run(next);
  expect(next.deferUpdate).toHaveBeenCalledOnce();
  expect(next.reply).not.toHaveBeenCalled();
  expect(selected(next)).toContain(String(card.id));
  expect(next.editReply).toHaveBeenCalledWith(expect.objectContaining({ allowedMentions: { parse: [] } }));

  const pick = interaction('shop:pick:fun', String(card.id)); await run(pick);
  expect(JSON.stringify(pick.update.mock.calls[0])).toContain(`shop:buy:${card.id}`);
  const buy = interaction(`shop:buy:${card.id}`); await run(buy);
  expect((await walletOf(db, MEMBER)).balance).toBe(0);
  expect((await ticketsOf(db, MEMBER)).name_change).toBe(1);
  const holding = (await presentChoices(db, MEMBER)).find(h => h.value === 'name_change')!;
  expect(JSON.stringify(itemDetail(holding))).toContain('gacha:use1:name_change');
  const use = interaction('gacha:use1:name_change');
  await new GachaApp(db, () => cfg).onInteraction(use as unknown as Interaction);
  expect(use.showModal.mock.calls[0]![0].toJSON()).toMatchObject({ custom_id: 'gacha:rename' });
  expect((await ticketsOf(db, MEMBER)).name_change).toBe(1);
});

it('ページを開き直すと販売OFFの品は消え、売り切り設定を変更しない', async () => {
  const card = (await listItems(db)).find(i => i.kind === 'name_change')!;
  await updateItem(db, card.id, { enabled: false, price: 2400 });
  const next = interaction('shop:page:1'); await run(next);
  expect(selected(next)).not.toContain(String(card.id));
  expect((await listItems(db)).find(i => i.id === card.id)).toMatchObject({ enabled: false, price: 2400 });
  const buy = interaction(`shop:buy:${card.id}`); await run(buy);
  expect((await ticketsOf(db, MEMBER)).name_change).toBe(0);
  expect((await walletOf(db, MEMBER)).balance).toBe(1000);
});

it('別サーバーからのページ操作は受け付けない', async () => {
  const i = interaction('shop:page:1'); i.guildId = '別サーバー'; await run(i);
  expect(i.deferUpdate).not.toHaveBeenCalled();
  expect(i.editReply).not.toHaveBeenCalled();
});
