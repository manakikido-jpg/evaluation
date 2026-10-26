import type { AdminSession } from '../../db/schema.js';
import type { GuildChannel } from '../../lib/discordRest.js';
import { ROOM_MODES, fmtSec, type KnockConfig, type KnockState } from '../../services/roomKnock.js';
import { Layout } from './layout.js';

/** 🚪 宿のこんこん（止める・始める、パネルのチャンネル、時間、いまの部屋の受付） */
export function RoomKnockPage(p: { session: AdminSession; config: KnockConfig; channels: GuildChannel[]; rooms: { room: string; state: KnockState }[]; flash?: string; error?: string }) {
  const csrf = <input type="hidden" name="_csrf" value={p.session.csrfToken} />;
  const chName = (id: string) => p.channels.find(c => c.id === id)?.name;
  const now = Date.now();
  const active = p.rooms.filter(r => r.state.mode !== 'open' || (r.state.pending && !r.state.pending.answered && r.state.pending.expires > now));
  return <Layout title="宿のこんこん" nav="roomknock" session={p.session}>
    <h1>🚪 宿のこんこん</h1>
    {p.flash === 'saved' && <p role="status">保存しました。Discord には 1 分以内に反映されます。</p>}
    {p.error && <p class="flash warn" role="alert">{p.error}</p>}
    <p>宿に入る前に、中の人へ「入ってもいい？」と声をかけるしくみです。</p>
    <section class="card"><h2>設定</h2>
      <form method="post" action="/room-knock" class="fields">{csrf}
        <label class="field check"><input type="checkbox" name="enabled" value="yes" checked={p.config.enabled} />こんこんとお部屋案内を使う（外すと、ボタンを押しても「お休み中」と出ます）</label>
        <label class="field"><span>パネルを出すチャンネル</span><select name="channelId"><option value="">自動（「🌸お部屋案内」という名前のチャンネル）</option>{p.config.channelId && !chName(p.config.channelId) && <option value={p.config.channelId} selected>選んだチャンネル（いまは取得できません）</option>}{p.channels.filter(c => c.type === 0).map(c => <option value={c.id} selected={p.config.channelId === c.id}>#{c.name}</option>)}</select></label>
        <label class="field"><span>同じ人が同じ部屋にこんこんできる間かく（秒・30〜3600）</span><input type="number" name="cooldownSec" value={p.config.cooldownSec} min={30} max={3600} required /></label>
        <label class="field"><span>こんこんの受付時間（秒・30〜3600）</span><input type="number" name="windowSec" value={p.config.windowSec} min={30} max={3600} required /></label>
        <button type="submit">保存する</button>
      </form>
      <p class="note">いま：{p.config.enabled ? '使う' : 'お休み'} ／ 間かく {fmtSec(p.config.cooldownSec)} ／ 受付 {fmtSec(p.config.windowSec)}。チャンネルを変えたときは、前のチャンネルのパネルは手で消してください。</p>
    </section>
    <section class="card"><h2>いまの部屋の受付（{active.length}）</h2>
      {!active.length ? <p class="note">「こんこん歓迎」「取り込み中」の部屋はありません（ほかは出入り自由です）。</p> : <div class="table-wrap"><table class="compact"><thead><tr><th>部屋</th><th>受付</th><th>返事待ちのこんこん</th></tr></thead><tbody>
        {active.map(r => { const pend = r.state.pending && !r.state.pending.answered && r.state.pending.expires > now ? r.state.pending : undefined; return <tr><td>{chName(r.room) ? '🔊 ' + chName(r.room) : '（消えた部屋）'}</td><td>{ROOM_MODES[r.state.mode]}</td><td>{pend ? `${pend.users.length}人（あと ${Math.max(1, Math.ceil((pend.expires - now) / 1000))} 秒）` : '—'}</td></tr>; })}
      </tbody></table></div>}
      <p class="note">部屋が空になると、BOT が自動で出入り自由に戻します。</p>
    </section>
  </Layout>;
}
