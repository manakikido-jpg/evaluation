import { describe, expect, it } from 'vitest';
import { explainStartupError } from '../src/lib/startupErrors.js';

describe('起動時のエラーの説明', () => {
  it('インテントの設定漏れ（実際に起きたエラー文そのまま）', () => {
    expect(explainStartupError(new Error('Used disallowed intents'))).toContain('SERVER MEMBERS INTENT');
  });
  it('トークンの間違い', () => {
    expect(explainStartupError(new Error('An invalid token was provided.'))).toContain('Reset Token');
  });
  it('設定ファイルがない・フォルダになっている', () => {
    expect(explainStartupError(new Error("ENOENT: no such file or directory, open 'config/guild.json'"))).toContain('setup');
    expect(explainStartupError(new Error('EISDIR: illegal operation on a directory, read'))).toContain('rm -r config/guild.json');
  });
  it('知らないエラーは説明しない（元のログをそのまま出す）', () => {
    expect(explainStartupError(new Error('something else'))).toBeUndefined();
  });
});
