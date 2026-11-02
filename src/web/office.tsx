import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Hono, Context } from 'hono';
import sharp from 'sharp';
import { WEB_PAGE_KEYS, webAccessEntries, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { officeApp, officeSubscriptions } from '../db/schema.js';
import { parseOfficeGrant } from '../domain/officeAccess.js';
import { audit } from '../services/audit.js';
import { loadOverrides, saveOverrides } from '../services/settings.js';
import { findMemberByNameOrId, namesOf } from '../services/members.js';
import { listAccounts, getAccount, updateAccount } from '../services/webAccounts.js';
import { allowedSignals, ensureOfficeApp, officeSignals, OFFICE_TOPICS, subscribeOffice, unsubscribeOffice } from '../services/officeNotifications.js';
import { recheckAllSessions } from './sessions.js';
import { OfficeAccessPage, OfficeAppPage } from './views/office.js';
import type { SessionView } from './views/layout.js';
import { STATIC } from './assets.js';

type Env = { Variables: { session: SessionView } };
const gujiOnly = (c: Context<Env>) => c.get('session').level === 'guji';
const defaultIcon = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#fae9ef"/><circle cx="256" cy="256" r="175" fill="#fff8fa"/><g fill="#a33659"><path d="M123 161q133 34 266 0l-7 33q-126 30-252 0z"/><rect x="132" y="223" width="248" height="24" rx="8"/><rect x="171" y="188" width="26" height="174" rx="6"/><rect x="315" y="188" width="26" height="174" rx="6"/><rect x="243" y="195" width="26" height="42"/><rect x="154" y="351" width="61" height="18" rx="5"/><rect x="297" y="351" width="61" height="18" rx="5"/></g></svg>');
export async function normalizeOfficeIcon(bytes: Buffer): Promise<string> {
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('size');
  const image = sharp(bytes, { limitInputPixels: 16_000_000 });
  const metadata = await image.metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error('format');
  return (await image.rotate().resize(512, 512, { fit: 'contain', background: '#fae9ef' }).flatten({ background: '#fae9ef' }).png().toBuffer()).toString('base64');
}
export function mountOffice(app: Hono<Env>, deps: { db: Db; cfg: () => GuildConfig; loadRoles: () => Promise<{ id: string; name: string; managed?: boolean }[] | null | undefined>; onSettingsSaved?: () => Promise<void>; now: () => Date }) {
  const { db, now } = deps;
  app.get('/manifest.webmanifest', async c => {
    const [row] = await db.select({ version: officeApp.iconVersion }).from(officeApp).where(eq(officeApp.id, 1));
    const version = row?.version ?? 'default';
    return c.json({ id: '/office/app', name: '咲楽ノ宮 社務所', short_name: '社務所', lang: 'ja', start_url: '/office/app', scope: '/', display: 'standalone', background_color: '#fae9ef', theme_color: '#a33659', icons: [192, 512].map(size => ({ src: `/office-icon/${size}.png?v=${version}`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' })) }, 200, { 'Content-Type': 'application/manifest+json' });
  });
  app.get('/service-worker.js', c => c.body(STATIC['office-sw.js']!.body, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-cache' }));
  app.get('/office-icon/:size', async c => {
    const size = { '192.png': 192, '512.png': 512, '180.png': 180 }[c.req.param('size')];
    if (!size) return c.notFound();
    const [row] = await db.select({ icon: officeApp.icon }).from(officeApp).where(eq(officeApp.id, 1));
    const bytes = await sharp(row?.icon ? Buffer.from(row.icon, 'base64') : defaultIcon).resize(size, size).png().toBuffer();
    return c.body(new Uint8Array(bytes), 200, { 'Content-Type': 'image/png' });
  });
  app.get('/office/app', async c => {
    const s = c.get('session');
    const state = await ensureOfficeApp(db);
    const subscriptions = await db.select({ topics: officeSubscriptions.topics, sessionId: officeSubscriptions.sessionId }).from(officeSubscriptions).where(eq(officeSubscriptions.userId, s.userId));
    const current = subscriptions.find(x => x.sessionId === s.id);
    return c.html(<OfficeAppPage session={s} publicKey={state.publicKey} iconVersion={state.iconVersion} topics={current?.topics ?? OFFICE_TOPICS.map(t => t.key)} signals={allowedSignals(await officeSignals(db, now()), s, OFFICE_TOPICS.map(t => t.key))} flash={c.req.query('msg')} />);
  });
  app.post('/office/push/subscribe', async c => {
    const body = await c.req.parseBody({ all: true });
    const topics = Array.isArray(body.topic) ? body.topic : [body.topic];
    try {
      await subscribeOffice(db, c.get('session'), JSON.parse(String(body.subscription ?? '')), topics.filter((t): t is string => typeof t === 'string'), now());
    } catch { return c.json({ error: '通知を登録できませんでした。対象の選択・対応ブラウザ・端末の登録数（10台まで）を確認してください。' }, 400); }
    await audit(db, { actorId: c.get('session').userId, action: 'office.push_subscribe', via: 'web' });
    return c.json({ ok: true });
  });
  app.post('/office/push/unsubscribe', async c => {
    const body = await c.req.parseBody();
    await unsubscribeOffice(db, c.get('session'), typeof body.endpoint === 'string' ? body.endpoint : undefined);
    await audit(db, { actorId: c.get('session').userId, action: 'office.push_unsubscribe', via: 'web' });
    return c.json({ ok: true });
  });
  app.get('/office/access', async c => {
    if (!gujiOnly(c)) return c.text('宮司のみ開けます。', 403);
    const cfg = deps.cfg();
    const entries = webAccessEntries(cfg);
    const roles = ((await deps.loadRoles()) ?? []).filter(r => r.id !== cfg.guildId && !r.managed);
    const names = await namesOf(db, entries.filter(e => e.kind === 'member').map(e => e.id));
    for (const r of roles) names.set(r.id, r.name);
    return c.html(<OfficeAccessPage session={c.get('session')} entries={entries} accounts={await listAccounts(db)} roles={roles} names={names} flash={c.req.query('msg')} />);
  });
  app.post('/office/access', async c => {
    if (!gujiOnly(c)) return c.text('宮司のみ変更できます。', 403);
    const body = await c.req.parseBody();
    if (body.confirm !== 'yes') return c.redirect('/office/access?msg=invalid');
    const grant = parseOfficeGrant(body);
    const s = c.get('session');
    let target: string;
    if (body.kind === 'account') {
      const id = Number(body.accountId);
      const account = Number.isSafeInteger(id) ? await getAccount(db, id) : undefined;
      if (!account || account.level === 'guji') return c.redirect('/office/access?msg=invalid');
      const result = await updateAccount(db, id, { name: account.name, level: account.level, memberId: account.memberId, ...grant });
      if (result !== 'ok') return c.redirect('/office/access?msg=invalid');
      target = `account:${id}`;
    } else {
      const cfg = deps.cfg();
      const kind = body.kind === 'role' ? 'role' : 'member';
      let id: string | undefined;
      if (kind === 'role') id = (await deps.loadRoles())?.find(r => r.id === body.roleId && r.id !== cfg.guildId && !r.managed)?.id;
      else { const found = await findMemberByNameOrId(db, String(body.member ?? '').slice(0, 100)); if (found && found !== 'ambiguous') id = found.id; }
      if (!id) return c.redirect('/office/access?msg=invalid');
      const saved = await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('office.access'))`);
        const prev = await loadOverrides(tx);
        const entries = webAccessEntries({ ...cfg, webAccess: { ...cfg.webAccess, ...prev.webAccess } }).filter(e => !(e.kind === kind && e.id === id));
        if (entries.length >= 50) return false;
        await saveOverrides(tx, { ...prev, webAccess: { shinshokuRoleIds: [], entries: [...entries, { kind, id: id!, ...grant }] } }, s.userId);
        return true;
      });
      if (!saved) return c.redirect('/office/access?msg=invalid');
      await deps.onSettingsSaved?.();
      target = `${kind}:${id}`;
    }
    await recheckAllSessions(db);
    await audit(db, { actorId: s.userId, action: 'office.access', detail: { target, ...grant }, via: 'web' });
    return c.redirect('/office/access?msg=saved');
  });
  app.post('/office/icon', async c => {
    if (!gujiOnly(c)) return c.text('宮司のみ変更できます。', 403);
    const body = await c.req.parseBody();
    if (!(body.icon instanceof File)) return c.redirect('/office/app?msg=invalid');
    let icon: string;
    try { icon = await normalizeOfficeIcon(Buffer.from(await body.icon.arrayBuffer())); } catch { return c.redirect('/office/app?msg=invalid'); }
    await ensureOfficeApp(db);
    await db.update(officeApp).set({ icon, iconVersion: randomUUID() }).where(eq(officeApp.id, 1));
    await audit(db, { actorId: c.get('session').userId, action: 'office.icon', via: 'web' });
    return c.redirect('/office/app?msg=saved');
  });
  app.post('/office/icon/reset', async c => {
    if (!gujiOnly(c)) return c.text('宮司のみ変更できます。', 403);
    await db.update(officeApp).set({ icon: null, iconVersion: randomUUID() }).where(eq(officeApp.id, 1));
    await audit(db, { actorId: c.get('session').userId, action: 'office.icon_reset', via: 'web' });
    return c.redirect('/office/app?msg=saved');
  });
}
