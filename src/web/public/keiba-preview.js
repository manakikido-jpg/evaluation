import { clamp, sampleReplay, trackPoint, replayLimit } from './keiba-replay.js?v=1';
import { createHorse } from './keiba-horse.js?v=1';
const root=document.querySelector('[data-keiba-preview]');
if(root)void start(root);
async function start(root) {
  const data=JSON.parse(root.dataset.keibaPreview), sceneRoot=root.querySelector('[data-kr-scene]'), flat=root.querySelector('[data-kr-flat]');
  const status=root.querySelector('[data-kr-status]'), seek=root.querySelector('[data-kr-seek]'), play=root.querySelector('[data-kr-play]'), quality=root.querySelector('[data-kr-quality]');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let T,scene,elapsed=0,playing=false,last=performance.now(),raf=0,camera='wide',disposed=false,lastUI=-1,lastRender=0,measure=last,frames=0,loading=0,dirty=true;
  let clockAt=performance.now(),serverAt=data.live?.now??0,pollTimer=0,polling=false;
  const liveStatus=root.querySelector('[data-kr-live-status]');
  const serverNow=()=>serverAt+performance.now()-clockAt;
  const limit=()=>replayLimit(data,serverNow());
  if(data.live&&!data.live.confirmed){elapsed=limit();playing=!reduced;play.textContent=playing?'停止':'再生';}
  function showOfficial(){
    if(!data.live?.confirmed)return;
    root.querySelector('[data-kr-official]').hidden=false;
    const list=root.querySelector('[data-kr-times]');list.replaceChildren();
    for(const r of data.results){const li=document.createElement('li');li.textContent=`${r.no}番 ${data.horses.find(h=>h.no===r.no)?.name??''}　${r.time}${r.margin?`（${r.margin}）`:''}`;list.append(li);}
  }
  showOfficial();
  async function pollLive(){
    if(disposed||!data.live||data.live.confirmed)return;
    if(document.hidden){pollTimer=setTimeout(pollLive,2000);return;}
    polling=true;
    try{
      const response=await fetch(data.live.url,{cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});
      if(disposed)return;
      if(response.status===409||response.status===404||response.status===403){
        liveStatus.textContent='このレースの情報更新は終了しました。表示中の映像を保持しています。続きは競馬の卓で確認してください。';return;
      }
      if(!response.ok)throw new Error('state unavailable');
      const next=await response.json();
      if(next.live?.key!==data.live.key)throw new Error('race mismatch');
      data.live=next.live;data.results=next.results;serverAt=next.live.now;clockAt=performance.now();dirty=true;
      liveStatus.textContent=next.live.confirmed?'結果が確定しました。自由に見返せます。馬券・払戻は競馬の卓で確認してください。':'サーバーの時刻に合わせて観戦中です。';
      showOfficial();
    }catch{if(!disposed)liveStatus.textContent='レース情報を確認できません。再接続を試しています。';}
    finally{polling=false;}
    if(!disposed&&!data.live.confirmed)pollTimer=setTimeout(pollLive,2000);
  }
  const names=new Map(data.horses.map(h=>[h.no,h.name])), rank=root.querySelector('[data-kr-ranking]');
  const rows=new Map();for(const h of data.horses){const li=document.createElement('li'),no=document.createElement('b'),name=document.createElement('span');no.textContent=h.no;no.className=`kr-no kr-no-${h.no}`;name.textContent=h.name;li.append(no,name);rank.append(li);rows.set(h.no,li);}
  class RaceScene {
    constructor() {
      this.renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.0;
      this.world=new T.Scene();const sky=data.race.weather===0?0xcbdce5:data.race.weather===1?0xb3bec8:0x8a9ba9;this.world.background=new T.Color(sky);this.world.fog=new T.Fog(sky,160,900);
      this.view=new T.PerspectiveCamera(38,1,.1,2200);this.world.add(new T.HemisphereLight(0xe4edff,0x8e805e,2.1));
      this.sun=new T.DirectionalLight(0xffe8c6,2.5);this.sun.position.set(-40,70,40);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-55,right:55,top:55,bottom:-55,near:.1,far:180});this.sun.shadow.normalBias=.018;this.sun.shadow.radius=3;this.world.add(this.sun,this.sun.target);
      this.renderer.shadowMap.type=T.PCFSoftShadowMap;
      this.low=quality.value==='low'||quality.value==='auto'&&(matchMedia('(pointer: coarse)').matches||innerWidth<900);
      this.textures=[];if(!this.low)this.environment();this.makeCourse();this.horses=data.horses.map(h=>{const model=createHorse(T,h);this.world.add(model.root);return model;});
      sceneRoot.append(this.renderer.domElement);this.renderer.domElement.addEventListener('webglcontextlost',onLost);
      this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(sceneRoot);this.resize();this.setQuality();
    }
    environment() {
      const faces=[];
      for(let i=0;i<6;i++){
        const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d'),gradient=g.createLinearGradient(0,0,0,128);
        gradient.addColorStop(0,'#e5edfa');gradient.addColorStop(.5,'#c1d0d7');gradient.addColorStop(1,'#78765b');g.fillStyle=gradient;g.fillRect(0,0,128,128);
        const glow=g.createRadialGradient(30,32,1,30,32,75);glow.addColorStop(0,i===0?'#fff2d9aa':'#ffffff35');glow.addColorStop(1,'#ffffff00');g.fillStyle=glow;g.fillRect(0,0,128,128);faces.push(c);
      }
      const cube=new T.CubeTexture(faces);cube.colorSpace=T.SRGBColorSpace;cube.needsUpdate=true;
      this.pmrem=new T.PMREMGenerator(this.renderer);this.environmentTarget=this.pmrem.fromCubemap(cube);cube.dispose();
      this.world.environment=this.environmentTarget.texture;this.world.environmentIntensity=.45;
    }
    mesh(geometry,color,x=0,y=0,z=0,roughness=.9) {
      const m=new T.Mesh(geometry,new T.MeshStandardMaterial({color,roughness}));m.position.set(x,y,z);m.receiveShadow=true;this.world.add(m);return m;
    }
    grass(striped=false) {
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const g=canvas.getContext('2d');
      let seed=811;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      for(let x=0;x<512;x++)for(let y=0;y<128;y++){const light=rand()*19+(striped&&x<256?9:0);g.fillStyle=striped&&data.race.surface===1?`rgb(${125+light},${105+light},${76+light})`:`rgb(${45+light},${83+light},${31+light*.5})`;g.fillRect(x,y,1,1);}
      const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());this.textures.push(tex);return tex;
    }
    makeCourse() {
      const turf=this.grass(true),infield=this.grass();infield.repeat.set(95,70);
      const ground=this.mesh(new T.PlaneGeometry(2000,1500),0xb0b79c,0,-.035,0);ground.rotation.x=-Math.PI/2;ground.material.map=infield;
      const pos=[],uv=[],indices=[],colors=[],n=500;
      for(let i=0;i<=n;i++)for(const lane of [0,22]){const p=trackPoint(i/n*2000,lane);pos.push(p.x,0,p.z);uv.push(i/n*250,lane/4);colors.push(1,1,1);if(i<n&&lane===0){const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}}
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();const track=this.mesh(geo,0xffffff);track.material.map=turf;
      const railMat=new T.MeshStandardMaterial({color:0xf3f0dc,roughness:.6});
      for(const lane of [-.8,23]){
        const points=Array.from({length:501},(_,i)=>{const p=trackPoint(i/500*2000,lane);return new T.Vector3(p.x,.95,p.z);});
        const rail=new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points,true),500,.055,5,true),railMat);this.world.add(rail);
        const count=500,posts=new T.InstancedMesh(new T.CylinderGeometry(.035,.05,.98,5),railMat,count),dummy=new T.Object3D();
        for(let i=0;i<count;i++){const p=trackPoint(i/count*2000,lane);dummy.position.set(p.x,.49,p.z);dummy.updateMatrix();posts.setMatrixAt(i,dummy.matrix);}this.world.add(posts);
      }
      // ゴール板。実際のサーバーコースの0m位置に置く。
      const goal=trackPoint(0,24);this.mesh(new T.BoxGeometry(.4,4,.4),0xe8e4d4,goal.x,2,goal.z);
      this.mesh(new T.BoxGeometry(.6,1,.18),0xb8372f,goal.x,3.1,goal.z+.2);
      const sign=this.label('決 勝',512,128,'#fcf7df','#17352e');const board=this.mesh(new T.BoxGeometry(4.8,1.2,.1),0xffffff,goal.x,4.7,goal.z);board.material.map=sign;
      for(let i=0;i<6;i++)this.mesh(new T.BoxGeometry(290,1.1,8),i%2?0xc8c3b4:0xb7b5af,-35,.55+i*.95,210+i*7);
      const seats=new T.InstancedMesh(new T.BoxGeometry(.55,.38,.52),new T.MeshStandardMaterial({color:0x536b7d,roughness:.9}),1800),dummy=new T.Object3D();let at=0;
      for(let r=0;r<12;r++)for(let c=0;c<150;c++){dummy.position.set(-160+c*1.7,1+r*.43,211+r*2.8);dummy.updateMatrix();seats.setMatrixAt(at++,dummy.matrix);}this.world.add(seats);
      this.mesh(new T.BoxGeometry(305,.5,51),0xe6e3d5,-35,10,230);
      for(let c=0;c<12;c++)this.mesh(new T.BoxGeometry(.5,10,.5),0xb9b5a9,-176+c*25,5,251);
      const banner=this.mesh(new T.BoxGeometry(70,3.5,.1),0xffffff,-25,8.3,205);banner.material.map=this.label('咲 楽 ノ 宮 競 馬 場',1024,128,'#efe9d9','#17352e');
      const leaves=new T.InstancedMesh(new T.IcosahedronGeometry(.49,0),new T.MeshStandardMaterial({color:0xffffff,roughness:1}),16*220),leafDummy=new T.Object3D();let leafIndex=0,seed=21;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      for(let i=0;i<16;i++) {
        const x=-250+i*33,z=-50+(i%3)*34;
        this.mesh(new T.CylinderGeometry(.18,.3,4.2,8),0x65574b,x,2.1,z);
        for(let j=0;j<220;j++){
          const a=rand()*Math.PI*2,vertical=rand()*2-1,r=Math.cbrt(rand()),ring=Math.sqrt(1-vertical*vertical);
          leafDummy.position.set(x+Math.cos(a)*r*ring*4,5+vertical*r*2.9,z+Math.sin(a)*r*ring*3.2);leafDummy.scale.setScalar(.65+rand()*.75);leafDummy.rotation.set(rand()*3,rand()*3,rand()*3);leafDummy.updateMatrix();leaves.setMatrixAt(leafIndex,leafDummy.matrix);
          const color=new T.Color(i%4===0?0xc5a8ae:0x657c4b);color.multiplyScalar(.8+rand()*.35);leaves.setColorAt(leafIndex++,color);
        }
      }this.world.add(leaves);
      for(let i=0;i<5;i++){const hill=this.mesh(new T.SphereGeometry(1,48,24),0xa8b7ac,-650+i*350,5,-680);hill.scale.set(230,55+(i%2)*20,160);}

    }
    label(text,w,h,bg,fg) {
      const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle=bg;g.fillRect(0,0,w,h);g.fillStyle=fg;g.font=`600 ${h*.64}px serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(text,w/2,h/2,w*.93);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;this.textures.push(t);return t;
    }
    resize(){const r=sceneRoot.getBoundingClientRect();if(r.width<1||r.height<1)return;this.renderer.setSize(r.width,r.height,false);this.view.aspect=r.width/r.height;this.view.updateProjectionMatrix();dirty=true;}
    setQuality(){const low=quality.value==='low'||quality.value==='auto'&&(matchMedia('(pointer: coarse)').matches||innerWidth<900);this.low=low;this.world.environment=low?null:this.environmentTarget?.texture??null;for(const horse of this.horses)horse.setQuality(low);this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,low?1:1.6));this.renderer.shadowMap.enabled=!low;this.resize();}
    render(state,time) {
      const positions=state.positions;
      for(let i=0;i<this.horses.length;i++){const h=this.horses[i],p=positions[i];h.root.position.set(p.x,0,p.z);h.root.rotation.y=p.heading;h.update(time/1000,time>0&&!reduced);}
      const leader=positions.find(p=>p.no===state.order[0]),tail=positions.find(p=>p.no===state.order.at(-1));
      let focus=new T.Vector3(leader.x,1.25,leader.z),distance=15,height=2.8,forward=1;
      if(camera==='wide'){const span=Math.hypot(leader.x-tail.x,leader.z-tail.z);focus=new T.Vector3((leader.x+tail.x)/2,1,(leader.z+tail.z)/2);distance=clamp(span*.9+28,35,120);height=clamp(distance*.45,17,48);forward=8;}
      const heading=new T.Vector3(Math.cos(-leader.heading),0,Math.sin(-leader.heading)),outside=new T.Vector3(-heading.z,0,heading.x);
      let eye=focus.clone().addScaledVector(outside,distance).addScaledVector(heading,forward).add(new T.Vector3(0,height,0));
      if(camera==='finish'){const p=trackPoint(0,8);focus=new T.Vector3(p.x,1,p.z);eye=new T.Vector3(p.x+12,4.8,p.z+22);}
      this.view.fov=camera==='wide'?38:32;this.view.updateProjectionMatrix();this.view.position.copy(eye);this.view.lookAt(focus);
      this.sun.position.copy(focus).add(new T.Vector3(-40,70,40));this.sun.target.position.copy(focus);
      this.renderer.render(this.world,this.view);
    }
    dispose(){this.observer.disconnect();this.renderer.domElement.removeEventListener('webglcontextlost',onLost);const geometries=new Set(),materials=new Set(),textures=new Set(this.textures);this.world.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);if(m.map)textures.add(m.map);}});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();this.environmentTarget?.dispose();this.pmrem?.dispose();this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();}
  }
  function drawFlat(state){
    const r=flat.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,1.5),w=Math.max(1,r.width),h=Math.max(1,r.height);if(flat.width!==Math.round(w*ratio)||flat.height!==Math.round(h*ratio)){flat.width=w*ratio;flat.height=h*ratio;}const g=flat.getContext('2d');g.setTransform(ratio,0,0,ratio,0,0);g.fillStyle='#47663c';g.fillRect(0,0,w,h);const left=30,right=w-45,top=48,bottom=h-35;g.strokeStyle='#e9e4d2';g.lineWidth=2;g.strokeRect(left,top,right-left,bottom-top);g.font='13px sans-serif';g.fillStyle='#fff';g.fillText('軽量表示 · 同じ走行データを再生',left,25);for(const p of state.positions){const x=left+clamp(p.progress,0,1.08)/1.08*(right-left),y=top+(p.no-.5)/8*(bottom-top);g.fillStyle=['#eee','#252525','#bf4035','#3467a5','#ddbf4f','#527f4e','#cd773d','#c383a6'][p.no-1];g.beginPath();g.arc(x,y,9,0,Math.PI*2);g.fill();g.fillStyle=p.no===2?'#fff':'#17211d';g.textAlign='center';g.fillText(p.no,x,y+4);}g.textAlign='left';}
  async function build(){dirty=true;const token=++loading;scene?.dispose();scene=null;sceneRoot.hidden=quality.value==='flat';flat.hidden=quality.value!=='flat';if(quality.value==='flat'){status.textContent='軽量表示です。';return;}status.textContent='3Dを読み込んでいます…';try{T??=await import('/static/three.module.js?v=0.180.0');if(disposed||token!==loading)return;scene=new RaceScene();status.textContent='';}catch(error){if(disposed||token!==loading)return;quality.value='flat';sceneRoot.hidden=true;flat.hidden=false;status.textContent='3Dを利用できないため、軽量表示で再生します。';console.warn('keiba preview renderer unavailable',error);}}
  function onLost(e){e.preventDefault();quality.value='flat';void build();}
  function updateUI(state){seek.max=String(Math.floor(limit()/data.durationMs*1000));seek.value=String(Math.round(elapsed/data.durationMs*1000));root.querySelector('[data-kr-clock]').textContent=`${Math.floor(elapsed/60000).toString().padStart(2,'0')}:${Math.floor(elapsed/1000%60).toString().padStart(2,'0')}`;root.querySelector('[data-kr-distance]').textContent=state.complete?'全馬ゴール':`残り${state.remaining.toLocaleString('ja-JP')}m`;for(const no of state.order)rank.append(rows.get(no));root.querySelector('.kr-results h2').textContent=state.complete?(data.live&&!data.live.confirmed?'到達順位（確定待ち）':'確定着順'):'途中順位';root.querySelector('[data-kr-caption]').textContent={wide:'全景カメラ',track:'直線・追走カメラ',finish:'ゴールカメラ'}[camera];if(data.live){const pending=data.live.start-serverNow();root.querySelector('[data-kr-mode]').textContent=data.live.confirmed?'REPLAY':pending>0?`発走まで${Math.ceil(pending/1000)}秒`:'LIVE';root.querySelector('[data-kr-goal]').textContent=data.live.confirmed?'ゴール前へ':'現在へ';root.querySelector('[data-kr-call]').textContent=[...(data.calls??[])].reverse().find(c=>c.t<=elapsed)?.text??'';}}
  function frame(now) {
    if(disposed)return;
    const dt=Math.max(0,now-last);last=now;
    if(playing)elapsed=data.live&&!data.live.confirmed?limit():Math.min(data.durationMs,elapsed+dt);
    else elapsed=Math.min(elapsed,limit());
    if(playing&&elapsed>=data.durationMs){playing=false;play.textContent='もう一度';dirty=true;}
    const state=sampleReplay(data,elapsed);
    // 操作結果は描画処理の前に反映する。遅い端末でも値の更新を次のフレームへ持ち越さない。
    if(now-lastUI>100||dirty){updateUI(state);lastUI=now;}
    if((playing||dirty)&&now-lastRender>=(scene?.low?1000/30:1000/60)-1){
      if(scene)scene.render(state,elapsed);else drawFlat(state);
      lastRender=now;frames++;dirty=false;
    }
    if(now-measure>2000){
      const fps=Math.round(frames*1000/(now-measure));
      root.querySelector('[data-kr-performance]').textContent=scene?playing?`${fps} fps · ${scene.renderer.info.render.calls}描画`:'停止中':'軽量表示';
      frames=0;measure=now;
    }
    raf=requestAnimationFrame(frame);
  }
  play.addEventListener('click',()=>{if(data.live&&!data.live.confirmed)elapsed=limit();else if(elapsed>=data.durationMs)elapsed=0;playing=!playing;dirty=true;play.textContent=playing?'停止':'再生';});
  root.querySelector('[data-kr-goal]').addEventListener('click',()=>{elapsed=data.live&&!data.live.confirmed?limit():Math.max(0,Math.min(...data.finishMs)-350);camera='finish';dirty=true;for(const b of root.querySelectorAll('[data-kr-camera]'))b.setAttribute('aria-pressed',String(b.dataset.krCamera==='finish'));});
  seek.addEventListener('input',()=>{elapsed=Math.min(limit(),Number(seek.value)/1000*data.durationMs);if(data.live&&!data.live.confirmed){playing=false;play.textContent='再生';}dirty=true;});
  for(const b of root.querySelectorAll('[data-kr-camera]'))b.addEventListener('click',()=>{camera=b.dataset.krCamera;dirty=true;for(const c of root.querySelectorAll('[data-kr-camera]'))c.setAttribute('aria-pressed',String(c===b));});
  quality.addEventListener('change',()=>void build());
  function visibility(){if(document.hidden){cancelAnimationFrame(raf);raf=0;}else if(!raf&&!disposed){last=performance.now();raf=requestAnimationFrame(frame);}}
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',()=>{disposed=true;loading++;clearTimeout(pollTimer);cancelAnimationFrame(raf);document.removeEventListener('visibilitychange',visibility);scene?.dispose();},{once:true});
  window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
  if(data.live&&!data.live.confirmed&&!polling)pollTimer=setTimeout(pollLive,2000);
  await build();if(!disposed){last=performance.now();raf=requestAnimationFrame(frame);}
}
