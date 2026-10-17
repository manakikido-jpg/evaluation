import type { GuildConfig } from '../config.js';

export const EMA_COUNTER_INTERVAL_MS = 5 * 60_000;
export const EMA_COUNTER_TARGETS = [
  { key: 'sanpaishaMale', rank: 'sanpaisha', gender: 'male', label: '参拝者♂' },
  { key: 'sanpaishaFemale', rank: 'sanpaisha', gender: 'female', label: '参拝者♀' },
  { key: 'ujikoMale', rank: 'ujiko', gender: 'male', label: '氏子♂' },
  { key: 'ujikoFemale', rank: 'ujiko', gender: 'female', label: '氏子♀' },
] as const;
export type EmaCounterKey = typeof EMA_COUNTER_TARGETS[number]['key'];

/** 投稿数やオンライン状態ではなく、役職と性別ロールの両方で数える。 */
export function emaCounts(cfg: GuildConfig, members: Iterable<{ bot: boolean; roles: Iterable<string> }>): Partial<Record<EmaCounterKey, number>> {
  const counts: Partial<Record<EmaCounterKey, number>> = {};
  const targets = EMA_COUNTER_TARGETS.flatMap((t) => {
    const rank = cfg.ranks.find((r) => r.key === t.rank)?.roleId, gender = cfg.roles[t.gender];
    if (!rank || !gender) return [];
    counts[t.key] = 0; return [{ ...t, rank, gender }];
  });
  for (const member of members) {
    if (member.bot) continue;
    const held = new Set(member.roles);
    for (const t of targets) if (held.has(t.rank) && held.has(t.gender)) counts[t.key]!++;
  }
  return counts;
}
export const emaCounterName = (template: string, count: number) => template.replaceAll('{n}', String(count)).slice(0, 100);
