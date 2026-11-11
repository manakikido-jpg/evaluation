/** 神符合戦のUI確認専用。架空会員とメモリDBだけを使い、127.0.0.1で公開する。 */
import {createServer} from 'node:http';
import {makeDb,cfg,ROLE} from '../../test/helpers.js';
import {createWebApp} from '../../src/web/app.js';
import {createMemberSession} from '../../src/web/memberSessions.js';
const baseUrl='http://127.0.0.1:4211';
const now=new Date();
const {db}=await makeDb();
const tokens=await Promise.all(['1','2'].map((n)=>createMemberSession(db,{
  id:`76000000000000000${n}`,username:`fixture${n}`,
  displayName:n==='1'?'確認用メンバー':'確認用の相手',avatarUrl:null,
},now)));
// この確認プロセスだけ、最初の山札の並びを固定して再現できるようにする。
let seed=20261111;
const originalRandom=Math.random;
Math.random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
const app=createWebApp({db,cfg:()=>cfg,api:{memberRoles:async()=>[ROLE.guji]} as never,
  discord:{} as never,baseUrl,now:()=>now});
Math.random=originalRandom;
createServer(async(req,res)=>{
  try {
    const url=new URL(req.url!,baseUrl);
    if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    if(['/fixture/session','/fixture/session-other'].includes(url.pathname)){
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({token:tokens[url.pathname.endsWith('-other')?1:0]}));return;
    }
    const parts:Buffer[]=[];
    for await(const part of req)parts.push(Buffer.from(part));
    const response=await app.fetch(new Request(url,{method:req.method,headers:req.headers as HeadersInit,
      body:parts.length?Buffer.concat(parts):undefined}));
    res.statusCode=response.status;
    response.headers.forEach((value,key)=>{if(key!=='set-cookie')res.setHeader(key,value);});
    const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){res.writeHead(500).end(String(error));}
}).listen(4211,'127.0.0.1',()=>console.log('神符合戦のローカル確認用。架空会員・本番DB/Discord接続なし。'));
