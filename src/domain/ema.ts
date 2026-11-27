/**
 * 🎐 絵馬（評価の票）の決まり。2026年11月の新制度。
 * 詳しくは docs/new-system-design.md。数字はたたき台で、必要なら変える。
 */

/**
 * 絵馬の「票」の種類（2026-11-27 本人の決定で sanpai を足し、失効は sanpai だけ）。
 * - ujiko（氏子の票）  : 氏子以上 → 参拝者・氏子。失効なし。
 * - sanpai（参拝者の票）: 参拝者 → 氏子。30日で失効（氏子は絵馬をもらい続ける）。
 * - sewayaku（世話役の票）: 前の決まりの氏子→世話役の票（2026-11-26 から氏子→世話役は選挙になり、もう贈らない。残っている記録の表示用）。
 * - sodai（総代の票）  : だれでも → 世話役（世話役→総代）。失効なし。
 */
export type EmaTier = 'ujiko' | 'sanpai' | 'sewayaku' | 'sodai';

/** 票の種類の呼び名（記録・案内に使う） */
export const EMA_TIER_LABEL: Record<EmaTier, string> = {
  ujiko: '氏子の票',
  sanpai: '参拝者の票',
  sewayaku: '世話役の票',
  sodai: '総代の票',
};

/** 絵馬を贈るのに必要な「いっしょにいた」条件（どの票でも同じ）：縁側で1日◯分以上いっしょにいた日が◯日以上（本人の決定 2026-11-27） */
export const EMA_DAYS_TOGETHER = 3; // ◯日以上
export const EMA_MINUTES_PER_DAY = 30; // その日に◯分以上

/** 参拝者が絵馬を贈るときの定型文（自由に書いてもよい。本人の決定 2026-11-27） */
export const EMA_TEMPLATES: readonly string[] = ['話し手', '聞き手', '回し手', 'ムードメーカー'];
/** 参拝者の票は created_at から◯日で失効（ほかの票は失効なし） */
export const EMA_EXPIRE_DAYS = 30;

/**
 * 参拝者→氏子の必要数（2週間ごとにきまる）：直近7日に縁側で EMA_UJIKO_ACTIVE_MINUTES 分以上いた氏子以上の人数の
 * EMA_UJIKO_PERCENT%（切り上げ・最低 EMA_UJIKO_MIN）。お参り期間中にもらった氏子の票＋招待の補い（EMA_INVITE_SUBSTITUTE_MAX まで）で数える。
 */
export const EMA_UJIKO_PERCENT = 60;
export const EMA_UJIKO_ACTIVE_MINUTES = 600;
export const EMA_UJIKO_MIN = 1;
export const EMA_INVITE_SUBSTITUTE_MAX = 3;

/** これを割ると維持の警告（自動では降格しない） */
export const EMA_UJIKO_KEEP = 3;

/**
 * 氏子→世話役は候補ごとの選挙（2026-11-26 本人の決定）。絵馬（世話役の票）では上がらない。
 * 氏子を3か月つづけ・氏子になってから縁側に120時間いた氏子が候補。条件を満たした週の金・土・日（金曜0時より後なら次の週）が選挙期間。
 * 投票できるのは直近30日の縁側が24時間を超えている氏子・世話役・総代（金曜0時に固める）。匿名で「お世話役になってほしい」に投票。
 * 票が投票できる人の60%を超えたら世話役（投票できる人が5人未満なら不成立）。落ちたら、選挙のあと縁側40時間でまた候補。
 */
export const SEWAYAKU_VOTE_PERCENT = 60;
export const SEWAYAKU_VOTER_MINUTES = 1440;
export const SEWAYAKU_CANDIDATE_MINUTES = 7200;
export const SEWAYAKU_CANDIDATE_MONTHS = 3;
export const SEWAYAKU_RETRY_MINUTES = 2400;
export const SEWAYAKU_MIN_VOTERS = 5;

/** 世話役→総代に必要な「総代の票」の枚数（本人の決定 2026-11-27：絵馬200） */
export const EMA_SODAI_PROMOTE = 200;

/**
 * 1回の見回りでこの人数を超えて昇格するときは「いっぺんに上がった」とみなし、
 * 1人ずつの発表には役職の通知を付けず、まとめて1回だけ通知する（切り替えた直後の通知の連打を防ぐ）。
 */
export const EMA_PROMOTION_BURST = 3;

/** 一言メッセージの最大文字数 */
export const EMA_MESSAGE_MAX = 100;

/** 氏子の票だけ失効する（この時刻より後に贈られたものが有効） */
export function emaFreshSince(now: Date): Date {
  return new Date(now.getTime() - EMA_EXPIRE_DAYS * 86_400_000);
}

/** その tier の票が失効するか（氏子の票だけ 30 日で失効する） */
export function emaTierExpires(tier: EmaTier): boolean {
  return tier === 'sanpai';
}

/** その役職の人のカード・維持で数える票の種類（参拝者=氏子の票／氏子=氏子の票＋参拝者の票／世話役=総代の票） */
export function emaTiersShown(rankKey: string | undefined): EmaTier[] {
  if (rankKey === 'ujiko') return ['ujiko', 'sanpai'];
  if (rankKey === 'sewayaku') return ['sodai'];
  return ['ujiko'];
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
  ujikoPercent: number;
  ujikoActiveMinutes: number;
  ujikoMin: number;
  inviteSubstituteMax: number;
  ujikoKeep: number;
  sewayakuVotePercent: number;
  sewayakuVoterMinutes: number;
  sewayakuCandidateMinutes: number;
  sewayakuCandidateMonths: number;
  sewayakuRetryMinutes: number;
  sewayakuMinVoters: number;
  sodaiPromote: number;
  keepNeed: number;
  keepFromSanpai: number;
  keepInviteMax: number;
  keepDays: number;
  motoNeed: number;
  motoFromSanpai: number;
  motoInviteMax: number;
  aramitamaInvites: number;
  omamoriMax: number;
  omamoriWeekMinutes: number;
}

/** 既定の枚数（たたき台）。設定がないときのフォールバック。 */
export const EMA_DEFAULT_THRESHOLDS: EmaThresholdCounts = {
  ujikoPercent: EMA_UJIKO_PERCENT,
  ujikoActiveMinutes: EMA_UJIKO_ACTIVE_MINUTES,
  ujikoMin: EMA_UJIKO_MIN,
  inviteSubstituteMax: EMA_INVITE_SUBSTITUTE_MAX,
  ujikoKeep: EMA_UJIKO_KEEP,
  sewayakuVotePercent: SEWAYAKU_VOTE_PERCENT,
  sewayakuVoterMinutes: SEWAYAKU_VOTER_MINUTES,
  sewayakuCandidateMinutes: SEWAYAKU_CANDIDATE_MINUTES,
  sewayakuCandidateMonths: SEWAYAKU_CANDIDATE_MONTHS,
  sewayakuRetryMinutes: SEWAYAKU_RETRY_MINUTES,
  sewayakuMinVoters: SEWAYAKU_MIN_VOTERS,
  sodaiPromote: EMA_SODAI_PROMOTE,
  keepNeed: 20,
  keepFromSanpai: 10,
  keepInviteMax: 5,
  keepDays: 30,
  motoNeed: 15,
  motoFromSanpai: 10,
  motoInviteMax: 5,
  aramitamaInvites: 3,
  omamoriMax: 3,
  omamoriWeekMinutes: 2400,
};

/** 枚数の設定から、絵馬の昇格の段を作る。 */
export function emaSteps(th: EmaThresholdCounts = EMA_DEFAULT_THRESHOLDS): EmaStep[] {
  return [
    // 参拝者→氏子の必要数は2週間ごとにきまる（ujikoRequirement）。ここの promote は最低の数（目安）
    { from: 'sanpaisha', to: 'ujiko', tier: 'ujiko', promote: th.ujikoMin },
    // 氏子→世話役は候補ごとの選挙（sewayakuElection.ts）。絵馬の段はない
    { from: 'sewayaku', to: 'sodai', tier: 'sodai', promote: th.sodaiPromote },
  ];
}

/** その役職 key から見た、次の絵馬の段（なければ undefined＝これ以上は絵馬で上がらない） */
export function emaStepFrom(key: string | undefined, th: EmaThresholdCounts = EMA_DEFAULT_THRESHOLDS): EmaStep | undefined {
  return key ? emaSteps(th).find((s) => s.from === key) : undefined;
}

/**
 * 贈る人の格（weight）と相手の役職 key から、贈れる絵馬の種類を決める。贈れないなら null。
 * - 参拝者へ：氏子以上 → 氏子の票（参拝者どうしは贈れない）
 * - 氏子へ  ：氏子以上 → 氏子の票／参拝者 → 参拝者の票（30日で失効）
 * - 世話役へ：参拝者以上だれでも → 総代の票（本人の決定 2026-11-27）
 * - 総代以上・役職なしへは贈れない。役職のない人（参拝者より前）は贈れない
 * weight が未定義（その役職が設定にない）なら、その段は贈れない扱い。
 */
export function emaTierFor(opts: {
  giverWeight: number;
  receiverKey: string | undefined;
  ujikoWeight?: number;
  sewayakuWeight?: number;
  sodaiWeight?: number;
  sanpaishaWeight?: number;
}): EmaTier | null {
  const { giverWeight, receiverKey } = opts;
  const atLeast = (w?: number) => w !== undefined && giverWeight >= w;
  if (receiverKey === 'sanpaisha') return atLeast(opts.ujikoWeight) ? 'ujiko' : null;
  if (receiverKey === 'ujiko') return atLeast(opts.ujikoWeight) ? 'ujiko' : atLeast(opts.sanpaishaWeight) ? 'sanpai' : null;
  if (receiverKey === 'sewayaku') return atLeast(opts.sanpaishaWeight) ? 'sodai' : null;
  return null;
}

/** 参拝者→氏子の必要数：アクティブな氏子以上の人数 × percent%（切り上げ・最低 min） */
export function ujikoRequirementFrom(activeCount: number, th: Pick<EmaThresholdCounts, 'ujikoPercent' | 'ujikoMin'>): number {
  return Math.max(th.ujikoMin, Math.ceil((activeCount * th.ujikoPercent) / 100));
}

/** 日本時間で、その時刻が入っている週の月曜日（YYYY-MM-DD） */
export function jstWeekStart(at: Date): string {
  const d = new Date(new Date(at.getTime() + 9 * 3_600_000).toISOString().slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * 参拝者→氏子の必要数を見直す区切り（2週間ごと・月曜はじまり。本人の決定 2026-11-27）。
 * その日が入る2週間の、はじめの月曜日（日本時間）を返す。区切りは 2026-01-05（月）から2週間ずつ。
 */
export function jstPeriodStart(at: Date): string {
  const week = jstWeekStart(at);
  const days = Math.round((Date.parse(week + 'T00:00:00Z') - Date.parse('2026-01-05T00:00:00Z')) / 86_400_000);
  const weeks = Math.round(days / 7);
  return weeks % 2 === 0 ? week : addDays(week, -7);
}

/** YYYY-MM-DD に日数を足す */
export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 参拝者→氏子の必要数の決まりを、やさしい言葉で（掲示・案内に使う） */
export function ujikoRuleText(th: Pick<EmaThresholdCounts, 'ujikoPercent' | 'ujikoActiveMinutes' | 'ujikoMin'>): string {
  const time = th.ujikoActiveMinutes % 60 === 0 ? `${th.ujikoActiveMinutes / 60}時間` : `${th.ujikoActiveMinutes}分`;
  const rate = th.ujikoPercent % 10 === 0 ? `${th.ujikoPercent / 10}割` : `${th.ujikoPercent}%`;
  return `直近7日に縁側に${time}以上いた氏子以上の人数の${rate}（切り上げ・最低${th.ujikoMin}枚）`;
}

/** 世話役の選挙：票が投票できる人の percent% を超えていて、投票できる人が最低の人数以上なら昇格 */
export function sewayakuVotePasses(votes: number, voters: number, th: Pick<EmaThresholdCounts, 'sewayakuVotePercent' | 'sewayakuMinVoters'>): boolean {
  return voters >= th.sewayakuMinVoters && votes * 100 > voters * th.sewayakuVotePercent;
}

/**
 * 条件を満たした時刻から、選挙期間（日本時間の金曜0時〜月曜0時）を決める。
 * その週（月曜はじまり）の金曜0時より前ならその週の金土日、金曜0時より後なら次の週の金土日。
 */
export function sewayakuElectionWindow(qualifiedAt: Date): { startsAt: Date; endsAt: Date } {
  const monday = jstWeekStart(qualifiedAt);
  let friday = new Date(`${addDays(monday, 4)}T00:00:00+09:00`);
  if (qualifiedAt.getTime() >= friday.getTime()) friday = new Date(`${addDays(monday, 11)}T00:00:00+09:00`);
  return { startsAt: friday, endsAt: new Date(friday.getTime() + 3 * 86_400_000) };
}

/** 日本時間の月（YYYY-MM） */
export function jstMonth(at: Date): string {
  return new Date(at.getTime() + 9 * 3_600_000).toISOString().slice(0, 7);
}

/** 前の月（YYYY-MM） */
export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** 氏子→世話役の投票の決まりを、やさしい言葉で（掲示・案内に使う） */
export function sewayakuRuleText(th: Pick<EmaThresholdCounts, 'sewayakuVotePercent' | 'sewayakuVoterMinutes' | 'sewayakuCandidateMinutes' | 'sewayakuCandidateMonths' | 'sewayakuRetryMinutes'>): string {
  const h = (m: number) => (m % 60 === 0 ? `${m / 60}時間` : `${m}分`);
  return `選挙（氏子を${th.sewayakuCandidateMonths}か月つづけて、氏子になってから縁側に${h(th.sewayakuCandidateMinutes)}いた氏子が、その週の金・土・日に匿名の投票。投票できる人＝直近30日に縁側に${h(th.sewayakuVoterMinutes)}を超えていた氏子・世話役・総代の${th.sewayakuVotePercent}%を超えたら世話役。落ちたら縁側${h(th.sewayakuRetryMinutes)}でもう一度）`;
}

/** その時刻から months か月あと（日がない月は月末にそろえる） */
export function addMonths(at: Date, months: number): Date {
  const d = new Date(at.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
