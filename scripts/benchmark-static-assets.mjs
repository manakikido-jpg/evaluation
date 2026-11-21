// npm run build の後、node --expose-gc scripts/benchmark-static-assets.mjs で計測する。
// 第1引数で比較用のビルド済みassets.jsも指定できる。DB・Discordには接続しない。
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const mib = bytes => Math.round(bytes / 1024 / 1024 * 10) / 10;
const memory = () => {
  global.gc?.();
  const m = process.memoryUsage();
  return { rssMiB: mib(m.rss), heapMiB: mib(m.heapUsed), arrayBuffersMiB: mib(m.arrayBuffers) };
};
const before = memory();
const { STATIC } = await import(pathToFileURL(resolve(process.argv[2] || 'dist/web/assets.js')).href);
const afterImport = memory();
let catalogBytes = 0, catalogFiles = 0;
for (const [name, asset] of Object.entries(STATIC)) {
  if (!name.startsWith('shinpu-catalog-')) continue;
  // バージョンと内容を両方参照して、全画像を順に配信する場合も調べる。
  void asset.version;
  catalogBytes += asset.body.byteLength;
  catalogFiles++;
}
console.log(JSON.stringify({
  assetCount: Object.keys(STATIC).length,
  catalogFiles, catalogPayloadMiB: mib(catalogBytes),
  before, afterImport, afterCatalog: memory(),
}, null, 2));
