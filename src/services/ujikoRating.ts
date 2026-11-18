import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { memberAlts, members, shuin, specialGoen } from '../db/schema.js';
import { highestRank } from '../domain/ranks.js';
import { staffAlts } from './staffAlts.js';
import { jstDate } from './activity.js';
import { buildXlsx, type Cell } from './xlsx.js';

/** 氏子を 5 段階で評価するシートの、1 人分 */
export type UjikoRatingRow = {
  memberId: string;
  name: string;
  /** ご縁（取り消しを除く御朱印の重みの合計＋特別ご縁）。メンバーのページと同じ */
  goen: number;
  /** 頂いた朱印の個数（人数）。参考 */
  shuinCount: number;
  joinedAt: Date | null;
};

/** 評価の項目（はじめの目安。エクセルで名前を変えてよい） */
export const UJIKO_RATING_ITEMS = ['活動', '貢献', '人柄', '交流', '協力'] as const;

/**
 * 🍃 今いる氏子（在籍・BOTでない・承認ずみのサブや運営のサブでない）の一覧と、評価の参考になる数。名前順。
 * 最上位の格が「氏子」の人だけ（世話役・総代・神職・宮司は入れない）。
 */
export async function ujikoRatingRows(db: Db, cfg: GuildConfig): Promise<UjikoRatingRow[]> {
  const [people, alts, memberAltRows] = await Promise.all([
    db.select({ id: members.id, name: members.displayName, roleIds: members.roleIds, joinedAt: members.joinedAt })
      .from(members).where(and(eq(members.isBot, false), isNull(members.leftAt))),
    staffAlts(db),
    // 🔗 承認ずみのサブアカウントは、二重に数えないよう対象から外す
    db.select({ id: memberAlts.altId }).from(memberAlts).where(eq(memberAlts.status, 'approved')),
  ]);
  const hidden = new Set([...alts.map((a) => a.id), ...memberAltRows.map((a) => a.id)]);
  const ujiko = people.filter((p) => !hidden.has(p.id) && highestRank(cfg.ranks, p.roleIds)?.key === 'ujiko');
  const ids = ujiko.map((p) => p.id);
  const [stamps, specials] = await Promise.all([
    ids.length ? db.select({ id: shuin.receiverId, n: count(), weight: sql<number>`coalesce(sum(${shuin.weight}), 0)::int` }).from(shuin)
      .where(and(inArray(shuin.receiverId, ids), isNull(shuin.revokedAt))).groupBy(shuin.receiverId) : [],
    ids.length ? db.select({ id: specialGoen.memberId, total: sql<number>`coalesce(sum(${specialGoen.amount}), 0)::int` }).from(specialGoen)
      .where(and(inArray(specialGoen.memberId, ids), isNull(specialGoen.revokedAt))).groupBy(specialGoen.memberId) : [],
  ]);
  const stampMap = new Map(stamps.map((s) => [s.id, s.n]));
  const goenMap = new Map(stamps.map((s) => [s.id, s.weight]));
  const specialMap = new Map(specials.map((s) => [s.id, s.total]));
  return ujiko
    .map((p) => ({
      memberId: p.id,
      name: p.name,
      goen: (goenMap.get(p.id) ?? 0) + (specialMap.get(p.id) ?? 0),
      shuinCount: stampMap.get(p.id) ?? 0,
      joinedAt: p.joinedAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }) || a.memberId.localeCompare(b.memberId));
}

/**
 * 📄 氏子の評価シート（.xlsx）を作る。項目ごとに ★1〜5 を書き込むと、平均が自動で出る。
 * 名前の列などは、エクセルで数式として実行されない文字（inlineStr）で入れる。
 */
export function ujikoRatingXlsx(rows: UjikoRatingRow[], items: readonly string[] = UJIKO_RATING_ITEMS): Uint8Array {
  const header = ['名前', 'Discord ID', 'ご縁', '頂いた朱印（人）', '参加日', ...items, '平均（自動）', 'メモ'];
  // A名前 B ID C ご縁 D 朱印 E 参加日 → 評価の項目は F 列から
  const first = String.fromCharCode(70); // 'F'
  const last = String.fromCharCode(70 + items.length - 1);
  const data: Cell[][] = [header];
  rows.forEach((r, i) => {
    const n = i + 2; // 見出しが 1 行目なので、1 人目は 2 行目
    data.push([
      r.name,
      r.memberId,
      r.goen,
      r.shuinCount,
      r.joinedAt ? jstDate(r.joinedAt) : '',
      ...items.map(() => null),
      { f: `IFERROR(AVERAGE(${first}${n}:${last}${n}),"")` },
      null,
    ]);
  });
  return buildXlsx('氏子の評価', data);
}
