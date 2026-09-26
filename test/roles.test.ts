import { describe, expect, it } from 'vitest';
import { ADMINISTRATOR, botTopPosition, dangerLabels, mergePermissions, permDiff, roleKind } from '../src/services/roles.js';
import { cfg, ROLE } from './helpers.js';

const bit = (n: number) => 1n << BigInt(n);

describe('ロールの権限', () => {
  it('フォームで選んだものにする。フォームにない（知らない）ビットは残す', () => {
    const unknown = bit(47);
    const before = unknown | bit(11) | bit(1);
    const after = mergePermissions(before, [11, 20, 999]);
    expect(after).toBe(unknown | bit(11) | bit(20));
  });

  it('変わった権限の名前と、気をつける権限', () => {
    expect(permDiff(bit(11), bit(20))).toEqual({ added: ['接続'], removed: ['メッセージを送信'] });
    expect(dangerLabels(bit(2) | bit(11))).toEqual(['メンバーを BAN']);
    expect(dangerLabels(ADMINISTRATOR | bit(2))).toEqual(['管理者']);
  });

  it('このサーバーでの役目と、BOT のロールの位置', () => {
    expect(roleKind(cfg, { id: cfg.guildId, name: '@everyone', position: 0, managed: false, color: 0 })).toBe('みんな（@everyone）');
    expect(roleKind(cfg, { id: ROLE.ujiko, name: '氏子', position: 3, managed: false, color: 0 })).toBe('役職（自動で昇格）');
    expect(roleKind(cfg, { id: ROLE.guji, name: '宮司', position: 9, managed: false, color: 0 })).toBe('役職（運営）');
    const roles = [
      { id: '1', name: 'bot', position: 5, managed: true, color: 0, tags: { bot_id: 'me' } },
      { id: '2', name: 'other', position: 8, managed: true, color: 0, tags: { bot_id: 'other' } },
    ];
    expect(botTopPosition(roles, 'me')).toBe(5);
    expect(botTopPosition(roles)).toBe(8);
  });
});
