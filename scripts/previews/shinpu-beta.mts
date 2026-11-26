/** 招待制βの確認専用。架空の運営・招待者・未招待者、メモリDBだけを使う。 */
import {createServer} from 'node:http';
import {makeDb,cfg,ROLE} from '../../test/helpers.js';
import {createWebApp} from '../../src/web/app.js';
import {createMemberSession} from '../../src/web/memberSessions.js';
import {createSession} from '../../src/web/sessions.js';
const baseUrl='http://127.0.0.1:4212',now=new Date();
const STAFF='760000000000000001',TESTER='760000000000000002',OTHER='760000000000000003';
const {db}=await makeDb();
const user={id:TESTER,username:'beta',displayName:'β確認用メンバー',avatarUrl:null};
const office=await createSession(db,{id:STAFF,username:'fixture',displayName:'確認用の運営',avatarUrl:null},{level:'guji',pages:['economy']},now);
const other=await createMemberSession(db,{id:OTHER,username:'other',displayName:'未招待の確認用',avatarUrl:null},now);
const app=createWebApp({db,cfg:()=>cfg,baseUrl,now:()=>now,
  api:{authorizeUrl:(state)=>baseUrl+'/casino/auth/callback?code=beta&state='+encodeURIComponent(state),exchangeCode:async()=> 'fixture',me:async()=>user,
    memberRoles:async(_guild,id)=>id===STAFF?[ROLE.guji]:[TESTER,OTHER].includes(id)?[ROLE.sanpaisha]:null},
  discord:{guildChannels:async()=>[],guildRoles:async()=>[]} as never});
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url!,baseUrl);
  if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(url.pathname==='/fixture/sessions'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({office,other,now:+now}));return;}
  const parts:Buffer[]=[];for await(const part of req)parts.push(Buffer.from(part));
  const response=await app.fetch(new Request(url,{method:req.method,headers:req.headers as HeadersInit,body:parts.length?Buffer.concat(parts):undefined}));
  res.statusCode=response.status;response.headers.forEach((v,k)=>{if(k!=='set-cookie')res.setHeader(k,v);});
  const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){res.writeHead(500).end(String(error));}
}).listen(4212,'127.0.0.1',()=>console.log('招待制βのローカル確認用。Discord認証は偽物、実残高と実Discordには未接続。'));
