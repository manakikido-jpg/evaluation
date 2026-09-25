/** ボタンの customId。形式: shuin:<action>:<相手のユーザー ID> */
export type ShuinAction = 'give' | 'revoke' | 'card' | 'list';

const PREFIX = 'shuin';
const ACTIONS: readonly ShuinAction[] = ['give', 'revoke', 'card', 'list'];

export function shuinId(action: ShuinAction, userId: string): string {
  return `${PREFIX}:${action}:${userId}`;
}

export function parseShuinId(customId: string): { action: ShuinAction; userId: string } | undefined {
  const [prefix, action, userId] = customId.split(':');
  if (prefix !== PREFIX || !userId || !/^\d{17,20}$/.test(userId)) return undefined;
  if (!ACTIONS.includes(action as ShuinAction)) return undefined;
  return { action: action as ShuinAction, userId };
}

/** コマンド名 */
export const COMMAND = {
  giveMenu: '朱印を押す',
  cardMenu: '御朱印帳を見る',
  goshuin: 'goshuin',
} as const;
