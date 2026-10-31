import { RELAY_MAX_TARGETS, type SpeechPool } from './pool.js';

export type RelayPlan = { source: string; targets: string[]; actor: string };
export type RelayMetrics = { packets: number; lastPacketAt: number | null };
export class RelayError extends Error {}
export interface RelayTransport {
  start(signal: AbortSignal): Promise<void>;
  close(reason: string): Promise<void>;
  metrics(): RelayMetrics;
  botIds: readonly string[];
}
export type RelayFactory = (plan: RelayPlan, indices: number[], fault: (reason: string) => void) => RelayTransport;
type Session = { plan: RelayPlan; lease: { release(): void }; transport: RelayTransport; abort: AbortController;
  starting: Promise<void>; stopping?: Promise<void>; active: boolean };
/** 接続中の停止でも、古い接続を閉じ切るまでBOTを返却しない。 */
export class EventRelay {
  private session?: Session;
  lastStop: string | null = null;
  constructor(private pool: SpeechPool, private factory: RelayFactory) {}
  status() {
    const s = this.session;
    return s ? { ...s.plan, targets: [...s.plan.targets], receiver: s.transport.botIds[0], senders: [...s.transport.botIds.slice(1)], phase: s.stopping ? 'stopping' : s.active ? 'active' : 'starting', ...s.transport.metrics() } : null;
  }
  async start(plan: RelayPlan): Promise<void> {
    if (this.session) throw new RelayError('中継中か準備中です。停止してから開始してください。');
    if (!plan.source || plan.targets.length < 1 || plan.targets.length > RELAY_MAX_TARGETS || new Set([plan.source, ...plan.targets]).size !== plan.targets.length + 1)
      throw new RelayError(`中継先は重複しない1〜${RELAY_MAX_TARGETS}部屋を選んでください。`);
    if (!this.pool.receiverReady()) throw new RelayError('受信専用の拾（設定順10番目）が使えません。10体の設定と接続状態を確認してください。ほかのBOTでは代用しません。');
    const lease = this.pool.reserve(plan.targets.length + 1, [plan.source, ...plan.targets]);
    if (!lease) throw new RelayError('壱〜玖の空きBOTが足りないか、対象の部屋は読み上げ中です。対象部屋の読み上げを停止して、空きを確認してください。');
    let transport: RelayTransport;
    try { transport = this.factory(plan, lease.indices, reason => { void this.stop(reason); }); }
    catch { lease.release(); throw new RelayError('中継を準備できませんでした。'); }
    const s: Session = { plan: { ...plan, targets: [...plan.targets] }, lease, transport, abort: new AbortController(), starting: Promise.resolve(), active: false };
    this.session = s;
    s.starting = Promise.resolve().then(() => transport.start(s.abort.signal));
    try {
      await s.starting;
      if (s.abort.signal.aborted) throw new RelayError('中継の準備を中止しました。');
      s.active = true; this.lastStop = null;
    } catch (error) {
      await this.stop('開始できなかったため停止しました。');
      throw error;
    }
  }
  stop(reason = '運営が中継を停止しました。'): Promise<void> {
    const s = this.session;
    if (!s) return Promise.resolve();
    if (s.stopping) return s.stopping;
    s.abort.abort(new RelayError(reason)); this.lastStop = reason;
    // abortは即時。close/接続完了待ちが終わるまで新しい利用を許さない。
    s.stopping = Promise.resolve().then(async () => {
      try { await s.transport.close(reason).catch(() => {}); await s.starting.catch(() => {}); await s.transport.close(reason).catch(() => {}); }
      finally { s.lease.release(); if (this.session === s) this.session = undefined; }
    });
    return s.stopping;
  }
  lostBot(id: string): void {
    if (this.session?.transport.botIds.includes(id)) void this.stop('中継BOTの接続が切れたため停止しました。');
  }
}
