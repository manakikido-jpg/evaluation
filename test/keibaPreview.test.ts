import { describe, expect, it, afterEach, vi } from 'vitest';
import { createKeibaPreview } from '../src/services/casino/keibaPreview.js';
// @ts-expect-error ブラウザー用の補間をそのまま検証する。
import { sampleReplay, trackPoint } from '../src/web/public/keiba-replay.js';
// @ts-expect-error ブラウザー用の馬体を検証する。
import { createHorse } from '../src/web/public/keiba-horse.js';
// @ts-expect-error 描画ライブラリの実際の形状を検証する。
import * as THREE from 'three';
afterEach(()=>vi.unstubAllGlobals());
describe('競馬の3D映像試作',()=>{
  it('固定種のサンプル8頭を既存レース計算から作り、再読込でも同じ結果になる',()=>{
    const a=createKeibaPreview(),b=createKeibaPreview();expect(a).toEqual(b);expect(a.demo).toBe(true);expect(a.horses).toHaveLength(8);
    expect(new Set(a.horses.map(h=>h.no)).size).toBe(8);expect([...a.order].sort()).toEqual([1,2,3,4,5,6,7,8]);
    for(const rows of [a.frames,a.lanes]){expect(rows).toHaveLength(8);expect(new Set(rows.map(r=>r.length)).size).toBe(1);expect(rows.flat().every(Number.isFinite)).toBe(true);}
    expect(a.frameMs).toBeGreaterThan(0);expect(a.durationMs).toBeGreaterThan(Math.max(...a.finishMs));
  });
  it('コースの直線/コーナーの継ぎ目と周回で位置が連続し、ゴールは既存コースの0m',()=>{
    for(const s of [0,100,500,1100,1500,2000]){const a=trackPoint(s-.001,5),b=trackPoint(s+.001,5);expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeLessThan(.01);}
    expect(trackPoint(0)).toEqual({x:200,z:400/Math.PI});expect(trackPoint(-100)).toEqual(trackPoint(1900));
  });
  it('途中の記録の先読みでゴール扱いにせず、サーバーの到達時刻と確定着順を使う',()=>{
    const data={race:{dist:1600},horses:[{no:1},{no:2}],frames:[[0,1200],[0,1200]],lanes:[[0,0],[10,10]],frameMs:100,finishMs:[200,100],order:[2,1],durationMs:300};
    const before=sampleReplay(data,99);expect(before.positions.every((p:any)=>!p.finished&&p.progress<1)).toBe(true);
    const first=sampleReplay(data,100);expect(first.positions[0].finished).toBe(false);expect(first.positions[1].finished).toBe(true);expect(first.order).toEqual([2,1]);
    const result=sampleReplay(data,300);expect(result.complete).toBe(true);expect(result.order).toEqual([2,1]);expect(result.remaining).toBe(0);
  });
  it('シーク/巻き戻しも再現でき、全時点の座標と向きが有限値になる',()=>{
    const data=createKeibaPreview(),at=sampleReplay(data,10000);sampleReplay(data,data.durationMs);expect(sampleReplay(data,10000)).toEqual(at);
    for(let t=0;t<=data.durationMs;t+=500){const frame=sampleReplay(data,t);expect(frame.positions).toHaveLength(8);expect(frame.positions.every((p:any)=>[p.x,p.z,p.heading,p.progress].every(Number.isFinite))).toBe(true);}
    expect(sampleReplay(data,-1)).toEqual(sampleReplay(data,0));expect(sampleReplay(data,1e9)).toEqual(sampleReplay(data,data.durationMs));
  });
  it('馬体と騎手を実際の3D形状で作り、走行姿勢を更新しても不正な頂点を作らない',()=>{
    vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},fillText(){}})})});
    const horse=createHorse(THREE,createKeibaPreview().horses[0]);
    horse.setQuality(true);let lightCoat=false;
    horse.root.traverse((o:any)=>{if(o.material?.isMeshPhysicalMaterial){lightCoat=true;expect(o.material.clearcoat).toBe(0);expect(o.material.bumpMap).toBeNull();}});expect(lightCoat).toBe(true);
    horse.setQuality(false);
    horse.root.traverse((o:any)=>{if(o.material?.isMeshPhysicalMaterial){expect(o.material.clearcoat).toBeGreaterThan(0);expect(o.material.bumpMap).not.toBeNull();}});
    for(let t=0;t<3;t+=.1)horse.update(t,true);
    horse.root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(horse.root),size=box.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(2);expect(size.x).toBeLessThan(4);expect(size.y).toBeGreaterThan(2);expect(size.y).toBeLessThan(3.5);
    let count=0;horse.root.traverse((o:any)=>{if(o.isMesh){count++;expect([...o.geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true);}});expect(count).toBeGreaterThan(10);expect(count).toBeLessThan(60);
  });
  it('保存されたオーラ・装具の色を3D材質へ反映し、更新後も形状が有限になる',()=>{
    vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},fillText(){}})})});
    const model=createHorse(THREE,{...createKeibaPreview().horses[0],outfit:{cloth:'#efa9be',bridle:'#d4af37',hood:'full',ornament:'sakura',aura:{key:'ruby',body:'#c83550',glow:'#ff6980'}}});
    model.update(2);let body=false,cloth=false,glow=false;model.root.traverse((o:any)=>{if(o.material?.color){const c=o.material.color.getHexString();if(o.material.isMeshPhysicalMaterial&&c==='c83550')body=true;if(c==='efa9be')cloth=true;if(c==='ff6980')glow=true;}if(o.geometry)expect([...o.geometry.attributes.position.array].every(Number.isFinite)).toBe(true);});expect(body&&cloth&&glow).toBe(true);
  });

});
