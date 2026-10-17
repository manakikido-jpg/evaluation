/** 同意は、その部屋に最初からいた人だけ。入れ替わりは新しい録音で確認する。 */
export class RecordingConsent {
  readonly agreed = new Set<string>();
  stopped = false;
  constructor(readonly memberIds: readonly string[]) {}
  agree(id: string) { if (!this.stopped && this.memberIds.includes(id)) this.agreed.add(id); }
  get ready() { return !this.stopped && this.memberIds.length > 0 && this.memberIds.every(id => this.agreed.has(id)); }
  matches(ids: readonly string[]) { return ids.length === this.memberIds.length && ids.every(id => this.memberIds.includes(id)); }
  stop() { this.stopped = true; }
}

export const PCM_RATE = 48000;
const FRAME_SAMPLES = 960 * 2;
const FRAME_BYTES = FRAME_SAMPLES * 2;
/** 20msのPCMを時刻にそろえて重ねる。遅れた音声で過去を書きかえない。 */
export class VoiceMixer {
  private frames = new Map<number, Int32Array>();
  private nextByUser = new Map<string, number>();
  private next = 0;
  /** だれかの声を 1 回でも受けたか（無音だけの録音は残さない） */
  heard = false;
  constructor(readonly allowed: ReadonlySet<string>) {}
  push(user: string, pcm: Buffer, elapsedMs: number) {
    if (!this.allowed.has(user) || pcm.length % FRAME_BYTES || pcm.length > FRAME_BYTES * 6) return;
    const start = Math.max(this.next, Math.floor(elapsedMs / 20), this.nextByUser.get(user) ?? 0);
    // 1秒以上先のキューはためない。
    if (start > this.next + 50) return;
    for (let off = 0, n = start; off < pcm.length; off += FRAME_BYTES, n++) {
      const frame = this.frames.get(n) ?? new Int32Array(FRAME_SAMPLES);
      for (let i = 0; i < FRAME_SAMPLES; i++) frame[i] = frame[i]! + pcm.readInt16LE(off + i * 2);
      this.frames.set(n, frame);
    }
    this.nextByUser.set(user, start + pcm.length / FRAME_BYTES);
    this.heard = true;
  }
  drain(elapsedMs: number): Buffer {
    const until = Math.min(Math.floor(elapsedMs / 20), this.next + 50);
    const out = Buffer.alloc(Math.max(0, until - this.next) * FRAME_BYTES);
    for (let offset = 0; this.next < until; this.next++, offset += FRAME_BYTES) {
      const frame = this.frames.get(this.next);
      if (frame) for (let i = 0; i < FRAME_SAMPLES; i++) out.writeInt16LE(Math.min(32767, Math.max(-32768, frame[i]!)), offset + i * 2);
      this.frames.delete(this.next);
    }
    return out;
  }
}
export function wavHeader(pcmBytes: number) {
  const b = Buffer.alloc(44);
  b.write('RIFF'); b.writeUInt32LE(36 + pcmBytes, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(PCM_RATE, 24); b.writeUInt32LE(PCM_RATE * 4, 28);
  b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcmBytes, 40);
  return b;
}
