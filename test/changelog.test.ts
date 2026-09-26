import { describe, expect, it } from 'vitest';
import { CHANGELOG, LATEST_CHANGE_ID, unseenChanges } from '../src/changelog.js';

describe('更新履歴', () => {
  it('id は重ならず、新しい順で、中身がある', () => {
    expect(new Set(CHANGELOG.map((e) => e.id)).size).toBe(CHANGELOG.length);
    for (let i = 1; i < CHANGELOG.length; i++) expect(CHANGELOG[i - 1]!.date >= CHANGELOG[i]!.date).toBe(true);
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.items.length).toBeGreaterThan(0);
      expect(e.where.length).toBeGreaterThan(0);
    }
    expect(LATEST_CHANGE_ID).toBe(CHANGELOG[0]!.id);
  });

  it('読んだところより新しいものだけ「まだ読んでいない」', () => {
    expect(unseenChanges(undefined)).toHaveLength(CHANGELOG.length);
    expect(unseenChanges(LATEST_CHANGE_ID)).toEqual([]);
    expect(unseenChanges(CHANGELOG[2]!.id).map((e) => e.id)).toEqual([CHANGELOG[0]!.id, CHANGELOG[1]!.id]);
    // 消えた id（書き直したなど）なら全部
    expect(unseenChanges('nope')).toHaveLength(CHANGELOG.length);
  });
});
