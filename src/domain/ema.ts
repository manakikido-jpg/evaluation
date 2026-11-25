/**
 * 🎐 絵馬（評価の票）の決まり。2026年11月の新制度。
 * 詳しくは docs/new-system-design.md。数字はたたき台で、必要なら変える。
 */

/**
 * 絵馬の「票」の種類。
 * - ujiko（氏子の票）  : 参拝者→氏子。30日で失効。
 * - sewayaku（世話役の票）: 氏子→世話役。失効なし。
 * - sodai（総代の票）  : 世話役→総代。失効なし。
 */
export type EmaTier = 'ujiko' | 'sewayaku' | 'sodai';

/** 票の種類の呼び名（記録・案内に使う） */
export const EMA_TIER_LABEL: Record<EmaTier, string> = {
  ujiko: '氏子の票',
  sewayaku: '世話役の票',
  sodai: '総代の票',
};

/** 絵馬を贈るのに必要な「いっしょにいた」条件（どの票でも同じ） */
export const EMA_DAYS_TOGETHER = 3; // 違う日◯日以上
export const EMA_MINUTES_TOGETHER = 180; // 合計◯分以上

/** 氏子の票は created_at から◯日で失効（世話役・総代の票は失効なし） */
export const EMA_EXPIRE_DAYS = 30;

/** 参拝者→氏子に必要な有効な絵馬の枚数 */
export const EMA_UJIKO_PROMOTE = 5;

/** これを割ると維持の警告（自動では降格しない） */
export const EMA_UJIKO_KEEP = 3;

/** 氏子→世話役に必要な「世話役の票」の枚数（たたき台） */
export const EMA_SEWAYAKU_PROMOTE = 3;

/** 世話役→総代に必要な「総代の票」の枚数（たたき台） */
export const EMA_SODAI_PROMOTE = 3;

/** 一言メッセージの最大文字数 */
export const EMA_MESSAGE_MAX = 100;

/** 氏子の票だけ失効する（この時刻より後に贈られたものが有効） */
export function emaFreshSince(now: Date): Date {
  return new Date(now.getTime() - EMA_EXPIRE_DAYS * 86_400_000);
}

/** その tier の票が失効するか（氏子の票だけ 30 日で失効する） */
export function emaTierExpires(tier: EmaTier): boolean {
  return tier === 'ujiko';
}

/**
 * 絵馬での自動昇格の「段」。現在の役職 key →（その票を promote 枚で）次の役職へ。
 * 「絵馬での昇格」が ON のときだけ効く。数字はたたき台。
 */
export interface EmaStep {
  /** いまの役職の key */
  from: string;
  /** 昇格先の役職の key */
  to: string;
  /** 数える票の種類 */
  tier: EmaTier;
  /** 昇格に必要な有効な票の枚数 */
  promote: number;
}

/** 絵馬の昇格・維持に要る票の枚数（宮司が社務所Webで変えられる。config.emaThresholds と同じ形） */
export interface EmaThresholdCounts {
  ujikoPromote: number;
  ujikoKeep: number;
  sewayakuPromote: number;
  sodaiPromote: number;
}

/** 既定の枚数（たたき台）。設定がないときのフォールバック。 */
export const EMA_DEFAULT_THRESHOLDS: EmaThresholdCounts = {
  ujikoPromote: EMA_UJIKO_PROMOTE,
  ujikoKeep: EMA_UJIKO_KEEP,
  sewayakuPromote: EMA_SEWAYAKU_PROMOTE,
  sodaiPromote: EMA_SODAI_PROMOTE,
};

/** 枚数の設定から、絵馬の昇格の段を作る。 */
export function emaSteps(th: EmaThresholdCounts = EMA_DEFAULT_THRESHOLDS): EmaStep[] {
  return [
    { from: 'sanpaisha', to: 'ujiko', tier: 'ujiko', promote: th.ujikoPromote },
    { from: 'ujiko', to: 'sewayaku', tier: 'sewayaku', promote: th.sewayakuPromote },
    { from: 'sewayaku', to: 'sodai', tier: 'sodai', promote: th.sodaiPromote },
  ];
}

/** その役職 key から見た、次の絵馬の段（なければ undefined＝これ以上は絵馬で上がらない） */
export function emaStepFrom(key: string | undefined, th: EmaThresholdCounts = EMA_DEFAULT_THRESHOLDS): EmaStep | undefined {
  return key ? emaSteps(th).find((s) => s.from === key) : undefined;
}

/**
 * 贈る人の格（weight）と相手の役職 key から、贈れる絵馬の種類を決める。贈れないなら null。
 * - 参拝者へ：氏子以上 → 氏子の票
 * - 氏子へ  ：世話役以上（運営を含む）→ 世話役の票 ／ 氏子 → 氏子の票（維持用）
 * - 世話役へ：総代以上（運営を含む）→ 総代の票
 * - 総代以上・役職なしへは贈れない
 * weight が未定義（その役職が設定にない）なら、その段は贈れない扱い。
 */
export function emaTierFor(opts: {
  giverWeight: number;
  receiverKey: string | undefined;
  ujikoWeight?: number;
  sewayakuWeight?: number;
  sodaiWeight?: number;
}): EmaTier | null {
  const { giverWeight, receiverKey } = opts;
  const atLeast = (w?: number) => w !== undefined && giverWeight >= w;
  if (receiverKey === 'sanpaisha') return atLeast(opts.ujikoWeight) ? 'ujiko' : null;
  if (receiverKey === 'ujiko') {
    if (atLeast(opts.sewayakuWeight)) return 'sewayaku';
    if (atLeast(opts.ujikoWeight)) return 'ujiko';
    return null;
  }
  if (receiverKey === 'sewayaku') return atLeast(opts.sodaiWeight) ? 'sodai' : null;
  return null;
}
