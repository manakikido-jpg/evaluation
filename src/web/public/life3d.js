/** 立体の盤面。結果・料金・サイコロの値はサーバーの状態だけを使う。 */
import { createLifeRoute } from './life-route.js?v=1';
let scene = null, generation = 0, library;
const colors = [0xef7f89, 0x78bce4, 0xf3c869, 0x78c9a2, 0xb594de];
const lanes = [[-.64,-.4],[.64,-.4],[-.64,.65],[.64,.65],[0,-.9]];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
class LifeScene {
  constructor(T, root, data) {
    this.T=T; this.data=data; this.table=data.table; this.root=root; this.cars=new Map(); this.disposed=false;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer=new T.WebGLRenderer({antialias:true,powerPreference:'low-power'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;
    this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.9;
    this.world=new T.Scene();this.world.background=new T.Color(0xb9dded);this.goal=data.tiles.length-1;this.route=createLifeRoute(T,data.tiles.length);
    this.camera=new T.PerspectiveCamera(40,1,.1,100);this.yaw=.72;this.elevation=.95;this.distance=innerWidth<600?65:54;
    this.world.add(new T.HemisphereLight(0xffffff,0x83986f,1.2));
    const sun=new T.DirectionalLight(0xfff5dd,2.5);sun.position.set(9,25,13);sun.castShadow=true;
    Object.assign(sun.shadow.camera,{left:-22,right:22,top:22,bottom:-22,near:1,far:65});sun.shadow.mapSize.set(1024,1024);sun.shadow.normalBias=.035;
    this.world.add(sun);
    this.floor=this.mesh(new T.CylinderGeometry(22,22,1,80),0xb2d772,0,-.55,0);this.floor.receiveShadow=true;
    const land=this.mesh(new T.CylinderGeometry(21.6,21.6,.18,80),0x79bd50,0,.04,0);land.receiveShadow=true;
    this.tiles=[];
    for(let n=0;n<data.tiles.length;n++)this.makeTile(n,data.tiles[n]);
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
  ribbon(start,end,width,height,color,parent=this.world) {
    const T=this.T,positions=[],indices=[],steps=12;
    for(let i=0;i<=steps;i++){
      const t=start+(end-start)*i/steps,p=this.route.point(t),v=this.route.tangent(t);
      for(const side of [-1,1])positions.push(p.x+v.z*width/2*side,height,p.z-v.x*width/2*side);
      if(i<steps){const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}
    }
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=this.mesh(geometry,color,0,0,0,parent);mesh.material.side=T.DoubleSide;mesh.castShadow=false;return mesh;
  }
  makeTile(n,tile) {
    const T=this.T,group=new T.Group();group.userData.cell=n;this.world.add(group);this.tiles.push(group);
    const palette={pay:0xffd445,gift:0xffdd68,house:0x77d5ec,insurance:0x77d5ec,luck:0xccb7ee,accident:0xf78982,family:0xf89fbe,goal:0xffb639};
    const start=Math.max(0,n-.5),end=Math.min(this.goal,n+.5);
    this.ribbon(start,end,3.05,.23,0xfaf5da,group);
    this.ribbon(start+.025,end-.025,2.72,.25,palette[tile.kind]??0xf9e962,group);
    const point=this.route.point(n),direction=this.route.tangent(n);
    const label=new T.Mesh(new T.PlaneGeometry(2.15,2.15*35/this.goal),this.label(tile.label,n===0?'START':n===this.goal?'GOAL':String(n),tile.icon));
    label.rotation.set(-Math.PI/2,0,-Math.atan2(direction.x,direction.z));label.position.set(point.x,.27,point.z);group.add(label);
  }
  decorate() {
    const T=this.T;
    // 川と橋。道とは別の風景として、見通しを残して置く。
    this.mesh(new T.BoxGeometry(3.4,.04,31),0x50bbdc,-7,.16,0);
    const crossings=[];
    for(let n=1;n<=this.goal*10;n++){const a=this.route.point((n-1)/10),b=this.route.point(n/10);if((a.x+7)*(b.x+7)<0)crossings.push(a.z+(b.z-a.z)*(-7-a.x)/(b.x-a.x));}
    for(const z of crossings){
      this.mesh(new T.BoxGeometry(4.4,.13,2.9),0xd3a968,-7,.10,z);
      for(const side of [-1,1])this.mesh(new T.BoxGeometry(4.4,.2,.12),0xf0d49c,-7,.47,z+side*1.45);
    }
    // 道にかぶらない場所を選んで、山・街・木を並べる。
    const clear=(x,z,r=2.3)=>this.route.centers.every(p=>Math.hypot(x-p.x,z-p.z)>r);
    for(const [x,z,r,h] of [[-15,-7,3.6,5],[-13,-14,3.8,6],[12,-14,3.8,6.2],[16,-8,3.1,4.8]]){
      this.mesh(new T.ConeGeometry(r,h,7),0x858d77,x,h/2+.15,z);
      this.mesh(new T.ConeGeometry(r*.42,h*.35,7),0xdbe3d2,x,h*.83+.15,z);
    }
    for(let row=0;row<6;row++)for(let col=0;col<7;col++){
      const x=-9+col*3,z=-8+row*3.2;
      if(!clear(x,z,2.75)||Math.abs(x+7)<2.3)continue;
      const tall=(row+col)%3===0,h=tall?2.1:1.1,color=[0xf1e3b8,0xa4d7ea,0xf0a69c,0xbbcde5][(row+col)%4];
      this.mesh(new T.BoxGeometry(1.15,h,1.15),color,x,h/2+.15,z);
      if(!tall){const roof=this.mesh(new T.ConeGeometry(1,.65,4),0xc96755,x,h+.48,z);roof.rotation.y=Math.PI/4;}
      else this.mesh(new T.BoxGeometry(1.3,.18,1.3),0x688ba1,x,h+.23,z);
      for(let level=0;level<(tall?3:1);level++)for(const off of [-.27,.27])this.mesh(new T.BoxGeometry(.2,.23,.03),0x6c9eae,x+off,.55+level*.5,z+.585);
    }
    for(let row=0;row<2;row++)for(let col=0;col<6;col++){
      const x=-4+col*1.8,z=-16+row*1.8,h=1.4+((row+col)%4)*.55;
      if(!clear(x,z,2.4))continue;
      this.mesh(new T.BoxGeometry(1.15,h,1.15),[0x83bad9,0xe8c783,0xa8bfdc][col%3],x,h/2+.15,z);
      this.mesh(new T.BoxGeometry(1.24,.15,1.24),0x638fa9,x,h+.22,z);
      for(let level=0;level<3;level++)for(const side of [-.26,.26])this.mesh(new T.BoxGeometry(.22,.22,.03),0x476c90,x+side,.5+level*.65,z+.585);
    }
    for(let i=0;i<65;i++){
      const angle=i*2.39996,r=6+Math.sqrt(i/65)*13,x=Math.cos(angle)*r,z=Math.sin(angle)*r;
      if(!clear(x,z,2.7)||Math.abs(x+7)<2.4)continue;
      this.mesh(new T.CylinderGeometry(.08,.12,.65,7),0x976442,x,.47,z);
      if(i%3===0){this.mesh(new T.ConeGeometry(.6,1.3,8),0x319450,x,1.05,z);this.mesh(new T.ConeGeometry(.45,1,8),0x4daa59,x,1.65,z);}
      else this.mesh(new T.SphereGeometry(.55,12,8),i%7===0?0xf0afbf:0x64af42,x,1.18,z);
    }
    const goal=this.route.point(this.goal);
    for(const off of [-1.45,1.45])this.mesh(new T.CylinderGeometry(.12,.12,2.5,12),0xd85b55,goal.x+off,1.45,goal.z);
    this.mesh(new T.BoxGeometry(3.4,.24,.3),0xf8db6d,goal.x,2.7,goal.z);
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
    const T=this.T;this.mesh(new T.BoxGeometry(3.2,.22,3.2),0x8eaa9a,-15,.35,9.7);
    this.dice=new T.Mesh(new T.BoxGeometry(1.05,1.05,1.05),[3,4,1,6,2,5].map(n=>this.diceTexture(n)));this.dice.position.set(-15,1.05,9.7);this.dice.castShadow=true;this.world.add(this.dice);this.rollAt=0;this.die=1;this.setDice(1);
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
  point(actor,cell) { const p=this.route.point(cell),v=this.route.tangent(cell),lane=lanes[actor.index%5],off=[lane[0],lane[1]*35/this.goal];return new this.T.Vector3(p.x+v.z*off[0]+v.x*off[1],.25,p.z-v.x*off[0]+v.z*off[1]); }
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
        actor.mesh.position.copy(this.point(actor,hop.from+(hop.to-hop.from)*smooth));actor.mesh.position.y+=Math.sin(t*Math.PI)*.18;
        const direction=this.route.tangent(hop.from+(hop.to-hop.from)*smooth);actor.mesh.rotation.y=Math.atan2(direction.x,direction.z);
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
  reset() {this.yaw=.72;this.elevation=.95;this.distance=innerWidth<600?65:54;}
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
