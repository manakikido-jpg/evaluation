import { randomInt } from 'node:crypto';
import { TOPIC_CATEGORIES, type TopicCategory } from './talkTopics.js';

export type TopicDraw = { category: TopicCategory; seed: number; step: number };

/** seed と何番目かをボタンに持たせるので、再起動しても一巡の順番を保てる。 */
export function topicDeck(category: TopicCategory, seed: number): number[] {
  const deck = TOPIC_CATEGORIES[category].topics.map((_, i) => i);
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let n = state;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}
export const topicIndex = (draw: TopicDraw): number => topicDeck(draw.category, draw.seed)[draw.step]!;
export function startTopicDraw(category: TopicCategory, previous?: number, seed = randomInt(0x100000000)): TopicDraw {
  // 一巡の境界でも直前と同じお題にしない。ランダム値の再抽選ループは不要。
  let next = seed >>> 0;
  while (previous !== undefined && topicDeck(category, next)[0] === previous) next = (next + 1) >>> 0;
  return { category, seed: next, step: 0 };
}
export function nextTopicDraw(draw: TopicDraw): TopicDraw {
  if (draw.step + 1 < TOPIC_CATEGORIES[draw.category].topics.length) return { ...draw, step: draw.step + 1 };
  return startTopicDraw(draw.category, topicIndex(draw));
}
