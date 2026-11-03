import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {STATIC,assetUrl} from '../src/web/assets.js';
const manifest=JSON.parse(readFileSync(new URL('../assets/gaisen-media/manifest.json',import.meta.url),'utf8')) as {files:Array<{file:string;bytes:number;sha256:string;channels?:number;sampleRate?:number}>};
describe('新台の生成画像と音源の配信',()=>{
 it('保存した全素材をハッシュ付きURLと正しいMIMEで配信し、記録のSHA256と一致する',()=>{
  expect(manifest.files).toHaveLength(17);
  for(const item of manifest.files){
   const name='gaisen-media-'+item.file,asset=STATIC[name]!;expect(asset).toBeDefined();expect(asset.type).toBe(item.file.endsWith('.mp3')?'audio/mpeg':'image/webp');
   expect(asset.body.length).toBe(item.bytes);expect(createHash('sha256').update(asset.body).digest('hex')).toBe(item.sha256);expect(assetUrl(name)).toContain('?v=');
   if(item.file.endsWith('.mp3')){expect(item.channels).toBe(2);expect(item.sampleRate).toBe(44100);}
  }
 });
 it('背景と当選画像はPC1600pxとスマホ800pxのWebPで、どちらもデコードできる',async()=>{
  for(const scene of ['night','award'])for(const width of [800,1600]){
   const data=STATIC[`gaisen-media-${scene}-${width}.webp`]!.body as Uint8Array;
   const info=await sharp(data).metadata();expect(info.format).toBe('webp');expect(info.width).toBe(width);expect(info.height).toBeGreaterThan(width/2);
  }
 });
});
