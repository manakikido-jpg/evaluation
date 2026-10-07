import type { GuildConfig } from '../config.js';
import { highestRank } from '../domain/ranks.js';
import type { InviteRewardRow } from './invites.js';

export const INVITE_SORTS = [
  ['joined', '参加日'], ['member', '招待された人の名前'], ['inviter', '招待した人の名前'], ['rank', '今の役職'], ['paid', '支払額（合計）'],
] as const;
export type InviteSort = typeof INVITE_SORTS[number][0];
export type InviteOrder = 'asc' | 'desc';
export const inviteSort = (v?: string): InviteSort => INVITE_SORTS.find(([key]) => key === v)?.[0] ?? 'joined';
export const inviteOrder = (v?: string): InviteOrder => v === 'asc' ? 'asc' : 'desc';

/** 表示対象の200人以内で並び替える。元の記録の順番は変えない。空欄は最後。 */
export function sortInviteRows(rows: readonly InviteRewardRow[], sort: InviteSort, order: InviteOrder, cfg: GuildConfig, name: (id: string) => string): InviteRewardRow[] {
  const value = (r: InviteRewardRow): string | number | null => {
    switch (sort) {
      case 'member': return name(r.memberId);
      case 'inviter': return r.inviterId ? name(r.inviterId) : null;
      case 'rank': return highestRank(cfg.ranks, r.roleIds)?.requiredGoen ?? null;
      case 'paid': return r.reward + r.ujikoReward;
      case 'joined': return r.joinedAt?.getTime() ?? null;
    }
  };
  return [...rows].sort((a, b) => {
    const av = value(a), bv = value(b);
    if (av === null && bv !== null) return 1;
    if (bv === null && av !== null) return -1;
    const cmp = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv, 'ja', { numeric: true }) : typeof av === 'number' && typeof bv === 'number' ? av - bv : 0;
    return cmp * (order === 'asc' ? 1 : -1) || a.memberId.localeCompare(b.memberId);
  });
}
