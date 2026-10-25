import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ChannelType,MessageFlags} from 'discord.js';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {InviteLinkApp} from '../src/discord/inviteLinks.js';
import {panelMessage} from '../src/discord/panels.js';
import {commandDefinitions} from '../src/discord/commands.js';
import {activeLinkOf} from '../src/services/invites.js';
const A='840000000000000001',B='840000000000000002',ENTRANCE='840000000000000003';
let db:Db,close:()=>Promise<void>,app:InviteLinkApp;
let links:Map<string,{code:string;uses:number}>,channel:any,guild:any;
beforeEach(async()=>{
 ({db,close}=await makeDb());links=new Map();
 channel={id:ENTRANCE,type:ChannelType.GuildText,fetchInvites:vi.fn(async()=>links),createInvite:vi.fn(async()=>{const value={code:'invite'+(links.size+1),uses:0};links.set(value.code,value);return value;})};
 guild={id:cfg.guildId,channels:{cache:new Map([[ENTRANCE,channel]])}};
 app=new InviteLinkApp(db,()=>({...cfg,channels:{...cfg.channels,entrance:ENTRANCE}}));
});
afterEach(async()=>close());
function press(id=A,roles:string[]=[ROLE.sanpaisha],command=false){const i = {
 user:{id},member:{displayName:'参拝者',roles:{cache:new Map(roles.map(r=>[r,{}]))}},guild,guildId:cfg.guildId,
 inCachedGuild:()=>true,isButton:()=>!command,isChatInputCommand:()=>command,isRepliable:()=>true,
 customId:'invite:link',commandName:'invite',deferred:false,replied:false,
 reply:vi.fn().mockResolvedValue(undefined),deferReply:vi.fn(),editReply:vi.fn().mockResolvedValue(undefined),followUp:vi.fn().mockResolvedValue(undefined),update:vi.fn(),deferUpdate:vi.fn(),
};i.deferReply.mockImplementation(async()=>{i.deferred=true;});return i;}
it('有効な発行ボタンと、神職向けのパネル設置コマンドを定義する',()=>{
 const p=panelMessage('invite');expect(p.components[0]!.components[0]).toMatchObject({label:'招待リンク発行',custom_id:'invite:link',style:1});
 expect(JSON.stringify(p)).not.toContain('"disabled":true');
 const cmd=commandDefinitions(cfg).find(c=>c.name==='panel')!;expect(cmd.options?.find(o=>o.name==='invite')?.name_localizations?.ja).toBe('招待リンク');
});
it('押した本人だけに専用リンクを表示し、共有パネルは書き換えない',async()=>{
 const i=press();await app.onInteraction(i as never);
 expect(i.deferReply).toHaveBeenCalledWith({flags:MessageFlags.Ephemeral});expect(i.update).not.toHaveBeenCalled();expect(i.deferUpdate).not.toHaveBeenCalled();
 expect(i.editReply).toHaveBeenCalledWith(expect.objectContaining({content:expect.stringContaining('https://discord.gg/invite1'),allowedMentions:{parse:[]}}));
 expect(i.followUp).toHaveBeenCalledWith({content:'https://discord.gg/invite1',allowedMentions:{parse:[]},flags:MessageFlags.Ephemeral});
 expect(await activeLinkOf(db,A)).toMatchObject({code:'invite1',inviterId:A,channelId:ENTRANCE});
});
it('ボタン連打とコマンドの同時操作でも発行は1回。再確認は既存リンクを使う',async()=>{
 await Promise.all([app.onInteraction(press() as never),app.onInteraction(press() as never),app.onInteraction(press(A,[ROLE.sanpaisha],true) as never)]);
 expect(channel.createInvite).toHaveBeenCalledTimes(1);
 const i=press();await app.onInteraction(i as never);expect(channel.createInvite).toHaveBeenCalledTimes(1);
 expect(i.editReply.mock.calls[0]![0].content).toContain('invite1');
});
it('人ごとにリンクを分け、削除されたリンクは再発行する',async()=>{
 await app.onInteraction(press() as never);await app.onInteraction(press(B) as never);
 expect((await activeLinkOf(db,B))!.code).not.toBe((await activeLinkOf(db,A))!.code);
 links.clear();const i=press();await app.onInteraction(i as never);expect(channel.createInvite).toHaveBeenCalledTimes(3);
});
it('参拝者未満・別サーバー・無関係なボタンは発行できない。運営は利用可',async()=>{
 const guest=press(A,[]);await app.onInteraction(guest as never);expect(guest.reply.mock.calls[0]![0].content).toContain('参拝者');
 await app.onInteraction({...press(),guildId:'other'} as never);await app.onInteraction({...press(),customId:'unknown'} as never);
 expect(channel.createInvite).not.toHaveBeenCalled();await app.onInteraction(press(A,[ROLE.shinshoku]) as never);expect(channel.createInvite).toHaveBeenCalledTimes(1);
});
it('発行エラー後も再試行でき、入口なしでは案内だけ返す',async()=>{
 channel.createInvite.mockRejectedValueOnce(Error('Missing Permissions'));
 const bad=press();await app.onInteraction(bad as never);expect(bad.editReply.mock.calls[0]![0].content).toContain('招待リンクを作れませんでした');
 expect(await activeLinkOf(db,A)).toBeUndefined();await app.onInteraction(press() as never);expect(await activeLinkOf(db,A)).toBeDefined();
 guild.channels.cache={get:()=>undefined,find:()=>undefined};const missing=press(B);await app.onInteraction(missing as never);
 expect(missing.reply.mock.calls[0]![0].content).toContain('入口のチャンネル');
});
