import type { GuildConfig } from '../config.js';
import type { AdminSession, CasinoTable } from '../db/schema.js';
import { keiba, type KbState } from '../services/casino/tables/keiba.js';
import { seeded } from '../services/casino/keiba.js';
import { keibaBroadcast } from '../services/casino/keibaBroadcast.js';
import { CasinoLayout, type CasinoMe } from './views/casino.js';
import { KeibaView } from './views/keiba.js';
import { KeibaHero, KeibaTheme } from './views/keibaTheme.js';

/** 純粋なエンジンの戻り値だけで作る。DB・実際の銭・馬・会員セッションは使わない。 */
export function KeibaTestPage(p: { session: AdminSession; cfg: GuildConfig; now: Date; phase?: string; follow?: string }) {
  const uid = 'keiba-test-sample', who = { id: uid, name: '試走の馬主' };
  const random = seeded(281026);
  const ctx = { cfg: p.cfg, now: p.now.getTime(), rng: (n: number) => Math.floor(random() * n) };
  const created = keiba.create(who, { dist: '1600', window: '2' }, ctx);
  if (!created.ok) throw Error('競馬の試走を作れませんでした');
  const started = keiba.act(created.state, uid, { action: 'start' }, ctx);
  if (!started.ok) throw Error('競馬の試走を始められませんでした');
  const racing = started.state as KbState;
  const { live: _live, demo: _demo, ...record } = keibaBroadcast(racing, -1, ctx.now)!;
  const data = { ...record, demo: true as const };
  const s = p.phase === 'race' ? racing : created.state as KbState;
  const follow = p.follow === undefined ? 1 : s.horses.some(h => h.no === Number(p.follow)) ? Number(p.follow) : 0;
  const me: CasinoMe = {
    balance: 0, coin: { name: p.cfg.economy.currencyName, emoji: p.cfg.economy.currencyEmoji },
    session: { id: uid, userId: uid, displayName: who.name, avatarUrl: null, csrfToken: '', checkedAt: p.now, expiresAt: p.now, createdAt: p.now },
  };
  const table: CasinoTable = { id: -1, kind: 'keiba', hostId: uid, state: s, seatIds: [uid], status: 'open', version: 0, dueAt: null, createdAt: p.now, updatedAt: p.now };
  return <CasinoLayout title="競馬（運営テスト）" adminPreview>
    <KeibaTheme/><KeibaHero title="競馬・運営テスト" note="社務所の運営専用です。サンプルだけで確認し、実際の銭・馬・戦績は変わりません。"/>
    <p><a href="/economy/casino">← 社務所のカジノ管理へ</a>　確認中：{p.session.username}</p>
    <nav class="kb-theme-nav" aria-label="テストする画面"><a href="/economy/keiba-test" aria-current={p.phase !== 'race' ? 'page' : undefined}>受付・馬券の選択</a><a href={`/economy/keiba-test?phase=race&follow=${follow}`} aria-current={p.phase === 'race' ? 'page' : undefined}>3D映像・カメラ・音</a></nav>
    <p class="c-note">受付では券種・馬・金額を選び、点数と合計を確認できます。購入はできません。映像は「再生」で開始し、ゴール前・画質・自分の馬のカメラを試せます。</p>
    <KeibaView t={table} s={s} me={me} casino={p.cfg.casino} now={ctx.now} seatControls={null} countdown={<span>テスト用・時間制限なし</span>} testData={data} testFollow={follow}/>
  </CasinoLayout>;
}
