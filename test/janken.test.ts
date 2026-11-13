import { describe, expect, it, vi } from 'vitest';
import { JankenApp, judgeJanken, type Hand } from '../src/discord/janken.js';
import { cfg } from './helpers.js';

const VC = '930000000000000001', OTHER_VC = '930000000000000002';
const A = '830000000000000001', B = '830000000000000002', C = '830000000000000003', D = '830000000000000004';
const m = (entries: [string, Hand][]) => new Map(entries);

describe('✊✌️✋ じゃんけん', () => {
  it('勝ち負け: 2 種類なら勝った手の人が勝ち。全員同じ・3 種類ぜんぶは、あいこ', () => {
    expect(judgeJanken(m([[A, 'rock'], [B, 'scissors']]))).toEqual({ draw: false, winningHand: 'rock', winners: [A] });
    expect(judgeJanken(m([[A, 'paper'], [B, 'rock'], [C, 'paper']]))).toEqual({ draw: false, winningHand: 'paper', winners: [A, C] });
    expect(judgeJanken(m([[A, 'scissors'], [B, 'paper']]))).toMatchObject({ winners: [A] });
    expect(judgeJanken(m([[A, 'rock'], [B, 'rock']]))).toEqual({ draw: true });
    expect(judgeJanken(m([[A, 'rock'], [B, 'scissors'], [C, 'paper']]))).toEqual({ draw: true });
  });

  it('同じ通話の人だけが手を選んで参加し、始めた人が「せーの！」で全員の手を一気に出す', async () => {
    const app = new JankenApp(() => cfg);
    const base = (user: string, vc: string | null) => ({ inCachedGuild: () => true, guildId: cfg.guildId, user: { id: user }, member: { voice: { channelId: vc } }, isRepliable: () => true, replied: false, deferred: false });
    // 通話にいないと始められない
    const out = { ...base(A, null), isChatInputCommand: () => true, commandName: 'janken', channel: { isSendable: () => true }, reply: vi.fn(async () => undefined) };
    await app.onInteraction(out as never);
    expect(JSON.stringify(out.reply.mock.calls)).toContain('通話（VC）に入ってから');
    const cmd = { ...base(A, VC), isChatInputCommand: () => true, commandName: 'janken', channel: { isSendable: () => true }, reply: vi.fn(async () => undefined) };
    await app.onInteraction(cmd as never);
    const open = (cmd.reply.mock.calls as unknown as [{ content: string; components: { components: { custom_id: string; disabled: boolean }[] }[] }][])[0]![0];
    expect(open.content).toContain(`<#${VC}> にいる人が参加できます`);
    const ids = open.components.flatMap((r) => r.components.map((c) => c.custom_id));
    const pick = (hand: Hand) => ids.find((x) => x.endsWith(`:${hand}`))!;
    const start = ids.find((x) => x.startsWith('janken:start:'))!;
    const press = (user: string, vc: string | null, customId: string) => ({ ...base(user, vc), isChatInputCommand: () => false, isButton: () => true, customId, update: vi.fn(async () => undefined), followUp: vi.fn(async () => undefined), reply: vi.fn(async () => undefined) });
    // 1 人だけでは「せーの！」は押せない（ボタンも止めてある）
    expect(open.components[1]!.components[0]!.disabled).toBe(true);
    const a = press(A, VC, pick('rock'));
    await app.onInteraction(a as never);
    const after = (a.update.mock.calls as unknown as [{ content: string }][])[0]![0];
    expect(after.content).toContain(`参加 1 人: <@${A}>`);
    // 手はみんなのメッセージには出さず、本人にだけ知らせる
    expect(after.content).not.toContain('✊ <@');
    expect(JSON.stringify(a.followUp.mock.calls)).toContain('グーを出しました');
    // ほかの通話の人は参加できない
    const d = press(D, OTHER_VC, pick('paper'));
    await app.onInteraction(d as never);
    expect(JSON.stringify(d.reply.mock.calls)).toContain('にいる人だけが参加できます');
    // 選び直せる
    await app.onInteraction(press(B, VC, pick('paper')) as never);
    const b2 = press(B, VC, pick('scissors'));
    await app.onInteraction(b2 as never);
    expect(JSON.stringify(b2.followUp.mock.calls)).toContain('チョキに選び直しました');
    // 始めた人だけが「せーの！」を押せる
    const notHost = press(B, VC, start);
    await app.onInteraction(notHost as never);
    expect(JSON.stringify(notHost.reply.mock.calls)).toContain('始めた');
    const go = press(A, VC, start);
    await app.onInteraction(go as never);
    const result = (go.update.mock.calls as unknown as [{ content: string; allowedMentions: unknown }][])[0]![0];
    expect(result.content).toContain(`✊ <@${A}> 🏆`);
    expect(result.content).toContain(`✌️ <@${B}>`);
    expect(result.content).toContain('グーの勝ち！');
    expect(result.allowedMentions).toEqual({ parse: [] });
    // 終わった回のボタンは使えない。「もう一回」で新しく始まる
    const late = press(C, VC, pick('rock'));
    await app.onInteraction(late as never);
    expect(JSON.stringify(late.reply.mock.calls)).toContain('終わりました');
    const again = press(B, VC, (go.update.mock.calls as unknown as [{ components: { components: { custom_id: string }[] }[] }][])[0]![0].components[0]!.components[0]!.custom_id);
    await app.onInteraction(again as never);
    expect(JSON.stringify(again.reply.mock.calls)).toContain('じゃんけん');
    expect(JSON.stringify(again.reply.mock.calls)).toContain(`<@${B}> さんが「せーの！」`);
  });

  it('15 分たった回は使えない', async () => {
    let t = 0;
    const app = new JankenApp(() => cfg, () => t);
    const cmd = { inCachedGuild: () => true, guildId: cfg.guildId, user: { id: A }, member: { voice: { channelId: VC } }, isRepliable: () => true, isChatInputCommand: () => true, commandName: 'janken', channel: { isSendable: () => true }, reply: vi.fn(async () => undefined) };
    await app.onInteraction(cmd as never);
    const id = (cmd.reply.mock.calls as unknown as [{ components: { components: { custom_id: string }[] }[] }][])[0]![0].components[0]!.components[0]!.custom_id;
    t = 16 * 60_000;
    const late = { ...cmd, isChatInputCommand: () => false, isButton: () => true, customId: id, update: vi.fn(), followUp: vi.fn(), reply: vi.fn(async () => undefined) };
    await app.onInteraction(late as never);
    expect(JSON.stringify(late.reply.mock.calls)).toContain('終わりました');
  });
});
