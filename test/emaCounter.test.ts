import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import { EmaCounterApp } from '../src/discord/emaCounter.js';
import { EMA_COUNTER_TARGETS, emaCounts, emaCounterName } from '../src/services/emaCounter.js';
import { emaCounterSchema, type GuildConfig } from '../src/config.js';
import { applyOverrides, overridesSchema } from '../src/services/settings.js';
import { cfg, ROLE } from './helpers.js';
const male = '100000000000000051', female = '100000000000000052';
const config = (): GuildConfig => ({ ...cfg, roles: { ...cfg.roles, male, female }, emaCounter: emaCounterSchema.parse({ sanpaishaMale: '100000000000000061', sanpaishaFemale: '100000000000000062', ujikoMale: '100000000000000063', ujikoFemale: '100000000000000064' }) });
const member = (roles: string[], bot = false) => ({ bot, roles });
function fixture() {
  const c = config(); let time = 0;
  const members = new Map([['a', { id: 'a', user: { bot: false }, roles: { cache: new Map([[ROLE.sanpaisha, true], [male, true]]) } }]]);
  const channels = new Map(EMA_COUNTER_TARGETS.map((t) => {
    const channel = { type: ChannelType.GuildText, name: String(t.label), setName: vi.fn(async (name: string) => { channel.name = name; }) };
    return [c.emaCounter[t.key], channel] as const;
  }));
  const guild = { id: c.guildId, available: true, members: { cache: members, fetch: vi.fn(async () => members) }, channels: { cache: channels } };
  const app = new EmaCounterApp(() => c, () => time); app.attach(guild as never, true);
  return { app, c, guild, members, channels, advance: (n: number) => { time += n; } };
}
afterEach(() => vi.useRealTimers());
describe('絵馬殿の人数', () => {
  it('役職と性別の両方で数え、BOTや役職・性別のない人を除く', () => {
    const c = config();
    expect(emaCounts(c, [member([ROLE.sanpaisha, male]), member([ROLE.sanpaisha, female]), member([ROLE.ujiko, male]), member([ROLE.ujiko, female]), member([ROLE.sanpaisha, male], true), member([male]), member([ROLE.sanpaisha])])).toEqual({ sanpaishaMale: 1, sanpaishaFemale: 1, ujikoMale: 1, ujikoFemale: 1 });
    // 判定は指定されたロールの所持そのもの。両方あると両方に数える。
    expect(emaCounts(c, [member([ROLE.sanpaisha, ROLE.ujiko, male])])).toMatchObject({ sanpaishaMale: 1, ujikoMale: 1 });
    delete c.roles.female;
    expect(emaCounts(c, [])).not.toHaveProperty('sanpaishaFemale');
  });
  it('表示名を自由に変えられ、空欄・重複ID・人数記号なしを断る', () => {
    expect(emaCounterName('🌸参拝者♂｜{n}人', 12)).toBe('🌸参拝者♂｜12人');
    expect(emaCounterSchema.safeParse({ names: { sanpaishaMale: '人数なし' } }).success).toBe(false);
    expect(emaCounterSchema.safeParse({ sanpaishaMale: '100000000000000061', ujikoMale: '100000000000000061' }).success).toBe(false);
    expect(emaCounterSchema.parse({}).sanpaishaMale).toBe('');
    const base = config(); base.emaCounter.names.ujikoMale = '🍃氏子♂｜{n}人';
    expect(applyOverrides(base, overridesSchema.parse({})).emaCounter).toEqual(base.emaCounter);
    expect(applyOverrides(base, overridesSchema.parse({ emaCounter: {} })).emaCounter.sanpaishaMale).toBe('');
  });
  it('初回から4つを更新し、人数が同じなら送らず、昇格と退出を反映する', async () => {
    const f = fixture(); await f.app.tick();
    expect(f.channels.get(f.c.emaCounter.sanpaishaMale)!.name).toBe('参拝者♂｜1人');
    await f.app.tick(); for (const ch of f.channels.values()) expect(ch.setName).toHaveBeenCalledTimes(1);
    f.members.get('a')!.roles.cache = new Map([[ROLE.ujiko, true], [male, true]]);
    f.advance(60_000); await f.app.tick(); expect(f.channels.get(f.c.emaCounter.sanpaishaMale)!.name).toBe('参拝者♂｜1人');
    f.advance(4 * 60_000); await f.app.tick();
    expect(f.channels.get(f.c.emaCounter.sanpaishaMale)!.name).toBe('参拝者♂｜0人'); expect(f.channels.get(f.c.emaCounter.ujikoMale)!.name).toBe('氏子♂｜1人');
    f.members.clear(); f.advance(5 * 60_000); await f.app.tick(); expect(f.channels.get(f.c.emaCounter.ujikoMale)!.name).toBe('氏子♂｜0人');
  });
  it('人数が同じでも表示名の設定変更を反映し、再接続後は全員を取得し直す', async () => {
    const f = fixture(); f.c.emaCounter.names.sanpaishaMale = '🌸参拝者♂｜{n}人'; await f.app.tick();
    expect(f.channels.get(f.c.emaCounter.sanpaishaMale)!.name).toBe('🌸参拝者♂｜1人');
    f.c.emaCounter.names.sanpaishaMale = '参拝者♂・{n}名'; f.advance(5 * 60_000); f.app.invalidate(); await f.app.tick();
    expect(f.channels.get(f.c.emaCounter.sanpaishaMale)!.name).toBe('参拝者♂・1名'); expect(f.guild.members.fetch).toHaveBeenCalledTimes(1);
  });
  it('全員取得に失敗したら0人で上書きせず、次の確認で取得し直す', async () => {
    const f = fixture(); f.app.attach(f.guild as never, false); f.guild.members.fetch.mockRejectedValueOnce(Error('test unavailable'));
    await f.app.tick(); for (const ch of f.channels.values()) expect(ch.setName).not.toHaveBeenCalled();
    await f.app.tick(); expect(f.guild.members.fetch).toHaveBeenCalledTimes(2); expect(f.channels.get(f.c.emaCounter.sanpaishaMale)!.name).toBe('参拝者♂｜1人');
  });
  it('再取得に含まれない古いキャッシュを数えず、参加・退出のイベントを反映する', async () => {
    vi.useFakeTimers();
    const f = fixture(); const extra = { ...f.members.get('a')!, id: 'stale' }; f.members.set('stale', extra);
    f.app.invalidate(); f.guild.members.fetch.mockResolvedValueOnce(new Map([['a', f.members.get('a')!]])); await f.app.tick();
    expect(f.channels.get(f.c.emaCounter.sanpaishaMale)!.name).toBe('参拝者♂｜1人');
    f.app.memberChanged(f.c.guildId, 'stale', true); f.advance(5 * 60_000); await f.app.tick();
    expect(f.channels.get(f.c.emaCounter.sanpaishaMale)!.name).toBe('参拝者♂｜2人');
    f.app.memberChanged(f.c.guildId, 'stale', false); f.advance(5 * 60_000); await f.app.tick();
    expect(f.channels.get(f.c.emaCounter.sanpaishaMale)!.name).toBe('参拝者♂｜1人'); f.app.close();
  });
  it('全員の取得中に参加・退出しても、古い取得結果で人数を戻さない', async () => {
    vi.useFakeTimers(); const f = fixture(); f.app.invalidate();
    const snapshot = new Map(f.members); let finish!: (value: typeof snapshot) => void;
    f.guild.members.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = f.app.tick();
    f.app.memberChanged(f.c.guildId, 'a', false);
    f.members.set('b', { id: 'b', user: { bot: false }, roles: { cache: new Map([[ROLE.sanpaisha, true], [female, true]]) } });
    f.app.memberChanged(f.c.guildId, 'b', true); finish(snapshot); await pending;
    expect(f.channels.get(f.c.emaCounter.sanpaishaMale)!.name).toBe('参拝者♂｜0人');
    expect(f.channels.get(f.c.emaCounter.sanpaishaFemale)!.name).toBe('参拝者♀｜1人'); f.app.close();
  });
  it('無効・通話チャンネル・設定不足は変更せず、1つの失敗で残りを止めない', async () => {
    const f = fixture(); f.channels.get(f.c.emaCounter.sanpaishaMale)!.setName.mockRejectedValueOnce(Error('test forbidden'));
    f.channels.get(f.c.emaCounter.sanpaishaFemale)!.type = ChannelType.GuildVoice as never;
    await f.app.tick(); expect(f.channels.get(f.c.emaCounter.sanpaishaFemale)!.setName).not.toHaveBeenCalled(); expect(f.channels.get(f.c.emaCounter.ujikoMale)!.name).toBe('氏子♂｜0人');
    const disabled = fixture(); disabled.c.emaCounter = emaCounterSchema.parse({}); await disabled.app.tick(); expect(disabled.guild.members.fetch).not.toHaveBeenCalled(); for (const ch of disabled.channels.values()) expect(ch.setName).not.toHaveBeenCalled();
    const missing = fixture(); delete missing.c.roles.male; await missing.app.tick(); expect(missing.channels.get(missing.c.emaCounter.sanpaishaMale)!.setName).not.toHaveBeenCalled();
  });
  it('同時確認を重ねず、イベントをまとめて確認する', async () => {
    const f = fixture(); let done!: () => void;
    f.channels.get(f.c.emaCounter.sanpaishaMale)!.setName.mockImplementationOnce(() => new Promise<void>((resolve) => { done = resolve; }));
    const pending = f.app.tick(); await f.app.tick(); expect(f.channels.get(f.c.emaCounter.sanpaishaMale)!.setName).toHaveBeenCalledTimes(1); done(); await pending;
    vi.useFakeTimers(); const tick = vi.spyOn(f.app, 'tick'); f.app.schedule('other'); await vi.advanceTimersByTimeAsync(2000); expect(tick).not.toHaveBeenCalled();
    f.app.schedule(f.c.guildId); f.app.schedule(f.c.guildId); await vi.advanceTimersByTimeAsync(1500); expect(tick).toHaveBeenCalledTimes(1);
    f.app.schedule(f.c.guildId); f.app.close(); await vi.advanceTimersByTimeAsync(2000); expect(tick).toHaveBeenCalledTimes(1);
  });
});
