import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions, MessageBody, MessageFile } from '../lib/discordRest.js';
import { toneOf } from '../omikujiTexts.js';
import { omikujiReward, omikujiSayings, specialFortune } from './omikuji.js';
import { loadOmikujiArt, loadSlipBg } from './omikujiArt.js';
import { joinSideBySide } from './imageJoin.js';
import { renderSlip } from './omikujiSlip.js';

/**
 * 🧪 運営吉を試しに出す（社務所Web から）。運営のチャンネル（呼び鈴の知らせ先か #記録）に、
 * 本番と同じ流れ（ガラガラ → 光る → 絵 → 絵と紙）で出す。くじは引かない・銭は動かない・#慶事 には出さない
 */

/** 演出の待ち時間（ミリ秒。本番と同じ。テストでは 0 にする） */
export const TRIAL_MS = { shake: 1400, glow: 1800, art: 2800 };
const sleep = (ms: number) => (ms > 0 ? new Promise((res) => setTimeout(res, ms)) : Promise.resolve());

/** 試しを出すチャンネル（なければ undefined） */
export const trialChannel = (cfg: Pick<GuildConfig, 'bell' | 'channels'>) => cfg.bell.channelId ?? cfg.channels.log;

/**
 * n 枠目の運営吉を試しに出す。出す前に分かる失敗（枠に名前がない・チャンネルがない）は文字で返し、
 * 演出そのものは待たずに後ろで進める（done で終わりを待てる）
 */
export async function trialUnei(
  db: Db,
  discord: Pick<DiscordActions, 'sendMessage' | 'editMessage'>,
  cfg: GuildConfig,
  n: number,
  by: string,
  now = new Date(),
): Promise<{ ok: true; channelId: string; done: Promise<void> } | { ok: false; reason: 'no_slot' | 'no_channel' }> {
  const fortune = specialFortune(cfg.omikujiSpecial, n);
  if (!fortune) return { ok: false, reason: 'no_slot' };
  const channelId = trialChannel(cfg);
  if (!channelId) return { ok: false, reason: 'no_channel' };
  const texts = cfg.omikujiTexts;
  const amount = omikujiReward(cfg.economy, fortune);
  const [art, bg] = await Promise.all([loadOmikujiArt(db, n), loadSlipBg(db, fortune.key)]);
  const slip: MessageFile = {
    name: 'omikuji.png',
    contentType: 'image/png',
    data: renderSlip({
      name: fortune.name,
      color: `#${fortune.color.toString(16).padStart(6, '0')}`,
      message: fortune.message,
      items: omikujiSayings(texts, fortune.key).map((s) => ({ label: s.label, text: s.text })),
      shrine: texts.shrine,
      date: now,
      special: true,
      tone: toneOf('daikichi'),
      foot: [...(amount > 0 ? [`${cfg.economy.currencyName} +${amount.toLocaleString('ja-JP')}（いま 1,000 枚）`] : []), '連続 3 日目・あと 4 日でおまけ'],
      ...(bg ? { bg } : {}),
    }),
  };
  const artFile: MessageFile | undefined = art && { name: art.name, contentType: art.contentType, data: art.data };
  const note = `-# 🧪 運営吉の試し（<@${by}> が社務所Web から。くじは引いていません・銭は動きません）`;
  const head = { title: '⛩ おみくじ', color: 0x8b5a2b };
  const msg = await discord.sendMessage(channelId, { content: note, embeds: [{ ...head, description: '🎋 **（試し）** さんが御神籤を振っています……\nガラガラ……' }] });
  const done = (async () => {
    const edit = (body: MessageBody) => discord.editMessage(channelId, msg.id, { content: note, ...body });
    await sleep(TRIAL_MS.shake);
    await edit({ embeds: [{ ...head, description: '⚡ ……！？\n**御神籤が金色に光りだした……！**', color: 0xffd700 }] });
    await sleep(TRIAL_MS.glow);
    // 写真だけ（カードにしない）。絵を大きく → 絵と紙の 2 枚（横に並ぶ）
    if (artFile) {
      await edit({ embeds: [], files: [artFile] });
      await sleep(TRIAL_MS.art);
      // 絵（左）と紙（右）を 1 枚に（2 枚のままだと Discord が上下を切る）
      const joined = await joinSideBySide([artFile.data, slip.data]).catch(() => undefined);
      await edit({ embeds: [], files: joined ? [{ name: 'omikuji.png', contentType: 'image/png', data: joined }] : [artFile, slip] });
    } else await edit({ embeds: [], files: [slip] });
  })();
  return { ok: true, channelId, done };
}
