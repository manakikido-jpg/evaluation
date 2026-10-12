/** 立体の盤面。結果・料金・サイコロの値はサーバーの状態だけを使う。 */
let scene = null, generation = 0, library;
const colors = [0xef7f89, 0x78bce4, 0xf3c869, 0x78c9a2, 0xb594de];
const gap = 3.15, lanes = [[-.64,-.4],[.64,-.4],[-.64,.65],[.64,.65],[0,-.9]];
const cellPoint = cell => { const row=Math.floor(cell/6), col=row%2?5-cell%6:cell%6; return {x:(col-2.5)*gap,z:(row-2.5)*gap}; };
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
class LifeScene {
  constructor(T, root, data) {
    this.T=T; this.data=data; this.table=data.table; this.root=root; this.cars=new Map(); this.disposed=false;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer=new T.WebGLRenderer({antialias:true,powerPreference:'low-power'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;
    this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;
    this.world=new T.Scene();this.world.background=new T.Color(0xe2e9e7);
    this.camera=new T.PerspectiveCamera(40,1,.1,100);this.yaw=.72;this.elevation=1.0;this.distance=innerWidth<600?47:39;
    this.world.add(new T.HemisphereLight(0xffffff,0x83986f,2.2));
    const sun=new T.DirectionalLight(0xfff5dd,3.4);sun.position.set(9,25,13);sun.castShadow=true;
    Object.assign(sun.shadow.camera,{left:-22,right:22,top:22,bottom:-22,near:1,far:65});sun.shadow.mapSize.set(1024,1024);sun.shadow.normalBias=.035;
    this.world.add(sun);
    this.floor=this.mesh(new T.CylinderGeometry(20,20,.6,64),0xd8c7b0,0,-.7,0);this.floor.receiveShadow=true;
    const frame=this.mesh(new T.BoxGeometry(21.4,.8,21.4),0x92745a,0,0,0);frame.receiveShadow=true;
    const mat=this.mesh(new T.BoxGeometry(20.9,.1,20.9),0xf4eedb,0,.45,0);mat.receiveShadow=true;
    this.tiles=[];
    for(let n=0;n<data.tiles.length;n++)this.makeTile(n,data.tiles[n]);
    for(let n=0;n<data.tiles.length-1;n++){
      const a=cellPoint(n),b=cellPoint(n+1),road=this.mesh(new T.BoxGeometry(.5,.06,gap),0xfff8e7,(a.x+b.x)/2,.56,(a.z+b.z)/2);
      road.rotation.y=Math.atan2(b.x-a.x,b.z-a.z);
    }
    this.decorate();this.makeDice();
    this.renderer.domElement.tabIndex=0;this.renderer.domElement.setAttribute('aria-label','立体の人生の盤面。ドラッグや矢印キーで回転、ピンチやプラス・マイナスで拡大縮小できます。');
    this.listeners=[];this.controls();
    this.observer=new ResizeObserver(()=>this.resize());this.attach(root,data,true);
    this.animate=now=>{if(this.disposed)return;this.frame(now);this.raf=requestAnimationFrame(this.animate);};this.raf=requestAnimationFrame(this.animate);
  }
  mesh(geometry,color,x=0,y=0,z=0,parent=this.world) {
    const T=this.T,m=new T.Mesh(geometry,new T.MeshStandardMaterial({color,roughness:.55,metalness:.02}));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
  }
  label(text, number, icon) {
    const T=this.T,c=document.createElement('canvas');c.width=c.height=256;
    const g=c.getContext('2d');g.textAlign='center';g.fillStyle='#384a4a';g.font='bold 20px sans-serif';g.fillText(number,128,28);
    g.font='52px sans-serif';g.fillText(icon,128,95);g.font='bold 21px sans-serif';
    const chars=[...text];g.fillText(chars.slice(0,7).join(''),128,132);if(chars.length>7)g.fillText(chars.slice(7).join(''),128,157);
    const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
    return new T.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false});
  }
  makeTile(n,tile) {
    const T=this.T,point=cellPoint(n),group=new T.Group();group.position.set(point.x,0,point.z);group.userData.cell=n;this.world.add(group);this.tiles.push(group);
    const palette={pay:0xf2d996,gift:0xf1dcad,house:0xb9d8e0,insurance:0xb9d8e0,luck:0xd3c4e2,accident:0xeabec3,family:0xeebfcf,goal:0xe2ba72};
    const tileColor=palette[tile.kind]??0xc4ddbe;
    this.mesh(new T.BoxGeometry(2.82,.22,2.82),tileColor,0,.6,0,group);
    const label=new T.Mesh(new T.PlaneGeometry(2.5,2.5),this.label(tile.label,n===0?'START':n===35?'GOAL':String(n),tile.icon));label.rotation.x=-Math.PI/2;label.position.y=.718;group.add(label);
    if(tile.kind==='house'||tile.kind==='promotion'){
      const x=-.91,z=-.93;
      this.mesh(new T.BoxGeometry(.55,.52,.55),tile.kind==='house'?0xf7e9d6:0xb6cedd,x,1,z,group);
      const roof=this.mesh(new T.ConeGeometry(.47,.4,4),0xd97772,x,1.44,z,group);roof.rotation.y=Math.PI/4;
      this.mesh(new T.BoxGeometry(.14,.24,.03),0x7c5644,x,1,z+.285,group);
    }
    if(tile.kind==='pay'||tile.kind==='gift')for(let k=0;k<3;k++)this.mesh(new T.CylinderGeometry(.22,.22,.1,20),0xe9b743,.92,.81+k*.105,-.94,group);
    if(tile.kind==='festival'){
      for(const x of [-.48,.48])this.mesh(new T.CylinderGeometry(.065,.065,.65,10),0xcd6761,x,1,-1,group);
      this.mesh(new T.BoxGeometry(1.2,.12,.14),0xcd6761,0,1.4,-1,group);
    }
  }
  decorate() {
    const T=this.T;
    for(let i=0;i<10;i++){
      const x=i<5?-11.7:11.7,z=(i%5-2)*4;
      this.mesh(new T.CylinderGeometry(.1,.14,.65,8),0x967358,x,.75,z);
      this.mesh(new T.IcosahedronGeometry(.65,1),i%3===0?0xf1b8ca:0x87b9a4,x,1.5,z);
    }
    for(let i=0;i<5;i++)this.mesh(new T.BoxGeometry(1.9,.18,.16),0xd6b275,11.5,.65,-9+i*.42);
  }
  car(id,index,family) {
    const T=this.T,g=new T.Group();this.world.add(g);
    const color=colors[index%colors.length];
    this.mesh(new T.BoxGeometry(.7,.22,1.16),color,0,.3,0,g);
    this.mesh(new T.BoxGeometry(.63,.21,.6),color,0,.49,-.08,g);
    this.mesh(new T.BoxGeometry(.51,.15,.3),0xc9e3e9,0,.52,.24,g);
    for(const x of [-.36,.36])for(const z of [-.37,.4]){
      const wheel=this.mesh(new T.CylinderGeometry(.16,.16,.11,16),0x424344,x,.2,z,g);wheel.rotation.z=Math.PI/2;
      const hub=this.mesh(new T.CylinderGeometry(.07,.07,.12,12),0xe6e7e3,x,.2,z,g);hub.rotation.z=Math.PI/2;
    }
    for(const x of [-.2,.2])this.mesh(new T.SphereGeometry(.045,8,8),0xfff3bf,x,.3,.6,g);
    const heads=new T.Group();g.add(heads);
    const actor={id,mesh:g,heads,index,family:-1,cell:0,target:0,queue:[],hop:null,wait:0};this.passengers(actor,family);return actor;
  }
  passengers(actor,family) {
    const T=this.T,count=Math.min(family+1,3);if(actor.family===family)return;
    actor.family=family;
    for(const child of [...actor.heads.children]){actor.heads.remove(child);child.geometry.dispose();child.material.dispose();}
    for(let k=0;k<count;k++)this.mesh(new T.SphereGeometry(.095,12,12),k===0?0xf3cfac:0xf0ba9c,k===0?-.15:.15,.69,k===2?-.29:.06,actor.heads);
  }
  diceTexture(n) {
    const T=this.T,c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');g.fillStyle='#faf8ef';g.fillRect(0,0,128,128);g.fillStyle='#495557';
    const pips={1:[[1,1]],2:[[0,0],[2,2]],3:[[0,0],[1,1],[2,2]],4:[[0,0],[2,0],[0,2],[2,2]],5:[[0,0],[2,0],[1,1],[0,2],[2,2]],6:[[0,0],[0,1],[0,2],[2,0],[2,1],[2,2]]};
    for(const [x,y] of pips[n]){g.beginPath();g.arc(28+x*36,28+y*36,10,0,Math.PI*2);g.fill();}
    const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;return new T.MeshStandardMaterial({map,roughness:.35});
  }
  makeDice() {
    const T=this.T;this.mesh(new T.BoxGeometry(3.2,.22,3.2),0x8eaa9a,-11.2,.35,9.7);
    this.dice=new T.Mesh(new T.BoxGeometry(1.05,1.05,1.05),[3,4,1,6,2,5].map(n=>this.diceTexture(n)));this.dice.position.set(-11.2,1.05,9.7);this.dice.castShadow=true;this.world.add(this.dice);this.rollAt=0;this.die=1;this.setDice(1);
  }
  setDice(value) {
    const T=this.T, rotations={1:[0,0,0],2:[-Math.PI/2,0,0],3:[0,0,Math.PI/2],4:[0,0,-Math.PI/2],5:[Math.PI/2,0,0],6:[Math.PI,0,0]};
    this.finalDice=new T.Quaternion().setFromEuler(new T.Euler(...rotations[value]));this.dice.quaternion.copy(this.finalDice);
  }
  attach(root,data,first=false) {
    this.root=root;this.data=data;root.appendChild(this.renderer.domElement);this.observer.disconnect();this.observer.observe(root);
    const wrap=root.closest('[data-life-presentation]');wrap.dataset.lifeReady='1';wrap.dataset.lifeView=this.flat?'flat':'3d';
    const toggle=wrap.querySelector('[data-life-toggle]');toggle.textContent=this.flat?'立体で見る':'マスで見る';toggle.setAttribute('aria-pressed',String(!this.flat));
    const rollKey=JSON.stringify(data.roll);
    const rolled=!first && this.rollKey!==rollKey && data.roll;
    this.rollKey=rollKey;
    if(data.roll){this.die=data.roll.die;this.setDice(this.die);if(rolled&&!this.reduced)this.rollAt=performance.now();}
    const now=performance.now(), ids=new Set(data.pawns.map(p=>p.id));
    for(const [id,actor] of this.cars)if(!ids.has(id)){this.world.remove(actor.mesh);actor.mesh.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});this.cars.delete(id);}
    for(const [index,p] of data.pawns.entries()){
      let actor=this.cars.get(p.id);
      if(!actor){actor=this.car(p.id,index,p.family);actor.cell=p.position;actor.target=p.position;this.cars.set(p.id,actor);this.place(actor,p.position);}
      this.passengers(actor,p.family);
      if(p.position!==actor.target){
        if(this.reduced||p.position<actor.target){actor.queue=[];actor.hop=null;actor.cell=actor.target=p.position;this.place(actor,p.position);}
        else {for(let cell=actor.target+1;cell<=p.position;cell++)actor.queue.push(cell);actor.target=p.position;actor.wait=rolled?now+900:now;}
      }
    }
    root.dataset.lifeActors=String(this.cars.size);root.dataset.lifeRenderer='webgl';this.resize();
  }
  point(actor,cell) { const p=cellPoint(cell),off=lanes[actor.index%5];return new this.T.Vector3(p.x+off[0],.67,p.z+off[1]); }
  place(actor,cell) {actor.mesh.position.copy(this.point(actor,cell));}
  resize() {
    const width=this.root.clientWidth||this.root.parentElement.clientWidth||800,height=this.root.clientHeight||420;
    this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
  }
  frame(now) {
    if(!this.root.isConnected||document.hidden)return;
    let moving=0;
    for(const actor of this.cars.values()){
      if(!actor.hop&&actor.queue.length&&now>=actor.wait)actor.hop={from:actor.cell,to:actor.queue.shift(),at:now};
      if(actor.hop){
        moving++;const hop=actor.hop,t=clamp((now-hop.at)/250,0,1),smooth=t*t*(3-2*t),from=this.point(actor,hop.from),to=this.point(actor,hop.to);
        actor.mesh.position.lerpVectors(from,to,smooth);actor.mesh.position.y+=Math.sin(t*Math.PI)*.18;
        actor.mesh.rotation.y=Math.atan2(to.x-from.x,to.z-from.z);
        if(t===1){actor.cell=hop.to;actor.hop=null;}
      }else if(actor.queue.length)moving++;
    }
    if(this.rollAt){const t=clamp((now-this.rollAt)/900,0,1);this.dice.rotation.set(t*Math.PI*4,t*Math.PI*6,t*Math.PI*2);this.dice.position.y=1.05+Math.sin(t*Math.PI)*1.35;if(t===1){this.rollAt=0;this.dice.quaternion.copy(this.finalDice);}}
    this.root.dataset.lifeMoving=String(moving);
    this.camera.position.set(Math.sin(this.yaw)*Math.cos(this.elevation)*this.distance,Math.sin(this.elevation)*this.distance,Math.cos(this.yaw)*Math.cos(this.elevation)*this.distance);this.camera.lookAt(0,.3,0);
    if(!this.flat)this.renderer.render(this.world,this.camera);
  }
  controls() {
    const canvas=this.renderer.domElement, pointers=new Map();let pinch=0,dragged=false;
    const listen=(type,fn,opts)=>{canvas.addEventListener(type,fn,opts);this.listeners.push([type,fn]);};
    listen('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});dragged=false;pinch=0;});
    listen('pointermove',e=>{
      const old=pointers.get(e.pointerId);if(!old)return;
      const dx=e.clientX-old.x,dy=e.clientY-old.y;if(Math.abs(dx)+Math.abs(dy)>2)dragged=true;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointers.size===1){this.yaw-=dx*.006;this.elevation=clamp(this.elevation+dy*.005,.55,1.35);}
      else {const [a,b]=pointers.values(),distance=Math.hypot(a.x-b.x,a.y-b.y);if(pinch>0&&distance>0)this.distance=clamp(this.distance*pinch/distance,22,65);pinch=distance;}
    });
    const up=e=>{if(!dragged&&pointers.size===1)this.pick(e);pointers.delete(e.pointerId);if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);pinch=0;};
    listen('pointerup',up);listen('pointercancel',e=>pointers.delete(e.pointerId));
    listen('wheel',e=>{e.preventDefault();this.distance=clamp(this.distance+e.deltaY*.035,22,65);},{passive:false});
    listen('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(e.key))return;e.preventDefault();if(e.key==='Home')this.reset();else if(e.key==='ArrowLeft')this.yaw-=.1;else if(e.key==='ArrowRight')this.yaw+=.1;else if(e.key==='ArrowUp')this.elevation=clamp(this.elevation+.1,.55,1.35);else if(e.key==='ArrowDown')this.elevation=clamp(this.elevation-.1,.55,1.35);else this.distance=clamp(this.distance+(e.key==='-'?2:-2),22,65);});
  }
  pick(event) {
    const T=this.T,r=this.renderer.domElement.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1),this.camera);
    const hits=ray.intersectObjects(this.tiles,true);if(!hits.length)return;let object=hits[0].object;while(object&&object.userData.cell===undefined)object=object.parent;
    if(!object)return;const at=object.userData.cell,tile=this.data.tiles[at],names=this.data.pawns.filter(p=>p.position===at).map(p=>p.name);
    this.root.closest('[data-life-presentation]').querySelector('[data-life-note]').textContent=`${at}マス：${tile.icon} ${tile.label}${names.length?' ／ '+names.join('・'):''}`;
  }
  reset() {this.yaw=.72;this.elevation=1;this.distance=innerWidth<600?47:39;}
  toggle() {this.flat=!this.flat;this.attach(this.root,this.data);}
  dispose() {
    this.disposed=true;cancelAnimationFrame(this.raf);this.observer.disconnect();
    for(const [type,fn] of this.listeners)this.renderer.domElement.removeEventListener(type,fn);
    const geometries=new Set(),materials=new Set(),textures=new Set();
    this.world.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);if(m.map)textures.add(m.map);}});
    for(const t of textures)t.dispose();for(const m of materials)m.dispose();for(const g of geometries)g.dispose();this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();
  }
}
async function init() {
  const ticket=++generation,root=document.querySelector('[data-life3d]');
  if(!root){scene?.dispose();scene=null;return;}
  let data;try{data=JSON.parse(root.dataset.life3d);}catch{return;}
  if(scene?.table===data.table){scene.attach(root,data);return;}
  scene?.dispose();scene=null;
  try {
    library??=import('/static/three.module.js?v=0.180.0');const T=await library;
    if(ticket!==generation)return;
    if(root!==document.querySelector('[data-life3d]'))return init();
    scene=new LifeScene(T,root,data);
  }catch(error){
    root.closest('[data-life-presentation]').dataset.lifeView='flat';
    root.closest('[data-life-presentation]').querySelector('[data-life-note]').textContent='立体表示を読み込めませんでした。マスの表示でそのまま遊べます。';
    console.warn('life board renderer unavailable',error);
  }
}
document.addEventListener('c-live-updated',init);document.addEventListener('c-page-swapped',init);
document.addEventListener('click',e=>{if(e.target.closest?.('[data-life-reset]'))scene?.reset();if(e.target.closest?.('[data-life-toggle]')){if(scene)scene.toggle();else void init();}});
init();
