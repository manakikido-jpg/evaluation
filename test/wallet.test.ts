import { describe, expect, it } from 'vitest';
import { walletView } from '../src/discord/wallet.js';
import { emptyTickets } from '../src/services/tickets.js';
import { cfg } from './helpers.js';

describe('/残高', () => {
  it('銭・今日の通話・券・最近の出入りを出す', () => {
    const at = new Date('2026-09-27T12:00:00Z');
    const v = walletView(cfg.economy, {
      balance: 1234,
      lifetimeEarned: 5000,
      today: { vcCoins: 30, vcMinutes: 65 },
      recent: [
        { amount: 500, reason: 'gacha_refund', at },
        { amount: -500, reason: 'gacha', at },
      ],
      tickets: { ...emptyTickets(), fuku: 1 },
      custom: [],
      buffs: { luck: 3 },
    });
    const text = v.embeds[0]!.description;
    for (const t of ['🪙銭 **1,234** 枚', 'これまでにもらった合計 5,000 枚', `今日の通話で 30 / ${cfg.economy.voiceDailyCap} 枚（65 分）`, '🧧福の札 ×1', '運気アップ: 物御籤あと 3 回', '＋500 物御籤の払い戻し', '－500 物御籤'])
      expect(text).toContain(t);
    const empty = walletView(cfg.economy, { balance: 0, lifetimeEarned: 0, today: { vcCoins: 0, vcMinutes: 0 }, recent: [], tickets: emptyTickets(), custom: [], buffs: { luck: 0 } });
    // 役職の倍率があれば、上限もその分
    const ranked = walletView({ ...cfg.economy, voicePer10Min: 10, voiceDailyCap: 150 }, { balance: 0, lifetimeEarned: 0, today: { vcCoins: 30, vcMinutes: 20 }, recent: [], tickets: emptyTickets(), custom: [], buffs: { luck: 0 }, voicePercent: 150, voiceCapPercent: 200 });
    expect(ranked.embeds[0]!.description).toContain('📞 今日の通話で 30 / 300 枚');
    expect(ranked.embeds[0]!.description).toContain('10 分ごと 15 枚（150%）・1 日の上限 200%');
    expect(empty.embeds[0]!.description).toContain('まだありません');
    expect(empty.embeds[0]!.description).toContain('券: なし');
  });
});
