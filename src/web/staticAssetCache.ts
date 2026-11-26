import { createHash } from 'node:crypto';

type Bytes = Uint8Array<ArrayBuffer>;

/** 不変の配信素材を、件数ではなく合計バイト数で制限して保持する。 */
export class StaticAssetCache {
  private readonly entries = new Map<string, Bytes>();
  private retained = 0;

  constructor(private readonly maxBytes: number) {}

  get byteLength() { return this.retained; }
  get size() { return this.entries.size; }

  read(key: string, load: () => Bytes): Bytes {
    const cached = this.entries.get(key);
    if (cached !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const body = load();
    // 大きすぎる動画などは返すだけにして、ほかの素材の保持枠を使い切らない。
    if (this.maxBytes > 0 && body.byteLength <= this.maxBytes) {
      while (this.retained + body.byteLength > this.maxBytes) {
        const oldest = this.entries.entries().next().value;
        if (!oldest) break;
        this.entries.delete(oldest[0]);
        this.retained -= oldest[1].byteLength;
      }
      this.entries.set(key, body);
      this.retained += body.byteLength;
    }
    return body;
  }
}

/** URLのハッシュと配信内容は従来と同じ。使われるまで画像を読まない。 */
export function lazyStaticAsset(cache: StaticAssetCache, key: string, type: string, load: () => Bytes) {
  let version: string | undefined;
  return {
    type,
    get body() { return cache.read(key, load); },
    get version() {
      return version ??= createHash('sha256').update(cache.read(key, load)).digest('hex').slice(0, 10);
    },
  };
}
