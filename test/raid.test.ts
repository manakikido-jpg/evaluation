import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { SecurityApp } from '../src/discord/security.js';
import { listAudit } from '../src/services/audit.js';
import { endRaid, isNewAccount, JoinCounter, raidState, startRaid } from '../src/services/raid.js';
import { cfg, makeDb } from './helpers.js';

describe('🚨 レイド検知', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
  });
  afterEach(async () => {
    await close();
  });

  it('窓の中の人数を数える・新しいアカウント', () => {
    const j = new JoinCounter();
    expect(j.add(0, 60_000)).toBe(1);
    expect(j.add(30_000, 60_000)).toBe(2);
    expect(j.add(80_000, 60_000)).toBe(2);
    expect(j.add(130_000, 60_000)).toBe(2);
    const now = new Date('2026-10-14T00:00:00Z');
    expect(isNewAccount(new Date('2026-10-10T00:00:00Z'), 7, now)).toBe(true);
    expect(isNewAccount(new Date('2026-09-01T00:00:00Z'), 7, now)).toBe(false);
    expect(isNewAccount(new Date('2026-10-10T00:00:00Z'), 0, now)).toBe(false);
  });

  it('警戒モードを始める・時間で終わる・早めに終える', async () => {
    const t = new Date('2026-10-14T00:00:00Z');
    expect(await raidState(db, t)).toBeNull();
    await startRaid(db, 'x', 60, t);
    expect(await raidState(db, new Date(t.getTime() + 30 * 60_000))).toMatchObject({ by: 'x' });
    expect(await raidState(db, new Date(t.getTime() + 61 * 60_000))).toBeNull();
    await endRaid(db, 'y', new Date(t.getTime() + 60_000));
    expect(await raidState(db, new Date(t.getTime() + 2 * 60_000))).toBeNull();
  });

  it('短い時間にたくさん入ると警戒モードにして 1 回だけ知らせる。新しいアカウントも知らせる', async () => {
    const c: GuildConfig = { ...cfg, channels: { ...cfg.channels, log: '790000000000000900' }, security: { ...cfg.security, raidJoins: 3, raidMinutes: 5, newAccountDays: 7 } };
    const sent: string[] = [];
    const app = new SecurityApp(db, () => c, { sendMessage: async (_ch: string, b: { content?: string }) => (sent.push(b.content ?? ''), { id: '1' }) });
    const t = Date.now();
    const member = (n: number, created: Date) => ({ id: `79000000000000100${n}`, guild: { id: c.guildId }, user: { bot: false, username: `u${n}`, createdAt: created } });
    const old = new Date(t - 400 * 86_400_000);
    await app.onMemberAdd(member(1, old) as never, new Date(t));
    await app.onMemberAdd(member(2, old) as never, new Date(t + 1000));
    expect(sent).toHaveLength(0);
    await app.onMemberAdd(member(3, old) as never, new Date(t + 2000));
    expect(sent[0]).toContain('警戒モードにしました');
    expect(await raidState(db, new Date(t + 3000))).not.toBeNull();
    await app.onMemberAdd(member(4, old) as never, new Date(t + 3000));
    expect(sent.filter((s) => s.includes('警戒モード'))).toHaveLength(1);
    expect((await listAudit(db, { action: 'security.raid_start' })).length).toBe(1);
    // 作って 2 日のアカウント
    await app.onMemberAdd(member(5, new Date(t - 2 * 86_400_000)) as never, new Date(t + 4000));
    expect(sent.at(-1)).toContain('新しいアカウント');
    expect(sent.at(-1)).toContain('2 日');
  });
});
