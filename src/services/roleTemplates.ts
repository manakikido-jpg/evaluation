import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { roleTemplates } from '../db/schema.js';
import { ADMINISTRATOR, ALL_PERMS } from './roles.js';

/**
 * 📋 ロールの権限のテンプレート。はじめからあるもの（b:key）と、運営が今のロールから作ったもの（c:id）。
 * テンプレートは「チェックをまとめて付ける」だけで、保存するまで Discord は変わらない
 */

export type RoleTemplate = { key: string; name: string; note: string; bits: bigint; builtin: boolean };

const bitsOf = (list: number[]) => list.reduce((m, b) => m | (1n << BigInt(b)), 0n);

/** ふつうのメンバー: 見る・書く・スレッド・添付・リアクション・通話・アプリ・投票 */
const MEMBER = [10, 16, 11, 38, 35, 36, 14, 15, 6, 18, 31, 46, 49, 20, 21, 9, 25, 42, 39, 0, 26];
const HELPER = [...MEMBER, 13, 34, 40, 27, 22, 23, 24, 7];

export const BUILTIN_ROLE_TEMPLATES: RoleTemplate[] = [
  { key: 'b:member', name: '🙂 ふつうのメンバー', note: '見る・書く・スレッド・添付・リアクション・通話・画面共有・アプリ・投票・招待', bits: bitsOf(MEMBER), builtin: true },
  { key: 'b:readonly', name: '👀 見るだけ', note: 'チャンネルを見る・履歴を読む・リアクションだけ（書けない・話せない）', bits: bitsOf([10, 16, 6]), builtin: true },
  { key: 'b:voice', name: '🎙 通話だけ', note: '見る・履歴を読む・通話に入って話す・画面共有（書き込みはできない）', bits: bitsOf([10, 16, 20, 21, 25, 9, 42]), builtin: true },
  { key: 'b:event', name: '🎉 イベント係', note: 'ふつうのメンバー ＋ イベントを作る・管理する・優先スピーカー', bits: bitsOf([...MEMBER, 33, 44, 8]), builtin: true },
  {
    key: 'b:helper',
    name: '🧹 見回り',
    note: 'ふつうのメンバー ＋ メッセージ・スレッドの管理・タイムアウト・ニックネームの管理・通話のミュートと移動・監査ログ',
    bits: bitsOf(HELPER),
    builtin: true,
  },
  { key: 'b:mod', name: '🛡 モデレーター', note: '見回り ＋ キック・BAN（注意の権限）', bits: bitsOf([...HELPER, 1, 2]), builtin: true },
  { key: 'b:none', name: '⬜ 権限なし', note: '色・メンション・名前の飾りだけのロール（権限は @everyone のまま）', bits: 0n, builtin: true },
];

export const TEMPLATE_MAX = 30;
const KNOWN = ALL_PERMS.reduce((m, p) => m | (1n << BigInt(p.bit)), 0n);

/** 運営が作ったテンプレート */
export async function customRoleTemplates(db: Db): Promise<RoleTemplate[]> {
  const rows = await db.select().from(roleTemplates).orderBy(asc(roleTemplates.id));
  return rows.map((r) => ({ key: `c:${r.id}`, name: r.name, note: '', bits: BigInt(r.bits) & KNOWN, builtin: false }));
}

export async function allRoleTemplates(db: Db): Promise<RoleTemplate[]> {
  return [...BUILTIN_ROLE_TEMPLATES, ...(await customRoleTemplates(db))];
}

export async function findRoleTemplate(db: Db, key: string): Promise<RoleTemplate | undefined> {
  const b = BUILTIN_ROLE_TEMPLATES.find((t) => t.key === key);
  if (b) return b;
  const m = /^c:(\d{1,12})$/.exec(key);
  if (!m) return undefined;
  const [r] = await db.select().from(roleTemplates).where(eq(roleTemplates.id, Number(m[1])));
  return r ? { key, name: r.name, note: '', bits: BigInt(r.bits) & KNOWN, builtin: false } : undefined;
}

/** 今の権限をテンプレートにする（同じ名前なら上書き）。管理者は入れない */
export async function saveRoleTemplate(db: Db, rawName: string, bits: bigint, by: string): Promise<'ok' | 'invalid' | 'too_many' | 'admin'> {
  const name = rawName.trim();
  if (!name || name.length > 40) return 'invalid';
  if (BUILTIN_ROLE_TEMPLATES.some((t) => t.name === name)) return 'invalid';
  if ((bits & ADMINISTRATOR) !== 0n) return 'admin';
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(roleTemplates);
  const [same] = await db.select({ id: roleTemplates.id }).from(roleTemplates).where(eq(roleTemplates.name, name));
  if (!same && n >= TEMPLATE_MAX) return 'too_many';
  await db
    .insert(roleTemplates)
    .values({ name, bits: (bits & KNOWN).toString(), createdBy: by })
    .onConflictDoUpdate({ target: roleTemplates.name, set: { bits: (bits & KNOWN).toString(), createdBy: by, createdAt: new Date() } });
  return 'ok';
}

export async function deleteRoleTemplate(db: Db, id: number): Promise<boolean> {
  const r = await db.delete(roleTemplates).where(eq(roleTemplates.id, id)).returning({ id: roleTemplates.id });
  return r.length > 0;
}

/** 画面で使う: 付く権限のビットの一覧（"10,11,…"） */
export const bitList = (bits: bigint) =>
  ALL_PERMS.filter((p) => (bits & (1n << BigInt(p.bit))) !== 0n)
    .map((p) => p.bit)
    .join(',');
/** 付く権限の名前 */
export const bitLabels = (bits: bigint) => ALL_PERMS.filter((p) => (bits & (1n << BigInt(p.bit))) !== 0n).map((p) => p.label);
