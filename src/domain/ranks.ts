import type { Rank } from '../config.js';

/** 持っているロールの中で、いちばん格が高い役職（朱印の格はこれで決まる） */
export function highestRank(ranks: readonly Rank[], roleIds: Iterable<string>): Rank | undefined {
  const held = new Set(roleIds);
  let best: Rank | undefined;
  for (const r of ranks) {
    if (held.has(r.roleId) && (!best || r.weight > best.weight)) best = r;
  }
  return best;
}

/** 自動昇格の役職を、必要なご縁の少ない順に */
export function autoRanks(ranks: readonly Rank[]): Rank[] {
  return ranks.filter((r) => r.auto).sort((a, b) => a.requiredGoen - b.requiredGoen);
}

/** 持っている自動役職のうち、いちばん上のもの */
export function currentAutoRank(ranks: readonly Rank[], roleIds: Iterable<string>): Rank | undefined {
  const held = new Set(roleIds);
  return autoRanks(ranks)
    .filter((r) => held.has(r.roleId))
    .at(-1);
}

/** ご縁から見て、なれる自動役職のうちいちばん上のもの */
export function autoRankForGoen(ranks: readonly Rank[], goen: number): Rank | undefined {
  return autoRanks(ranks)
    .filter((r) => r.requiredGoen <= goen)
    .at(-1);
}

/** 次の自動役職と、あといくつ必要か。いちばん上なら undefined */
export function nextAutoRank(ranks: readonly Rank[], goen: number): { rank: Rank; remaining: number } | undefined {
  const next = autoRanks(ranks).find((r) => r.requiredGoen > goen);
  return next ? { rank: next, remaining: next.requiredGoen - goen } : undefined;
}

export type Promotion = {
  from: Rank;
  to: Rank;
  /** 外すロール（今持っている自動役職のうち to 以外） */
  removeRoleIds: string[];
};

/**
 * 昇格が必要か判定する。
 * - 自動役職を 1 つも持っていない人（未承認・神職のみ等）は対象外
 * - 降格はしない（ご縁が減っても今の役職のまま）
 */
export function decidePromotion(ranks: readonly Rank[], roleIds: Iterable<string>, goen: number): Promotion | undefined {
  const held = [...roleIds];
  const current = currentAutoRank(ranks, held);
  if (!current) return undefined;
  const target = autoRankForGoen(ranks, goen);
  if (!target || target.requiredGoen <= current.requiredGoen) return undefined;
  const heldSet = new Set(held);
  const removeRoleIds = autoRanks(ranks)
    .filter((r) => r.key !== target.key && heldSet.has(r.roleId))
    .map((r) => r.roleId);
  return { from: current, to: target, removeRoleIds };
}

export function rankLabel(rank: Rank | undefined): string {
  if (!rank) return '（役職なし）';
  return rank.emoji ? `${rank.emoji} ${rank.name}` : rank.name;
}
