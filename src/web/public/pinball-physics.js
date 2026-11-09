// 無料練習専用の物理。得点をサーバーへ送らず、銭・戦績には使わない。
(() => {
 const W=480,H=720,R=8,GRAVITY=780;
 const POCKETS=[1000,500,200,100,50,50,100,200,500,1000];
 const BUMPERS=[{x:150,y:215,r:27},{x:330,y:215,r:27},{x:240,y:310,r:30}];
 const TARGETS=Array.from({length:5},(_,i)=>({x:140+i*50,y:100-Math.sin(i/4*Math.PI)*25,r:11}));
 const WALLS=[[35,120,35,470],[35,470,75,555],[75,555,130,610],[445,100,445,700],[45,115,80,50],[80,50,390,35],[390,35,445,100],[425,170,425,700],[405,185,395,470],[395,470,355,555],[355,555,350,610]];
 const SLINGS=[[74,470,119,550],[406,470,361,550]];
 const PEGS=Array.from({length:9},(_,row)=>Array.from({length:row%2?10:9},(_,i)=>({x:(row%2?60:80)+i*40,y:160+row*46,r:6}))).flat();
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function random(s){let n=s.seed|0;n^=n<<13;n^=n>>>17;n^=n<<5;s.seed=n>>>0;return s.seed/4294967296;}
 function create(mode='flipper',seed=1){return {mode:mode==='plinko'?'plinko':'flipper',seed:(seed>>>0)||1,phase:'ready',score:0,used:0,total:mode==='plinko'?5:3,time:0,age:0,ball:null,angles:[.3,.3],targets:[false,false,false,false,false],cooldown:{},history:[],notice:mode==='plinko'?'落とす位置を選んで、玉を落とそう。':'発射して、左右のフリッパーで玉を打ち返そう。'};}
 function launch(s,setting=80){
  if(s.phase!=='ready')return false;
  const value=Number.isFinite(setting)?setting:80;
  s.used++;s.phase='playing';s.age=0;
  s.ball=s.mode==='plinko'?{x:clamp(value,48,432),y:82,vx:(random(s)-.5)*32,vy:20}:{x:435,y:655,vx:0,vy:-(950+clamp(value,0,100)*3)};
  s.notice=s.mode==='plinko'?'玉が落下中。入ったポケットの練習点が加わります。':'左右で打ち返そう。中央に落ちると次の球です。';return true;
 }
 function endBall(s,points){
  if(s.mode==='plinko'){s.score+=points;s.history.push(points);s.notice=points+'点のポケット！';}else s.notice='玉が落ちました。';
  s.ball=null;s.phase=s.used>=s.total?'over':'ready';
  s.notice+=s.phase==='over'?' 今回の合計は'+s.score.toLocaleString('ja-JP')+'点。':' 次の球をどうぞ。';
 }
 function circle(s,x,y,r,restitution=.8,boost=0){
  const b=s.ball,dx=b.x-x,dy=b.y-y,d=Math.hypot(dx,dy),limit=R+r;if(d>=limit)return false;
  let nx=d>1e-6?dx/d:1,ny=d>1e-6?dy/d:0;
  // ピン真上の完全な静止を避ける。練習用の小さなゆらぎ。
  if(s.mode==='plinko'&&Math.abs(dx)<.1&&dy<0){nx=(random(s)<.5?-1:1)*.04;ny=-Math.sqrt(1-nx*nx);}
  b.x=x+nx*(limit+.05);b.y=y+ny*(limit+.05);const inward=b.vx*nx+b.vy*ny;
  if(inward>=0)return false;
  b.vx-=(1+restitution)*inward*nx;b.vy-=(1+restitution)*inward*ny;
  if(boost){b.vx+=nx*boost;b.vy+=ny*boost;}
  return true;
 }
 function segment(s,ax,ay,bx,by,r=0,vx=0,vy=0,restitution=.8){
  const b=s.ball,dx=bx-ax,dy=by-ay,t=clamp(((b.x-ax)*dx+(b.y-ay)*dy)/(dx*dx+dy*dy||1),0,1),x=ax+t*dx,y=ay+t*dy;
  const d=Math.hypot(b.x-x,b.y-y),limit=R+r;if(d>=limit)return false;
  const nx=d>1e-6?(b.x-x)/d:0,ny=d>1e-6?(b.y-y)/d:-1;
  b.x=x+nx*(limit+.03);b.y=y+ny*(limit+.03);const inward=(b.vx-vx*t)*nx+(b.vy-vy*t)*ny;
  if(inward>=0)return false;b.vx-=(1+restitution)*inward*nx;b.vy-=(1+restitution)*inward*ny;return true;
 }
 function flipper(s,i,angle){const sign=i===0?1:-1,x=i===0?130:350,y=610;return {x,y,ex:x+sign*Math.cos(angle)*92,ey:y+Math.sin(angle)*92};}
 function tick(s,dt,input){
  const b=s.ball;if(![b.x,b.y,b.vx,b.vy].every(Number.isFinite)){s.used--;s.ball=null;s.phase='ready';s.notice='玉を戻しました。同じ球をもう一度どうぞ。';return;}
  s.time+=dt;s.age+=dt;b.vy+=GRAVITY*dt;b.vx*=Math.exp(-.06*dt);b.x+=b.vx*dt;b.y+=b.vy*dt;
  if(s.mode==='flipper'){
   for(let i=0;i<2;i++){
    const old=s.angles[i],target=(i===0?input.left:input.right)?-.5:.3;
    const angle=s.angles[i]=old+clamp(target-old,-16*dt,12*dt),f=flipper(s,i,angle),previous=flipper(s,i,old);
    segment(s,f.x,f.y,f.ex,f.ey,10,(f.ex-previous.ex)/dt,(f.ey-previous.ey)/dt,.72);
   }
   for(const wall of WALLS)segment(s,...wall);
   for(const sling of SLINGS)if(segment(s,...sling,5,0,0,1.05))b.vy-=100;
   for(let i=0;i<BUMPERS.length;i++){const c=BUMPERS[i];if(circle(s,c.x,c.y,c.r,.9,160)&&s.time>=(s.cooldown['b'+i]||0)){s.score+=250;s.cooldown['b'+i]=s.time+.18;}}
   for(let i=0;i<TARGETS.length;i++){const c=TARGETS[i];if(circle(s,c.x,c.y,c.r,.9)&&!s.targets[i]){s.targets[i]=true;s.score+=100;if(s.targets.every(Boolean)){s.score+=1000;s.notice='五つの星が点灯！ ボーナス1,000点。';}}}
   if(b.y>H+R||b.x<-R*2||b.x>W+R*2)endBall(s,0);
  }else{
   for(const peg of PEGS)circle(s,peg.x,peg.y,peg.r,.65);
   segment(s,35,65,35,710);segment(s,445,65,445,710);
   for(let i=0;i<=10;i++)segment(s,35+i*41,597,35+i*41,695,2,.0,.0,.45);
   if(b.y>=655){const index=clamp(Math.floor((b.x-35)/41),0,9);s.lastPocket=index;endBall(s,POCKETS[index]);}
  }
  if(s.ball){const speed=Math.hypot(b.vx,b.vy);if(speed>1450){b.vx*=1450/speed;b.vy*=1450/speed;}
   if(![b.x,b.y,b.vx,b.vy].every(Number.isFinite)||s.age>(s.mode==='plinko'?18:120)){
    s.used--;s.ball=null;s.phase='ready';s.notice='玉を戻しました。同じ球をもう一度どうぞ。';
   }
  }
 }
 function step(s,seconds,input={}){
  if(s.phase!=='playing'||!s.ball||!Number.isFinite(seconds)||seconds<=0)return;
  const count=Math.ceil(Math.min(seconds,1/30)/(1/240)),dt=Math.min(seconds,1/30)/count;
  for(let i=0;i<count&&s.phase==='playing';i++)tick(s,dt,input);
 }
 window.PinballPhysics={W,H,R,POCKETS,BUMPERS,TARGETS,WALLS,SLINGS,PEGS,create,launch,step,flipper};
})();
