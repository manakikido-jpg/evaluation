import { describe, expect, it } from 'vitest';
import { nextVoiceLine, walletView } from '../src/discord/wallet.js';
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

  it('次に通話の銭が入るまで: あと何分で何枚（上限に届いたら、その知らせ）', () => {
    const e = { voicePer10Min: 5 };
    // 4 分 → あと 6 分で +5
    expect(nextVoiceLine(e, { vcCoins: 0, vcMinutes: 4 }, 100)).toEqual(['-# あと **6 分**で +5 枚（2 人以上の通話で、スピーカーミュートしていない時間だけ数えます）']);
    // 0 分・20 分ちょうど → あと 10 分
    expect(nextVoiceLine(e, { vcCoins: 0, vcMinutes: 0 }, 100)[0]).toContain('あと **10 分**で +5 枚');
    expect(nextVoiceLine(e, { vcCoins: 10, vcMinutes: 20 }, 100)[0]).toContain('あと **10 分**で +5 枚');
    // 上限の手前は残りだけ・上限に届いたら知らせ
    expect(nextVoiceLine(e, { vcCoins: 98, vcMinutes: 197 }, 100)[0]).toContain('あと **3 分**で +2 枚');
    expect(nextVoiceLine(e, { vcCoins: 100, vcMinutes: 200 }, 100)).toEqual(['-# 今日の上限に届きました（日本時間の 0 時からまた）']);
    // 役職の倍率（150%）・0% なら出さない
    expect(nextVoiceLine(e, { vcCoins: 0, vcMinutes: 1 }, 150, 150)[0]).toContain('+8 枚');
    expect(nextVoiceLine(e, { vcCoins: 0, vcMinutes: 1 }, 0, 0)).toEqual(['-# 今日の上限に届きました（日本時間の 0 時からまた）']);
    expect(nextVoiceLine(e, { vcCoins: 0, vcMinutes: 1 }, 100, 0)).toEqual([]);
    // /残高 の中にも出る
    const v = walletView(cfg.economy, { balance: 230, lifetimeEarned: 47454, today: { vcCoins: 0, vcMinutes: 4 }, recent: [], tickets: emptyTickets(), custom: [], buffs: { luck: 0 } });
    expect(v.embeds[0]!.description).toContain(`あと **6 分**で +${cfg.economy.voicePer10Min} 枚`);
  });
});
