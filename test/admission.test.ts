import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { getOmairi, pendingApplications } from '../src/services/applications.js';
import { listAudit } from '../src/services/audit.js';
import {
  changeAgeGroup,
  checkOmairi,
  decide,
  decideOmairi,
  removeYoimairi,
  replySoudan,
  revealSoudanSender,
  submitJoin,
  submitYoimairi,
} from '../src/services/admission.js';
import { getMember, recordJoin, upsertMember } from '../src/services/members.js';
import type { Actor, ModCtx } from '../src/services/moderation.js';
import { appendFromSender, createSoudan, listSoudan, soudanMessagesOf } from '../src/services/soudan.js';
import { applyOverrides, ConfigStore, loadOverrides, overridesSchema, saveOverrides } from '../src/services/settings.js';
import { cfg as baseCfg, makeDb, ROLE } from './helpers.js';

const YOI = '100000000000000011';
const cfg: GuildConfig = { ...baseCfg, roles: { ...baseCfg.roles, yoimairi: YOI } };

const STAFF = '840000000000000001';
const GUJI = '840000000000000002';
const NEW = '840000000000000010';

let db: Db;
let close: () => Promise<void>;
let calls: string[];
let ctx: ModCtx;
const shinshoku: Actor = { id: STAFF, level: 'shinshoku', via: 'web' };
const guji: Actor = { id: GUJI, level: 'guji', via: 'web' };

const snap = (id: string, roleIds: string[]) => ({ id, username: id, displayName: `n${id.slice(-2)}`, avatarUrl: null, roleIds, isBot: false, joinedAt: null });

beforeEach(async () => {
  ({ db, close } = await makeDb());
  calls = [];
  const discord: DiscordActions = {
    addRole: async (_g, u, r) => void calls.push(`addRole ${u} ${r}`),
    removeRole: async (_g, u, r) => void calls.push(`removeRole ${u} ${r}`),
    sendDm: async (u, c) => (calls.push(`dm ${u} ${c.split('\n')[1] ?? ''}`), true),
    ban: async (_g, u) => void calls.push(`ban ${u}`),
    unban: async () => undefined,
    kick: async (_g, u) => void calls.push(`kick ${u}`),
    editMessage: async () => undefined,
    sendMessage: async () => ({ id: '0' }),
    deleteMessage: async () => undefined,
    guildChannels: async () => [],
    guildRoles: async () => [],
  };
  ctx = { db, cfg, discord };
  await recordJoin(db, snap(STAFF, [ROLE.shinshoku]));
  await recordJoin(db, snap(GUJI, [ROLE.guji]));
  await recordJoin(db, snap(NEW, []));
});
afterEach(async () => {
  await close();
});

const answers = { name: 'さくら', age: 'adult' as const, purpose: 'ゲーム', message: 'よろしく' };
const now = new Date('2026-09-25T00:00:00Z');
const recentAccount = new Date('2026-09-20T00:00:00Z');

describe('入鯖申請', () => {
  it('申請 → 承認で参拝者ロール・年齢区分・お参り期間・歓迎 DM', async () => {
    const r = await submitJoin(ctx, { id: NEW, roleIds: [], accountCreatedAt: recentAccount }, answers, now);
    expect(r.status).toBe('pending');
    expect(await submitJoin(ctx, { id: NEW, roleIds: [], accountCreatedAt: recentAccount }, answers, now)).toEqual({ status: 'duplicate' });
    expect(await pendingApplications(db)).toHaveLength(1);

    const d = await decide(ctx, shinshoku, (r as { id: number }).id, true, '', now);
    expect(d).toMatchObject({ status: 'approved', kind: 'join', dmSent: true });
    expect(calls).toContain(`addRole ${NEW} ${ROLE.sanpaisha}`);
    expect((await getMember(db, NEW))?.ageGroup).toBe('adult');
    const o = await getOmairi(db, NEW);
    expect(o?.status).toBe('ongoing');
    expect(o?.endsAt.getTime()).toBe(now.getTime() + 14 * 86_400_000);
    // 2 回目の判定はできない
    expect(await decide(ctx, shinshoku, (r as { id: number }).id, false)).toEqual({ status: 'already_decided' });
  });

  it('却下すると DM とキック', async () => {
    const r = (await submitJoin(ctx, { id: NEW, roleIds: [], accountCreatedAt: recentAccount }, answers, now)) as { id: number };
    expect(await decide(ctx, shinshoku, r.id, false, '雰囲気が合わない')).toMatchObject({ status: 'rejected' });
    expect(calls.some((c) => c.startsWith(`dm ${NEW}`))).toBe(true);
    expect(calls).toContain(`kick ${NEW}`);
    expect((await listAudit(db, { action: 'application.reject' }))[0]?.detail).toMatchObject({ note: '雰囲気が合わない' });
  });

  it('すでに役職がある人は申請不要', async () => {
    expect(await submitJoin(ctx, { id: NEW, roleIds: [ROLE.ujiko], accountCreatedAt: recentAccount }, answers)).toEqual({ status: 'already_member' });
  });

  it('半自動: アカウントが古ければ自動承認、新しければ待ち', async () => {
    ctx = { ...ctx, cfg: { ...cfg, applications: { ...cfg.applications, autoApproveAccountDays: 30 } } };
    const old = await submitJoin(ctx, { id: NEW, roleIds: [], accountCreatedAt: new Date('2025-01-01T00:00:00Z') }, answers, now);
    expect(old.status).toBe('auto_approved');
    expect((await listAudit(db, { action: 'application.approve' }))[0]).toMatchObject({ actorId: 'system', via: 'system' });

    const other = '840000000000000011';
    await recordJoin(db, snap(other, []));
    expect((await submitJoin(ctx, { id: other, roleIds: [], accountCreatedAt: recentAccount }, answers, now)).status).toBe('pending');
  });
});

describe('宵参り', () => {
  async function approveJoin(age: 'adult' | 'minor') {
    const r = (await submitJoin(ctx, { id: NEW, roleIds: [], accountCreatedAt: recentAccount }, { ...answers, age }, now)) as { id: number };
    await decide(ctx, shinshoku, r.id, true, '', now);
  }

  it('18 歳以上と申告した人だけ申請でき、承認で宵参りロール', async () => {
    await approveJoin('adult');
    const r = await submitYoimairi(ctx, NEW, [ROLE.sanpaisha]);
    expect(r.status).toBe('pending');
    expect(await decide(ctx, shinshoku, (r as { id: number }).id, true)).toMatchObject({ status: 'approved', kind: 'yoimairi' });
    expect(calls).toContain(`addRole ${NEW} ${YOI}`);
    expect(await submitYoimairi(ctx, NEW, [ROLE.sanpaisha, YOI])).toEqual({ status: 'already' });
  });

  it('13〜17 歳と申告した人は申請できない', async () => {
    await approveJoin('minor');
    expect(await submitYoimairi(ctx, NEW, [ROLE.sanpaisha])).toEqual({ status: 'not_adult' });
  });

  it('申請のあと年齢区分が変わったら承認できない', async () => {
    await approveJoin('adult');
    const r = (await submitYoimairi(ctx, NEW, [ROLE.sanpaisha])) as { id: number };
    await changeAgeGroup(ctx, guji, NEW, 'minor');
    expect(await decide(ctx, shinshoku, r.id, true)).toEqual({ status: 'not_adult' });
  });

  it('13〜17 歳と記録された人は、入り直して「18 歳以上」と申告しても 13〜17 歳のまま', async () => {
    await approveJoin('adult');
    await changeAgeGroup(ctx, guji, NEW, 'minor');
    // 退出して入り直し、もう一度申請して承認された
    await approveJoin('adult');
    expect((await getMember(db, NEW))?.ageGroup).toBe('minor');
    expect(await submitYoimairi(ctx, NEW, [ROLE.sanpaisha])).toEqual({ status: 'not_adult' });
  });

  it('宮司はほかの宮司の年齢区分を変えられない', async () => {
    const GUJI2 = '840000000000000003';
    await recordJoin(db, snap(GUJI2, [ROLE.guji]));
    expect(await changeAgeGroup(ctx, guji, GUJI2, 'minor')).toBe('forbidden');
  });

  it('年齢区分の変更は宮司だけ。13〜17 歳にしたら宵参りを外す', async () => {
    await upsertMember(db, snap(NEW, [ROLE.sanpaisha, YOI]));
    expect(await changeAgeGroup(ctx, shinshoku, NEW, 'minor')).toBe('forbidden');
    expect(await changeAgeGroup(ctx, guji, NEW, 'minor')).toBe('ok');
    expect(calls).toContain(`removeRole ${NEW} ${YOI}`);
    expect((await listAudit(db, { action: 'member.age' }))[0]?.detail).toMatchObject({ to: 'minor' });
  });
});

describe('お参り期間', () => {
  const DAY = 86_400_000;
  async function approved() {
    const r = (await submitJoin(ctx, { id: NEW, roleIds: [], accountCreatedAt: recentAccount }, answers, now)) as { id: number };
    await decide(ctx, shinshoku, r.id, true, '', now);
    await upsertMember(db, snap(NEW, [ROLE.sanpaisha]));
  }

  it('期間内は何もしない', async () => {
    await approved();
    expect(await checkOmairi(ctx, new Date(now.getTime() + 13 * DAY))).toEqual({ promoted: [], extended: [], review: [] });
  });

  it('氏子になっていれば完了', async () => {
    await approved();
    await upsertMember(db, snap(NEW, [ROLE.ujiko]));
    expect((await checkOmairi(ctx, new Date(now.getTime() + 15 * DAY))).promoted).toEqual([NEW]);
    expect((await getOmairi(db, NEW))?.status).toBe('promoted');
  });

  it('届かなければ 1 回だけ自動延長、それでも届かなければ神職の判定待ち', async () => {
    await approved();
    const t1 = new Date(now.getTime() + 15 * DAY);
    expect((await checkOmairi(ctx, t1)).extended).toEqual([NEW]);
    expect((await getOmairi(db, NEW))?.endsAt.getTime()).toBe(t1.getTime() + 7 * DAY);
    expect((await checkOmairi(ctx, new Date(t1.getTime() + 6 * DAY))).review).toEqual([]);
    expect((await checkOmairi(ctx, new Date(t1.getTime() + 8 * DAY))).review).toEqual([NEW]);
    expect((await getOmairi(db, NEW))?.status).toBe('review');
    // 判定待ちは、何度チェックしても通知し直さない
    expect((await checkOmairi(ctx, new Date(t1.getTime() + 9 * DAY))).review).toEqual([]);
  });

  it('神職の判定: 氏子にする / 延長 / 退出', async () => {
    await approved();
    expect(await decideOmairi(ctx, shinshoku, NEW, 'promote')).toBe('ok');
    expect(calls).toContain(`addRole ${NEW} ${ROLE.ujiko}`);
    expect(calls).toContain(`removeRole ${NEW} ${ROLE.sanpaisha}`);
    expect(await decideOmairi(ctx, shinshoku, NEW, 'remove')).toBe('not_found');
  });

  it('二重に押しても、退出の DM・キックは 1 回だけ', async () => {
    await approved();
    calls = [];
    const rs = await Promise.all([decideOmairi(ctx, shinshoku, NEW, 'remove'), decideOmairi(ctx, shinshoku, NEW, 'remove')]);
    expect(rs.sort()).toEqual(['not_found', 'ok']);
    expect(calls.filter((c) => c.startsWith('kick'))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith('dm'))).toHaveLength(1);
  });

  it('退出させる', async () => {
    await approved();
    expect(await decideOmairi(ctx, shinshoku, NEW, 'remove')).toBe('ok');
    expect(calls).toContain(`kick ${NEW}`);
    expect((await getOmairi(db, NEW))?.status).toBe('removed');
  });
});

describe('相談', () => {
  it('送った人は神職には見えず、返信は BOT から DM で届く', async () => {
    const id = await createSoudan(db, NEW, '通話で困っています');
    const list = await listSoudan(db);
    expect(list[0]).toMatchObject({ id, status: 'open', firstBody: '通話で困っています', messageCount: 1 });
    expect(JSON.stringify(list)).not.toContain(NEW);

    const r = await replySoudan(ctx, shinshoku, id, 'お話を聞かせてください');
    expect(r).toEqual({ status: 'ok', dmSent: true });
    expect(calls.some((c) => c.startsWith(`dm ${NEW}`))).toBe(true);
    const msgs = await soudanMessagesOf(db, id);
    expect(msgs.map((m) => m.fromRole)).toEqual(['sender', 'staff']);
    expect(JSON.stringify(msgs)).not.toContain(NEW);
    expect((await listSoudan(db))[0]).toMatchObject({ status: 'in_progress', assigneeId: STAFF });
  });

  it('続きは本人しか書き込めない', async () => {
    const id = await createSoudan(db, NEW, 'a');
    expect(await appendFromSender(db, id, STAFF, 'なりすまし')).toBe('not_found');
    expect(await appendFromSender(db, id, NEW, '続き')).toBe('ok');
  });

  it('送った人の確認は宮司だけ・記録に残る', async () => {
    const id = await createSoudan(db, NEW, 'a');
    expect(await revealSoudanSender(ctx, shinshoku, id, '緊急')).toBe('forbidden');
    expect(await revealSoudanSender(ctx, guji, id, '身の危険があるため')).toBe(NEW);
    expect((await listAudit(db, { action: 'soudan.reveal' }))[0]).toMatchObject({ actorId: GUJI, detail: { reason: '身の危険があるため' } });
  });
});

describe('設定', () => {
  it('上書きを保存して読み直すと反映される', async () => {
    const store = new ConfigStore(db, cfg);
    expect(store.current.economy.menzaifuPrice).toBe(300);
    await saveOverrides(db, overridesSchema.parse({ economy: { menzaifuPrice: 500 }, ranks: { ujiko: { requiredGoen: 30 } } }), GUJI);
    await store.refresh();
    expect(store.current.economy.menzaifuPrice).toBe(500);
    expect(store.current.ranks.find((r) => r.key === 'ujiko')?.requiredGoen).toBe(30);
    // ファイルの設定は変わらない
    expect(store.fileConfig.economy.menzaifuPrice).toBe(300);
  });

  it('おかしな組み合わせ（昇格ラインの重複）はエラー', () => {
    expect(() => applyOverrides(cfg, overridesSchema.parse({ ranks: { ujiko: { requiredGoen: 100 } } }))).toThrow();
  });

  it('DB の値が壊れていても、ファイルの設定で動く', async () => {
    await saveOverrides(db, { economy: { menzaifuPrice: -1 } } as never, GUJI);
    expect(await loadOverrides(db)).toEqual(overridesSchema.parse({}));
  });
});

describe('宵参りを外すと、宵宮のお守りも外れる', () => {
  const OMA = '100000000000000021';
  const NEOCHI = '100000000000000022';
  it('宵参りを外す・年齢区分を変える', async () => {
    ctx = {
      ...ctx,
      cfg: {
        ...cfg,
        roles: {
          ...cfg.roles,
          omamori: [
            { roleId: NEOCHI, label: '寝落ち', emoji: '🌙', description: '', adultOnly: false },
            { roleId: OMA, label: '宵宮', emoji: '🔞', description: '', adultOnly: true },
          ],
        },
      },
    };
    await recordJoin(db, snap(NEW, [ROLE.sanpaisha, YOI, OMA, NEOCHI]));
    expect(await removeYoimairi(ctx, shinshoku, NEW, '年齢の確認')).toBe('ok');
    expect(calls).toEqual([`removeRole ${NEW} ${YOI}`, `removeRole ${NEW} ${OMA}`]);

    calls = [];
    expect(await changeAgeGroup(ctx, guji, NEW, 'minor')).toBe('ok');
    expect(calls).toEqual([`removeRole ${NEW} ${YOI}`, `removeRole ${NEW} ${OMA}`]);
  });
});

describe('初期配布', () => {
  it('入鯖を承認すると 1 回だけ配り、DM で知らせる。入り直しても 2 回目はない', async () => {
    const { walletOf } = await import('../src/services/economy.js');
    const join = async () => {
      const r = (await submitJoin(ctx, { id: NEW, roleIds: [], accountCreatedAt: recentAccount }, answers, now)) as { id: number };
      await decide(ctx, shinshoku, r.id, true, '', now);
    };
    await join();
    expect((await walletOf(db, NEW)).balance).toBe(3000);
    expect(calls.find((c) => c.startsWith(`dm ${NEW}`))).toBeDefined();
    await join();
    expect((await walletOf(db, NEW)).balance).toBe(3000);
  });
});

describe('BAN を解除して入り直した人', () => {
  it('厄が残っていれば、入鯖を承認したときに 👹厄年 を付け直す', async () => {
    const { recordYaku } = await import('../src/services/yaku.js');
    await recordYaku(db, { memberId: NEW, reason: '誹謗中傷', issuedBy: STAFF });
    const r = await submitJoin(ctx, { id: NEW, roleIds: [], accountCreatedAt: recentAccount }, answers, now);
    await decide(ctx, shinshoku, (r as { id: number }).id, true, '', now);
    expect(calls).toContain(`addRole ${NEW} ${ROLE.sanpaisha}`);
    expect(calls).toContain(`addRole ${NEW} ${ROLE.yakudoshi}`);
  });
});
