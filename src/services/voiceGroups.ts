import type { VoiceGroup } from '../config.js';
import { coreName } from '../lib/names.js';

/**
 * 自動で増える通話（例: 大きな縁側 1・2・3）。
 * - 全部に人がいたら、いちばん大きい番号の次（4）を、その下に作る（max まで）
 * - 空きが 2 つ以上あれば、min より大きい番号の空いている通話を、大きい番号から消す（空きは 1 つ残す）
 * いつも min 個以上あって、空きが 1 つある状態にする。
 */

export type GroupChannel = { id: string; name: string; position: number; members: number };
export type GroupMember = GroupChannel & { num: number };
export type GroupPlan = { create?: { name: string; afterId: string }; remove: string[] };

const FULL = '０１２３４５６７８９';
/** その名前の仲間（番号付き）。番号の小さい順 */
export function groupMembers(channels: GroupChannel[], group: Pick<VoiceGroup, 'name'>): GroupMember[] {
  const base = coreName(group.name);
  if (!base) return [];
  return channels
    .flatMap((c) => {
      const m = /^(.*?)(\d+)$/.exec(coreName(c.name));
      return m && m[1] === base ? [{ ...c, num: Number(m[2]) }] : [];
    })
    .sort((a, b) => a.num - b.num || a.position - b.position);
}

/** 番号だけ変えた名前（「大きな縁側 3」→「大きな縁側 4」。全角の数字なら全角のまま） */
export function renumber(name: string, num: number): string {
  const m = /([0-9０-９]+)(?!.*[0-9０-９])/.exec(name);
  if (!m) return `${name} ${num}`;
  const full = /[０-９]/.test(m[1]!);
  const digits = full ? String(num).replace(/\d/g, (d) => FULL[Number(d)]!) : String(num);
  return name.slice(0, m.index) + digits + name.slice(m.index + m[1]!.length);
}

export function planGroup(channels: GroupChannel[], group: VoiceGroup): GroupPlan {
  const list = groupMembers(channels, group);
  if (!list.length) return { remove: [] };
  const empty = list.filter((c) => c.members === 0);
  // 全部埋まった・min に足りない → 次の番号を作る
  if (!empty.length || list.length < group.min) {
    const last = list[list.length - 1]!;
    if (list.length >= group.max) return { remove: [] };
    return { create: { name: renumber(last.name, last.num + 1), afterId: last.id }, remove: [] };
  }
  // 空きを 1 つだけ残して、min より大きい番号の空いている通話を、大きい番号から消す
  const remove: string[] = [];
  let total = list.length;
  let spare = empty.length;
  for (const c of [...empty].sort((a, b) => b.num - a.num)) {
    if (spare <= 1 || total <= group.min) break;
    if (c.num <= group.min) continue;
    remove.push(c.id);
    total--;
    spare--;
  }
  return { remove };
}
