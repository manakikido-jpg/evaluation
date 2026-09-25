import { describe, expect, it } from 'vitest';
import { parseGuildConfig } from '../src/config.js';
import { autoRankForGoen, decidePromotion, highestRank, nextAutoRank } from '../src/domain/ranks.js';
import { cfg, ROLE } from './helpers.js';

describe('highestRank（朱印の格）', () => {
  it('持っている役職のうち格がいちばん高いものを返す', () => {
    expect(highestRank(cfg.ranks, [ROLE.ujiko])?.key).toBe('ujiko');
    expect(highestRank(cfg.ranks, [ROLE.sewayaku, ROLE.shinshoku])?.key).toBe('shinshoku');
    expect(highestRank(cfg.ranks, [ROLE.guji, ROLE.shinshoku, ROLE.sodai])?.weight).toBe(10);
  });

  it('役職ロールがなければ undefined', () => {
    expect(highestRank(cfg.ranks, ['123'])).toBeUndefined();
  });
});

describe('autoRankForGoen / nextAutoRank', () => {
  it('ご縁に応じた自動役職', () => {
    expect(autoRankForGoen(cfg.ranks, 0)?.key).toBe('sanpaisha');
    expect(autoRankForGoen(cfg.ranks, 19)?.key).toBe('sanpaisha');
    expect(autoRankForGoen(cfg.ranks, 20)?.key).toBe('ujiko');
    expect(autoRankForGoen(cfg.ranks, 299)?.key).toBe('sewayaku');
    expect(autoRankForGoen(cfg.ranks, 5000)?.key).toBe('sodai');
  });

  it('次の役職まであといくつか', () => {
    expect(nextAutoRank(cfg.ranks, 72)).toMatchObject({ rank: { key: 'sewayaku' }, remaining: 28 });
    expect(nextAutoRank(cfg.ranks, 300)).toBeUndefined();
  });
});

describe('decidePromotion', () => {
  it('基準を超えたら昇格し、古い自動役職ロールを外す', () => {
    const p = decidePromotion(cfg.ranks, [ROLE.sanpaisha], 20);
    expect(p?.from.key).toBe('sanpaisha');
    expect(p?.to.key).toBe('ujiko');
    expect(p?.removeRoleIds).toEqual([ROLE.sanpaisha]);
  });

  it('一気に 2 段階上がることもある', () => {
    const p = decidePromotion(cfg.ranks, [ROLE.sanpaisha], 150);
    expect(p?.to.key).toBe('sewayaku');
  });

  it('基準に届かなければ昇格しない', () => {
    expect(decidePromotion(cfg.ranks, [ROLE.ujiko], 99)).toBeUndefined();
  });

  it('降格はしない', () => {
    expect(decidePromotion(cfg.ranks, [ROLE.sewayaku], 5)).toBeUndefined();
  });

  it('自動役職を持っていない人（神職のみ）は対象外', () => {
    expect(decidePromotion(cfg.ranks, [ROLE.shinshoku], 1000)).toBeUndefined();
  });

  it('神職が自動役職も持っていれば、その自動役職だけ上がる', () => {
    const p = decidePromotion(cfg.ranks, [ROLE.shinshoku, ROLE.ujiko], 100);
    expect(p?.to.key).toBe('sewayaku');
    expect(p?.removeRoleIds).toEqual([ROLE.ujiko]);
  });
});

describe('設定ファイルの検証', () => {
  it('ご縁 0 の自動役職がないとエラー', () => {
    expect(() =>
      parseGuildConfig({
        guildId: '900000000000000000',
        channels: { keiji: '900000000000000001' },
        ranks: [{ key: 'ujiko', name: '氏子', roleId: ROLE.ujiko, weight: 2, auto: true, requiredGoen: 20 }],
      }),
    ).toThrow(/ご縁 0/);
  });

  it('ロール ID の重複はエラー', () => {
    expect(() =>
      parseGuildConfig({
        guildId: '900000000000000000',
        channels: { keiji: '900000000000000001' },
        ranks: [
          { key: 'a', name: 'A', roleId: ROLE.ujiko, weight: 1, auto: true, requiredGoen: 0 },
          { key: 'b', name: 'B', roleId: ROLE.ujiko, weight: 2, auto: true, requiredGoen: 10 },
        ],
      }),
    ).toThrow(/重複/);
  });

  it('config/guild.example.json は正しい形式', async () => {
    const { readFileSync } = await import('node:fs');
    const json = JSON.parse(readFileSync(new URL('../config/guild.example.json', import.meta.url), 'utf8'));
    expect(() => parseGuildConfig(json)).not.toThrow();
  });
});
