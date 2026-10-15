export interface SpeechWorker {
  ready(): boolean;
  connect(channelId: string, signal: AbortSignal): Promise<void>;
  speak(text: string, signal: AbortSignal): Promise<void>;
  stop(): void;
  disconnect(): void;
}
type Session = { worker: SpeechWorker; channelId: string; queue: string[]; connecting: boolean; running: boolean; lifetime: AbortController; speech?: AbortController; lastPost: Map<string, number> };
/** 予約を同期的に確保し、同時開始でも同じBOTを2部屋に配らない。 */
export class SpeechPool {
  private sessions = new Map<string, Session>();
  constructor(private workers: SpeechWorker[], private queueLimit: number, private failed: () => void = () => {}) {}
  async start(channelId: string): Promise<'started' | 'already' | 'busy' | 'failed'> {
    if (this.sessions.has(channelId)) return 'already';
    const worker = this.workers.find((w) => w.ready() && ![...this.sessions.values()].some((s) => s.worker === w));
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
