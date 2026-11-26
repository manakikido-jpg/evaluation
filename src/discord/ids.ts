/** ボタンの customId。形式: shuin:<action>:<相手のユーザー ID> */
export type ShuinAction = 'give' | 'revoke' | 'card' | 'list' | 'vc' | 'unmet';

const PREFIX = 'shuin';
/** vc: 通話のチャットのボタン（ID は通話のチャンネル ID）／unmet: まだ結んでいない人（結びのコレクション） */
const ACTIONS: readonly ShuinAction[] = ['give', 'revoke', 'card', 'list', 'vc', 'unmet'];

export function shuinId(action: ShuinAction, userId: string): string {
  return `${PREFIX}:${action}:${userId}`;
}

export function parseShuinId(customId: string): { action: ShuinAction; userId: string } | undefined {
  const [prefix, action, userId] = customId.split(':');
  if (prefix !== PREFIX || !userId || !/^\d{17,20}$/.test(userId)) return undefined;
  if (!ACTIONS.includes(action as ShuinAction)) return undefined;
  return { action: action as ShuinAction, userId };
}

/** 🎐 絵馬（評価の票）のボタン・モーダルの customId。形式: ema:<kind>:<相手のユーザー ID>（vote は世話役の投票） */
export type EmaIdKind = 'give' | 'modal' | 'vote';
const EMA_PREFIX = 'ema';

/** プロフィールの「絵馬を贈る」ボタン（押すと一言のモーダルが出る） */
export function emaGiveId(userId: string): string {
  return `${EMA_PREFIX}:give:${userId}`;
}
/** 一言を入れるモーダル */
export function emaModalId(userId: string): string {
  return `${EMA_PREFIX}:modal:${userId}`;
}
/** 🗳 世話役の投票ボタン（押すと投票・もう一度で取り消し） */
export function sewayakuVoteId(userId: string): string {
  return `${EMA_PREFIX}:vote:${userId}`;
}
export function parseEmaId(customId: string): { kind: EmaIdKind; userId: string } | undefined {
  const [prefix, kind, userId] = customId.split(':');
  if (prefix !== EMA_PREFIX || (kind !== 'give' && kind !== 'modal' && kind !== 'vote') || !userId || !/^\d{17,20}$/.test(userId)) return undefined;
  return { kind, userId };
}

/** コマンド名 */
export const COMMAND = {
  /** 右クリック → アプリ → プロフィール（ここから朱印を押す） */
  profileMenu: 'プロフィール',
  /** 前の版の右クリックメニュー（もう登録しない。残っていても動くように） */
  giveMenu: '朱印を押す',
  cardMenu: '御朱印帳を見る',
  goshuin: 'goshuin',
  /** 🗳 世話役の投票（候補と自分の選挙権を見る） */
  sewayaku: 'sewayaku',
} as const;
