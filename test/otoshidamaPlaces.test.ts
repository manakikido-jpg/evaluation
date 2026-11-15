import { describe, expect, it } from 'vitest';
import { otoshidamaSchema, parseGuildConfig } from '../src/config.js';
import { applyOverrides, overridesSchema } from '../src/services/settings.js';
import { cfg } from './helpers.js';

describe('お年玉の受取場所の設定', () => {
  it('古い設定は自動のまま。上書きがない場合はファイルの対象を維持する', () => {
    expect(parseGuildConfig({ ...cfg, otoshidama: undefined }).otoshidama).toEqual({ receiveMode: 'auto', voiceChannelIds: [], categoryIds: [] });
    const places = { receiveMode: 'selected' as const, voiceChannelIds: ['910000000000000001'], categoryIds: ['910000000000000002'] };
    const base = { ...cfg, otoshidama: places };
    expect(applyOverrides(base, overridesSchema.parse({})).otoshidama).toEqual(places);
    // 自動へ戻す明示保存はファイルの対象より優先される。
    expect(applyOverrides(base, overridesSchema.parse({ otoshidama: { receiveMode: 'auto' } })).otoshidama).toEqual({ receiveMode: 'auto', voiceChannelIds: [], categoryIds: [] });
  });

  it('選択方式の対象なし・不正なID・上限超過は設定として読み込まない', () => {
    expect(otoshidamaSchema.safeParse({ receiveMode: 'selected' }).success).toBe(false);
    expect(otoshidamaSchema.safeParse({ receiveMode: 'selected', categoryIds: ['wrong'] }).success).toBe(false);
    expect(otoshidamaSchema.safeParse({ receiveMode: 'selected', categoryIds: Array(51).fill('910000000000000001') }).success).toBe(false);
    expect(otoshidamaSchema.safeParse({ receiveMode: 'selected', voiceChannelIds: ['910000000000000001'] }).success).toBe(true);
  });
});
