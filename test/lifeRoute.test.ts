import {describe,expect,it} from 'vitest';
// @ts-expect-error ブラウザー用のJSを、そのまま確かめる。
import {createLifeRoute} from '../src/web/public/life-route.js';
// @ts-expect-error 描画用ライブラリは実行時の座標だけ使う。
import * as THREE from 'three';

describe('人生ゲームの街をめぐる道',()=>{
  it('36マスがつながり、離れた道同士は重ならない',()=>{
    const route=createLifeRoute(THREE);
    expect(route.centers).toHaveLength(36);
    for(let i=0;i<36;i++){
      const p=route.point(i),v=route.tangent(i);
      expect(Number.isFinite(p.x+p.z)).toBe(true);expect(v.length()).toBeCloseTo(1);
      if(i>0){const distance=p.distanceTo(route.point(i-1));expect(distance).toBeGreaterThan(2.7);expect(distance).toBeLessThan(3.2);}
      for(let j=i+3;j<36;j++)expect(p.distanceTo(route.point(j))).toBeGreaterThan(3.05);
    }
    expect(route.point(-1).distanceTo(route.point(0))).toBe(0);
    expect(route.point(36).distanceTo(route.point(35))).toBe(0);
  });
  it.each([36,72,108])('%iマスの道は最後のマスまでつながる',count=>{
    const route=createLifeRoute(THREE,count);expect(route.centers).toHaveLength(count);
    expect(route.point(count).distanceTo(route.point(count-1))).toBe(0);
    for(let i=1;i<count;i++){
      expect(route.point(i).distanceTo(route.point(i-1))).toBeGreaterThan(.8);
      expect(route.point(i).distanceTo(route.point(i-1))).toBeLessThan(3.2);
    }
  });
  it.each([36,72,108])('%iマスの分かれ道は離れて描き、入口と出口で滑らかに合流する',count=>{
    const route=createLifeRoute(THREE,count,[4,16]);
    const safe={start:4,kind:'steady'},risk={start:4,kind:'venture'};
    expect(route.point(8,safe).distanceTo(route.point(8,risk))).toBeCloseTo(3.2);
    for(const end of [4,12]){
      expect(route.point(end,safe).distanceTo(route.point(end))).toBeCloseTo(0);
      expect(route.point(end,risk).distanceTo(route.point(end))).toBeCloseTo(0);
      expect(route.tangent(end,safe).dot(route.tangent(end))).toBeGreaterThan(.99);
    }
    for(let n=40;n<=120;n++){
      expect(route.point(n/10,safe).distanceTo(route.point((n-1)/10,safe))).toBeLessThan(.4);
      expect(Number.isFinite(route.tangent(n/10,risk).length())).toBe(true);
    }
  });
  it('途中の位置も道に沿って進み、角で向きが飛ばない',()=>{
    const route=createLifeRoute(THREE);
    for(let step=1;step<=350;step++){
      const a=(step-1)/10,b=step/10;
      expect(route.point(a).distanceTo(route.point(b))).toBeLessThan(.32);
      expect(route.tangent(a).dot(route.tangent(b))).toBeGreaterThan(.9);
    }
  });
});
