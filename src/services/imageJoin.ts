import sharp from 'sharp';

/**
 * 画像を横に並べて 1 枚にする（🎴 運営吉の「絵＋紙」）。Discord は画像を 2 枚添えると枠に合わせて切ってしまうので、
 * 1 枚にまとめて全身が見えるようにする。高さをそろえ（縦長の絵も紙も切らない）、すき間は透明。
 * PNG・JPEG・WebP・GIF を読める
 */
export async function joinSideBySide(images: Uint8Array[], opts: { height?: number; gap?: number } = {}): Promise<Buffer> {
  const height = opts.height ?? 1200;
  const gap = opts.gap ?? 24;
  const parts = await Promise.all(
    images.map(async (data) => {
      const buf = await sharp(Buffer.from(data)).resize({ height, fit: 'inside', withoutEnlargement: false }).png().toBuffer();
      const { width } = await sharp(buf).metadata();
      return { buf, width: width ?? 0 };
    }),
  );
  const width = parts.reduce((w, p) => w + p.width, 0) + gap * Math.max(0, parts.length - 1);
  let left = 0;
  const composite = parts.map((p) => {
    const at = { input: p.buf, top: 0, left };
    left += p.width + gap;
    return at;
  });
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composite)
    .png({ compressionLevel: 9 })
    .toBuffer();
}
