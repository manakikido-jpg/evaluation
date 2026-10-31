/** 48kHz・ステレオ・16bit。1フレーム20ms。録音せず、話者ごと最大120msだけ保持。 */
export const RELAY_FRAME_BYTES = 960 * 2 * 2;
export const RELAY_MAX_SPEAKERS = 20;
const QUEUE_FRAMES = 6;
type Voice = { frames: Buffer[]; partial: Buffer };
export class RelayMixer {
  private voices = new Map<string, Voice>();
  add(id: string): void {
    if (this.voices.has(id)) return;
    if (this.voices.size >= RELAY_MAX_SPEAKERS) throw Error('登壇者は20人までです。');
    this.voices.set(id, { frames: [], partial: Buffer.alloc(0) });
  }
  remove(id: string): void { this.voices.delete(id); }
  clear(): void { this.voices.clear(); }
  push(id: string, pcm: Buffer): void {
    const voice = this.voices.get(id);
    if (!voice || !pcm.length || pcm.length % 4 || pcm.length > RELAY_FRAME_BYTES * QUEUE_FRAMES) return;
    const data = Buffer.concat([voice.partial, pcm]);
    let offset = 0;
    for (; offset + RELAY_FRAME_BYTES <= data.length; offset += RELAY_FRAME_BYTES) {
      voice.frames.push(Buffer.from(data.subarray(offset, offset + RELAY_FRAME_BYTES)));
    }
    voice.partial = Buffer.from(data.subarray(offset));
    // 遅れた音を長く再生せず、最新の短い範囲だけを残す。
    if (voice.frames.length > QUEUE_FRAMES) voice.frames.splice(0, voice.frames.length - QUEUE_FRAMES);
  }
  take(): Buffer {
    const frames = [...this.voices.values()].flatMap(v => { const b = v.frames.shift(); return b ? [b] : []; });
    const output = Buffer.alloc(RELAY_FRAME_BYTES);
    if (!frames.length) return output;
    // 複数人の声を平均して重ね、クリッピングを避ける。
    for (let offset = 0; offset < RELAY_FRAME_BYTES; offset += 2) {
      const sum = frames.reduce((n, b) => n + b.readInt16LE(offset), 0);
      output.writeInt16LE(Math.round(sum / frames.length), offset);
    }
    return output;
  }
}
