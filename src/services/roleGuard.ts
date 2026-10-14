/**
 * 🛡 ロールの見張り（BOT を通さない変更）。だれがロールを変えたかで、そのままにするか・知らせるか・戻すかを決める
 */

export type RoleGuardMode = 'off' | 'alert' | 'revert';

export function judgeRoleChange(p: {
  mode: RoleGuardMode;
  executorId: string | null;
  executorIsBot: boolean;
  selfId: string;
  trustedBotIds: readonly string[];
  /** 変えた人が宮司・サーバーの持ち主か */
  executorIsGuji: boolean;
  /** 自分で自分のロールを変えた（参加時の質問・ロールの選択）。「ロールの管理」を持たない人だけ */
  selfSelect?: boolean;
}): 'ok' | 'alert' | 'revert' {
  if (p.mode === 'off') return 'ok';
  // このBOT・信用する BOT・宮司はそのまま
  if (p.executorId && (p.executorId === p.selfId || p.trustedBotIds.includes(p.executorId))) return 'ok';
  if (p.executorIsGuji || p.selfSelect) return 'ok';
  // だれが変えたか分からないとき（監査ログが読めない）は、戻さずに知らせるだけ
  if (!p.executorId) return 'alert';
  return p.mode;
}
