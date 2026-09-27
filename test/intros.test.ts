import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { introOf, introUrl, recordIntro } from '../src/services/intros.js';
import { makeDb } from './helpers.js';

const M = '880000000000000001';
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

describe('自己紹介の記録', () => {
  it('いちばん新しい書き込みを覚える（古いもので上書きしない）。本文は 300 文字まで', async () => {
    await recordIntro(db, { memberId: M, channelId: 'c1', messageId: 'm2', content: '新しい', postedAt: new Date('2026-09-02') });
    await recordIntro(db, { memberId: M, channelId: 'c1', messageId: 'm1', content: '古い', postedAt: new Date('2026-09-01') });
    expect(await introOf(db, M)).toMatchObject({ messageId: 'm2', excerpt: '新しい' });
    await recordIntro(db, { memberId: M, channelId: 'c2', messageId: 'm3', content: 'あ'.repeat(400), postedAt: new Date('2026-09-03') });
    const i = (await introOf(db, M))!;
    expect(i.excerpt).toHaveLength(300);
    expect(introUrl('g', i)).toBe('https://discord.com/channels/g/c2/m3');
  });
});
