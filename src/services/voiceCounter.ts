import type { VoiceCounter, VoiceGroup } from '../config.js';
import { groupMembers, type GroupChannel } from './voiceGroups.js';

/** Discord の決まり: チャンネル名は 10 分に 2 回まで。間をあけて書きかえる */
export const VOICE_COUNTER_INTERVAL_MS = 5 * 60_000;

/** 名前に match の言葉がある「自動で増える通話」の仲間に、いまいる人（BOT は数えない）の合計 */
export function countInGroups(channels: GroupChannel[], groups: readonly VoiceGroup[], match: string): number {
  const seen = new Set<string>();
  let n = 0;
  for (const g of groups) {
    if (!g.name.includes(match)) continue;
    for (const c of groupMembers(channels, g)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      n += c.members;
    }
  }
  return n;
}

/** チャンネル名（{n} を人数に。Discord の名前の長さ 100 文字まで） */
export const counterName = (vc: Pick<VoiceCounter, 'name'>, n: number) => vc.name.replaceAll('{n}', String(n)).slice(0, 100);
