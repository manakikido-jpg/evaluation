/** VOICEVOXへ送るのは、整形した読み上げ文だけ。エラーにも本文を含めない。 */
export async function synthesize(base: string, speaker: number, text: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<Buffer> {
  try {
    const url = new URL('audio_query', base.replace(/\/?$/, '/'));
    url.searchParams.set('speaker', String(speaker)); url.searchParams.set('text', text);
    const query = await request(url, { method: 'POST', signal });
    if (!query.ok) throw Error();
    const body = await query.json() as Record<string, unknown>;
    body.outputSamplingRate = 48000; body.outputStereo = true;
    const target = new URL('synthesis', base.replace(/\/?$/, '/')); target.searchParams.set('speaker', String(speaker));
    const response = await request(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!response.ok || !response.body) throw Error();
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 12_000_000) { await response.body.cancel().catch(() => {}); throw Error(); }
      chunks.push(Buffer.from(chunk));
    }
    return wavPcm(Buffer.concat(chunks));
  } catch { throw new Error('音声を作れませんでした。'); }
}
/** 48kHz・16bit・ステレオPCMだけ受け付け、Opus変換へ渡す。FFmpegは不要。 */
export function wavPcm(wav: Buffer): Buffer {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('音声形式が違います。');
  let valid = false;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = wav.toString('ascii', offset, offset + 4), length = wav.readUInt32LE(offset + 4), start = offset + 8;
    if (length > wav.length - start) break;
    if (id === 'fmt ' && length >= 16) valid = wav.readUInt16LE(start) === 1 && wav.readUInt16LE(start + 2) === 2 && wav.readUInt32LE(start + 4) === 48000 && wav.readUInt16LE(start + 12) === 4 && wav.readUInt16LE(start + 14) === 16;
    if (id === 'data' && valid && length > 0 && length % 4 === 0) return wav.subarray(start, start + length);
    offset = start + length + (length % 2);
  }
  throw new Error('音声形式が違います。');
}
