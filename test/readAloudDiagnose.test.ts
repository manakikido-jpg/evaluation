import { describe, expect, it } from 'vitest';
import { startupReason } from '../src/readAloud/diagnose.js';

describe('読み上げの起動失敗のわけ', () => {
  it('Discord のエラーを、秘密を出さない短い言葉にする', () => {
    expect(startupReason({ code: 'TokenInvalid', message: 'An invalid token was provided. abc.def' })).toBe('token_invalid');
    expect(startupReason({ code: 4014 })).toBe('intents_disallowed');
    expect(startupReason({ code: 4004 })).toBe('token_invalid');
    expect(startupReason({ code: 50001 })).toBe('discord_50001');
    // 形のおかしい code は出さない（トークンらしき文字列が混ざっても漏らさない）
    expect(startupReason({ code: 'MTIz.abc.def-ghi' })).toBe('unknown');
    expect(startupReason(new Error('secret'))).toBe('unknown');
    expect(startupReason(null)).toBe('unknown');
  });
});
