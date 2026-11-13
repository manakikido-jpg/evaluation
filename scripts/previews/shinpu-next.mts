/** 保存/復帰/防御/結果/演出のローカル確認専用。架空会員とメモリDBのみ。 */
import {createServer} from 'node:http';
import {eq} from 'drizzle-orm';
import {makeDb,cfg,ROLE} from '../../test/helpers.js';
import {createWebApp} from '../../src/web/app.js';
import {createMemberSession} from '../../src/web/memberSessions.js';
import {shinpuSavedRooms} from '../../src/db/schema.js';
import {playableCards} from '../../src/services/shinpu/engine.js';
const baseUrl='http://127.0.0.1:4213',now=new Date();
const {db}=await makeDb();
const tokens=await Promise.all(['1','2'].map(n=>createMemberSession(db,{id:`76000000000000000${n}`,username:'fixture'+n,displayName:n==='1'?'確認用のあおい':'確認用のこはく',avatarUrl:null},now)));
Math.random=()=>0;
const deps={db,cfg:()=>cfg,api:{memberRoles:async()=>[ROLE.guji]} as never,discord:{} as never,baseUrl,now:()=>now};
let app=createWebApp(deps);
createServer(async(req,res)=>{try{
 const url=new URL(req.url!,baseUrl);
 if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 if(url.pathname==='/fixture/session'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({tokens,now:+now}));return;}
 if(url.pathname==='/fixture/reset'&&req.method==='POST'){await db.delete(shinpuSavedRooms);res.writeHead(200).end('reset');return;}
 if(url.pathname==='/fixture/restart'&&req.method==='POST'){app=createWebApp(deps);res.writeHead(200).end('restarted');return;}
 if(['/fixture/guard','/fixture/finish-ready'].includes(url.pathname)&&req.method==='POST'){
  const id=url.searchParams.get('room')!;const [row]=await db.select().from(shinpuSavedRooms).where(eq(shinpuSavedRooms.id,id));if(!row?.snapshot.state)throw Error('fixture room missing');
  const room=row.snapshot,s=room.state!;
  if(url.pathname==='/fixture/guard'){
   const card={...playableCards.find(c=>c.id==='SK-111')!,uid:++s.seq};s.players[1]!.hand.push(card);
  }else{
   s.players[1]!.hp=1;
   const card=s.discard.find(c=>c.id==='SK-004');if(!card)throw Error('fixture attack not in discard');s.discard=s.discard.filter(c=>c.uid!==card.uid);s.players[0]!.hand.push(card);
  }
  room.revision++;await db.update(shinpuSavedRooms).set({snapshot:room,revision:room.revision}).where(eq(shinpuSavedRooms.id,id));res.writeHead(200).end('prepared');return;
 }
 const parts:Buffer[]=[];for await(const p of req)parts.push(Buffer.from(p));const response=await app.fetch(new Request(url,{method:req.method,headers:req.headers as HeadersInit,body:parts.length?Buffer.concat(parts):undefined}));
 res.statusCode=response.status;response.headers.forEach((v,k)=>{if(k!=='set-cookie')res.setHeader(k,v);});const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);res.end(Buffer.from(await response.arrayBuffer()));
}catch(e){console.error(e);res.writeHead(500).end('local fixture failed');}}).listen(4213,'127.0.0.1',()=>console.log('神符合戦の4項目確認用localhost:4213。実Discord・本番DB未接続。'));
