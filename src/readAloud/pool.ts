export interface SpeechWorker {
  ready(): boolean;
  connect(channelId: string, signal: AbortSignal): Promise<void>;
  speak(text: string, signal: AbortSignal): Promise<void>;
  stop(): void;
  disconnect(): void;
}
type Session = { worker: SpeechWorker; channelId: string; queue: string[]; connecting: boolean; running: boolean; lifetime: AbortController; speech?: AbortController; lastPost: Map<string, number> };
/** 既存のトークン順：拾は受信専用。名前や空き順では選ばない。 */
export const RELAY_RECEIVER_INDEX = 9;
/** 予約を同期的に確保し、同時開始でも同じBOTを2部屋に配らない。 */
export class SpeechPool {
  private sessions = new Map<string, Session>();
  private leased = new Set<SpeechWorker>();
  private relayChannels = new Set<string>();
  constructor(private workers: SpeechWorker[], private queueLimit: number, private failed: () => void = () => {}) {}
  async start(channelId: string): Promise<'started' | 'already' | 'busy' | 'failed'> {
    if (this.relayChannels.has(channelId)) return 'busy';
    if (this.sessions.has(channelId)) return 'already';
    const worker = this.workers.find((w, index) => index < RELAY_RECEIVER_INDEX && this.available(w));
    if (!worker) return 'busy';
    const s: Session = { worker, channelId, queue: [], connecting: true, running: false, lifetime: new AbortController(), lastPost: new Map() };
    this.sessions.set(channelId, s);
    try {
      await worker.connect(channelId, s.lifetime.signal);
      if (s.lifetime.signal.aborted || this.sessions.get(channelId) !== s) return 'failed';
      s.connecting = false; return 'started';
    } catch {
      if (this.sessions.get(channelId) === s) this.stop(channelId);
      return 'failed';
    }
  }
  active(channelId: string): boolean { const s = this.sessions.get(channelId); return !!s && !s.connecting; }
  private available(worker: SpeechWorker): boolean {
    return worker.ready() && !this.leased.has(worker) && ![...this.sessions.values()].some(s => s.worker === worker);
  }
  receiverReady(): boolean {
    const receiver = this.workers[RELAY_RECEIVER_INDEX];
    return !!receiver && this.available(receiver);
  }
  /** 中継の受信/配信BOTと部屋を同期的に一括確保。使用中の読み上げは奪わない。 */
  reserve(count: number, channels: readonly string[]): { indices: number[]; release: () => void } | null {
    if (!Number.isInteger(count) || count < 2 || count > 7 || channels.length !== count || new Set(channels).size !== count
      || channels.some(id => this.sessions.has(id) || this.relayChannels.has(id))) return null;
    if (!this.receiverReady()) return null;
    const senders = this.workers.flatMap((w, index) => index < RELAY_RECEIVER_INDEX && this.available(w) ? [index] : []).slice(0, count - 1);
    if (senders.length !== count - 1) return null;
    const indices = [RELAY_RECEIVER_INDEX, ...senders];
    for (const index of indices) this.leased.add(this.workers[index]!);
    for (const id of channels) this.relayChannels.add(id);
    let released = false;
    return { indices, release: () => {
      if (released) return; released = true;
      for (const index of indices) this.leased.delete(this.workers[index]!);
      for (const id of channels) this.relayChannels.delete(id);
    } };
  }
  channels(): string[] { return [...this.sessions.keys()]; }
  enqueue(channelId: string, memberId: string, text: string, now = Date.now()): 'queued' | 'off' | 'limited' {
    const s = this.sessions.get(channelId);
    if (!s || s.connecting || !text) return 'off';
    if (s.queue.length >= this.queueLimit || now - (s.lastPost.get(memberId) ?? -Infinity) < 2000) return 'limited';
    s.lastPost.set(memberId, now); s.queue.push(text);
    // 連投判定の記録をためない。
    for (const [id, at] of s.lastPost) if (now - at > 60_000) s.lastPost.delete(id);
    void this.drain(s); return 'queued';
  }
  skip(channelId: string): void { const s = this.sessions.get(channelId); s?.speech?.abort(); s?.worker.stop(); }
  stop(channelId: string): void {
    const s = this.sessions.get(channelId); if (!s) return;
    this.sessions.delete(channelId); s.queue.length = 0; s.lifetime.abort(); s.speech?.abort(); s.worker.disconnect();
  }
  close(): void { for (const id of this.channels()) this.stop(id); }
  private async drain(s: Session): Promise<void> {
    if (s.running) return; s.running = true;
    try {
      while (s.queue.length && this.sessions.get(s.channelId) === s) {
        const speech = new AbortController(); s.speech = speech;
        const signal = AbortSignal.any([s.lifetime.signal, speech.signal, AbortSignal.timeout(45_000)]);
        try { await s.worker.speak(s.queue.shift()!, signal); }
        catch { if (!signal.aborted) this.failed(); }
        finally { if (s.speech === speech) s.speech = undefined; }
      }
    } finally { s.running = false; }
  }
}
