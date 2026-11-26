/** ローカルの架空会員だけで管理画面と会員画面を検査する。実Discordに接続しない。 */
import {createServer} from 'node:http';
import {makeDb,cfg,ROLE} from '../../test/helpers.js';
import {createWebApp} from '../../src/web/app.js';
import {createSession} from '../../src/web/sessions.js';
import {createMemberSession} from '../../src/web/memberSessions.js';
import {recordJoin} from '../../src/services/members.js';
import {registerCast,loadCastConfig} from '../../src/services/cast.js';
import {saveStickerConfig} from '../../src/services/stickers.js';
import {saveUpdatePostConfig} from '../../src/services/updatePosts.js';
import {members,ideas,notices,soudan,updatePosts,marketListings,marketRequests} from '../../src/db/schema.js';
import {eq} from 'drizzle-orm';
const baseUrl='http://127.0.0.1:4215',now=new Date('2026-11-11T03:00:00Z');
const STAFF='770000000000000001',USER='770000000000000002',OTHER='770000000000000003';
const {db}=await makeDb();
for(const [id,name] of [[STAFF,'検証用の運営'],[USER,'同じ名前'],[OTHER,'同じ名前']]){
 await recordJoin(db,{id,username:'fixture'+id,displayName:name,avatarUrl:null,roleIds:id===STAFF?[ROLE.guji]:[ROLE.ujiko],isBot:false,joinedAt:now});
 await db.update(members).set({ageGroup:'adult'}).where(eq(members.id,id));
}
const conf=await loadCastConfig(db);
await registerCast(db,conf,{id:STAFF,adult:true},{bio:'架空の検証用キャスト',tags:['雑談'],minorOk:true},[{name:'雑談',note:'',minutes:30,price:300,night:false}],STAFF,now);
await saveStickerConfig(db,{roleId:ROLE.guji},STAFF);
await saveUpdatePostConfig(db,{roleId:ROLE.guji},STAFF);
await db.insert(ideas).values({title:'架空の改善案',body:'画面検査用です。',createdBy:STAFF,updatedBy:STAFF});
await db.insert(notices).values({channelId:'780000000000000001',position:0,title:'架空のお知らせ',body:'画面検査用です。',updatedBy:STAFF});
await db.insert(soudan).values({status:'open'});
await db.insert(updatePosts).values({authorId:STAFF,authorName:'検証用の運営',title:'架空の下書き',body:'画面検査用です。'});
await db.insert(marketListings).values({sellerId:STAFF,category:'illust',title:'検査用の出品',price:1000});
await db.insert(marketRequests).values({requesterId:STAFF,category:'illust',title:'検査用の募集',budget:1000});
const office=await createSession(db,{id:STAFF,username:'fixture',displayName:'検証用の運営',avatarUrl:null},{level:'guji'},now);
const member=await createMemberSession(db,{id:STAFF,username:'fixture',displayName:'検証用の運営',avatarUrl:null},now);
const sessions=[];
for(const [name,path] of [['sakura_casino','/casino'],['sakura_cast_office','/cast-office'],['sakura_visit','/visit'],['sakura_market','/marketplace'],['sakura_lottery','/lottery'],['sakura_sticker_desk','/sticker-desk'],['sakura_update_desk','/update-desk'],['sakura_mypage','/mypage'],['sakura_shinpu_test','/casino/shinpu']])sessions.push({name,path,value:await createMemberSession(db,{id:STAFF,username:'fixture',displayName:'検証用の運営',avatarUrl:null},now)});
const channels=[{id:'780000000000000001',name:'検証用の案内',type:0,parent_id:null,position:0,permission_overwrites:[]},{id:'780000000000000002',name:'検証用の通話',type:2,parent_id:null,position:1,permission_overwrites:[]}];
const discord=new Proxy({guildChannels:async()=>channels,guildRoles:async()=>[{id:cfg.guildId,name:'@everyone',position:0,color:0,managed:false,permissions:'0'},{id:ROLE.guji,name:'宮司',position:10,color:0,managed:false,permissions:'8'}],sendDm:async()=>true,sendMessage:async()=>({id:'790000000000000001'}),getChannel:async()=>channels[0]}, {get:(o,k)=>k in o?o[k]:async()=>undefined});
const auditCfg={...cfg,channels:{...cfg.channels,market:'780000000000000001'}};
const app=createWebApp({db,cfg:()=>auditCfg,baseUrl,now:()=>now,api:{authorizeUrl:(state,redirect)=>redirect+'?code=fixture&state='+encodeURIComponent(state),exchangeCode:async()=> 'fixture',me:async()=>({id:STAFF,username:'fixture',displayName:'検証用の運営',avatarUrl:null}),memberRoles:async()=>[ROLE.guji]},discord:discord as never});
const previewPaths=['/ideas/1','/notices/1','/notices/1/delete','/soudan/1','/update-desk/edit/1','/marketplace/listings/1','/marketplace/requests/1','/casino/shinpu/cards/SK-001'];
const routes=app.routes.filter(r=>r.method==='GET'&&!r.path.includes('*')).map(r=>r.path);
createServer(async(req,res)=>{try{
 const url=new URL(req.url!,baseUrl);
 if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 if(url.pathname==='/fixture'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({office,member,sessions,routes,previewPaths,now:+now,STAFF,USER,OTHER}));return;}
 const parts:Buffer[]=[];for await(const part of req)parts.push(Buffer.from(part));
 const response=await app.fetch(new Request(url,{method:req.method,headers:req.headers as HeadersInit,body:parts.length?Buffer.concat(parts):undefined}));
 res.statusCode=response.status;response.headers.forEach((v,k)=>{if(k!=='set-cookie')res.setHeader(k,v);});const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){console.error(e);res.writeHead(500).end('ローカル検証でエラー');}
}).listen(4215,'127.0.0.1',()=>console.log('画面検査用 localhost:4215、架空会員のみ。'));
