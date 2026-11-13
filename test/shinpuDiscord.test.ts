import { expect, it, vi } from 'vitest';
import { MessageFlags, type Interaction } from 'discord.js';
import { CasinoApp, shinpuTestReply } from '../src/discord/casino.js';
import { commandDefinitions } from '../src/discord/commands.js';
import {changeBetaTester} from '../src/services/shinpu/beta.js';
import {memberLoginLinks,coinTx} from '../src/db/schema.js';
import { cfg, ROLE, makeDb } from './helpers.js';
function command(roles: string[], id = '760000000000000002') {
  return {
    isChatInputCommand: () => true,
    commandName: 'shinpu',
    inCachedGuild: () => true,
    guildId: cfg.guildId,
    user: {id},
    member: {id,displayName:'β確認用',displayAvatarURL:()=>null,roles: { cache: new Map(roles.map((r) => [r, {}])) } },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}
it('一般メンバーにはリンクを発行せず、本人だけに拒否を返す', async () => {
  const i = command([ROLE.sanpaisha]);
  await new CasinoApp(() => cfg, 'https://test.example').onInteraction(i as unknown as Interaction);
  expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }));
  expect(i.deferReply).not.toHaveBeenCalled();
});
it('運営には先に本人だけの返事を確保して認証ボタンを返す', async () => {
  const i = command([ROLE.shinshoku]);
  await new CasinoApp(() => cfg, 'https://test.example').onInteraction(i as unknown as Interaction);
  expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  expect(i.editReply).toHaveBeenCalled();
  expect(i.reply).not.toHaveBeenCalled();
});
it('BOTのリンクはテスト専用の道で、通知メンションをしない', () => {
  const p = shinpuTestReply('https://test.example', 'test-token');
  expect(p.allowedMentions.parse).toEqual([]);
  expect(p.components![0]!.toJSON().components[0]).toMatchObject({
    label: '無料βに入る',
    url: 'https://test.example/casino/shinpu/link/test-token',
  });
});
it('日本語のスラッシュコマンドにテスト入口を登録する', () => {
  const cmd = commandDefinitions(cfg).find((c) => c.name === 'shinpu');
  expect(cmd?.name_localizations?.ja).toBe('神符合戦');
  expect(cmd?.default_member_permissions).toBeNull();
});
it('招待した一般メンバーにだけ本人用リンクを発行し、実際の銭を動かさない',async()=>{
 const {db,close}=await makeDb(),id='760000000000000002';
 try{
  const app=new CasinoApp(()=>cfg,'https://test.example',db),denied=command([ROLE.sanpaisha],id);
  await app.onInteraction(denied as unknown as Interaction);expect(denied.editReply).toHaveBeenCalledWith(expect.objectContaining({content:expect.stringContaining('招待制')}));expect(await db.select().from(memberLoginLinks)).toHaveLength(0);
  await changeBetaTester(db,{guildId:cfg.guildId,userId:id,actorId:'760000000000000001',add:true});
  const allowed=command([ROLE.sanpaisha],id);await app.onInteraction(allowed as unknown as Interaction);
  const response=allowed.editReply.mock.calls[0]![0];expect(response.content).toContain('招待制無料β');expect(response.allowedMentions.parse).toEqual([]);expect(response.components[0].toJSON().components[0].url).toContain('/casino/shinpu/link/');
  expect(await db.select().from(memberLoginLinks)).toMatchObject([{userId:id}]);expect(await db.select().from(coinTx)).toHaveLength(0);
  await changeBetaTester(db,{guildId:cfg.guildId,userId:id,actorId:'760000000000000001',add:false});const revoked=command([ROLE.sanpaisha],id);await app.onInteraction(revoked as unknown as Interaction);
  expect(revoked.editReply.mock.calls[0]![0].components).toBeUndefined();expect(await db.select().from(memberLoginLinks)).toHaveLength(1);
 }finally{await close();}
});
