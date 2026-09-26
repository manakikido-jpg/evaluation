import type { GuildConfig } from '../config.js';
import { highestRank, rankLabel } from '../domain/ranks.js';

const TZ = 'Asia/Tokyo';

const dateTimeFmt = new Intl.DateTimeFormat('ja-JP', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const dateFmt = new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export const fmtDateTime = (d: Date | null | undefined) => (d ? dateTimeFmt.format(d) : '—');
export const fmtDate = (d: Date | null | undefined) => (d ? dateFmt.format(d) : '—');

/** 「3 日前」「たった今」など */
export function fmtAgo(d: Date | null | undefined, now: Date): string {
  if (!d) return '記録なし';
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return 'たった今';
  if (sec < 3600) return `${Math.floor(sec / 60)} 分前`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)} 時間前`;
  const days = Math.floor(sec / 86_400);
  if (days < 30) return `${days} 日前`;
  if (days < 365) return `${Math.floor(days / 30)} か月前`;
  return `${Math.floor(days / 365)} 年前`;
}

/** 日本時間の今日 0 時 */
export function startOfTodayJst(now: Date): Date {
  const jst = new Date(now.getTime() + 9 * 3_600_000);
  jst.setUTCHours(0, 0, 0, 0);
  return new Date(jst.getTime() - 9 * 3_600_000);
}

export const AGE_LABEL: Record<string, string> = { minor: '13〜17 歳', adult: '18 歳以上', unknown: '未申告' };

export const LEVEL_LABEL: Record<string, string> = { guji: '⛩ 宮司', shinshoku: '🎐 神職' };

export const EVENT_LABEL: Record<string, string> = {
  join: '参加',
  rejoin: '再参加',
  leave: '退出',
  promote: '昇格',
  ban: 'BAN',
  unban: 'BAN 解除',
};

export const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'ログイン',
  'auth.logout': 'ログアウト',
  'auth.denied': 'ログインを拒否',
  'auth.revoked': '権限がなくなったためログアウト',
  'yaku.add': '厄を付けた',
  'yaku.clear': '厄を取り消した',
  'yaku.menzaifu': '免罪符で厄を祓った',
  'member.ban': 'BAN',
  'member.kick': 'キック',
  'memo.add': 'メモを書いた',
  'application.approve': '申請を承認',
  'application.reject': '申請を却下',
  'member.age': '年齢区分を変更',
  'member.yoimairi.remove': '宵参りを外した',
  'omairi.extend': 'お参り期間を延長',
  'omairi.promote': 'お参り期間の判定で昇格',
  'omairi.remove': 'お参り期間の判定で退出',
  'soudan.reply': '相談に返信',
  'soudan.done': '相談を完了',
  'soudan.reveal': '相談した人を確認',
  'settings.update': '設定を変更',
  'settings.reset': '設定をファイルの値に戻した',
  'member.unban': 'BAN 解除',
  'economy.join_bonus_all': '今いる人に初期配布',
  'coins.grant': '運営から送った',
  'coins.take': '運営が減らした',
  'coins.grant_all': '今いる人みんなに送った',
  'shop.update': 'ショップの品物を変更',
  'channel.update': 'チャンネルの説明・書き込みを変更',
  'shop.create': 'ショップの品物を追加',
  'shop.delete': 'ショップの品物を削除',
};

export function memberRankLabel(cfg: GuildConfig, roleIds: readonly string[]): string {
  return rankLabel(highestRank(cfg.ranks, roleIds));
}

export function rankNameByKey(cfg: GuildConfig, key: string): string {
  const r = cfg.ranks.find((x) => x.key === key);
  return r ? rankLabel(r) : key;
}
