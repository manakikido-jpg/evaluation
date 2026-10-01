import type { GuildConfig, Rank } from '../../config.js';
import type { AdminSession } from '../../db/schema.js';
import type { GuildRole } from '../../lib/discordRest.js';
import { Layout } from './layout.js';
import type { ResetState } from '../../services/evalReset.js';
import { autoRanks } from '../../domain/ranks.js';

export const RANKS_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  saved: { text: '保存しました（BOT には 1 分以内に反映されます）。', kind: 'ok' },
  saved_notices: { text: '保存しました。投稿済みの掲示の役職の名前・数字も書き換えました。', kind: 'ok' },
  added: { text: '役職を足しました。ロールを持っている人は、この役職として数えられます。', kind: 'ok' },
  deleted: { text: '役職を消しました（Discord のロールはそのまま残っています）。', kind: 'ok' },
  invalid: { text: '保存できませんでした。名前が空・ロールが重なっている・昇格に必要なご縁が同じ役職がある、などを確かめてください。', kind: 'warn' },
  no_roles: { text: 'Discord からロールを読めませんでした。時間をおいてもう一度お試しください。', kind: 'warn' },
  locked: { text: 'この役職は消せません（設定ファイルの役職です）。', kind: 'warn' },
  reset_started: { text: '🔄 評価をリセットしました。朱印は取り消し済み。役職の付け替えを少しずつ進めています（このページで進み具合が見られます）。', kind: 'ok' },
  reset_confirm: { text: 'リセットするときは、確かめの欄に「リセット」と入れてください。', kind: 'warn' },
  reset_already: { text: '評価のリセットはもう行っています（一度だけです）。', kind: 'warn' },
  reset_undone: { text: '朱印を元に戻しました（役職は戻していません）。', kind: 'ok' },
};

function Csrf(props: { session: AdminSession }) {
  return <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
}

/** 管理画面に入れるかをロールで決めている役職（ロールを変えると入れなくなるので、ファイルで決める） */
export const ADMIN_RANK_KEYS = ['guji', 'shinshoku'];

/** 入鯖時に付くいちばん下の自動の役職（参拝者） */
export const firstAutoKeyOf = (ranks: readonly Rank[]) => [...ranks].filter((x) => x.auto).sort((a, b) => a.requiredGoen - b.requiredGoen)[0]?.key;

function RoleSelect(props: { name: string; roles: GuildRole[]; selected?: string; used: Map<string, string>; self?: string; required?: boolean }) {
  return (
    <select name={props.name} required={props.required}>
      {!props.selected && <option value="">（ロールを選ぶ）</option>}
      {props.roles.map((r) => {
        const by = props.used.get(r.id);
        return (
          <option value={r.id} selected={props.selected === r.id}>
            {r.name}
            {by && by !== props.self ? `（${by} で使用中）` : ''}
          </option>
        );
      })}
    </select>
  );
}

export function RanksPage(props: {
  session: AdminSession;
  cfg: GuildConfig;
  fileCfg: GuildConfig;
  /** 選べるロール（@everyone・BOT などの自動のロールは除く）。読めなければ undefined */
  roles?: GuildRole[];
  /** ロールごとの人数 */
  counts: Map<string, number>;
  flash?: string;
  /** 評価のリセット（していなければ undefined） */
  reset?: ResetState;
}) {
  const { session, cfg, fileCfg } = props;
  const f = props.flash && Object.hasOwn(RANKS_FLASH, props.flash) ? RANKS_FLASH[props.flash] : undefined;
  const ranks = [...cfg.ranks].sort((a, b) => b.weight - a.weight);
  const fromFile = (r: Rank) => fileCfg.ranks.find((x) => x.key === r.key);
  // 宮司・神職（管理画面に入れる人）と、入鯖時に付くいちばん下の役職は、なり方を変えない
  const fileFirstAuto = firstAutoKeyOf(fileCfg.ranks);
  const fixedKind = (r: Rank) => (Boolean(fromFile(r)) && ADMIN_RANK_KEYS.includes(r.key)) || r.key === fileFirstAuto;
  const used = new Map(cfg.ranks.map((r) => [r.roleId, r.name]));
  const roleName = (id: string) => props.roles?.find((r) => r.id === id)?.name;
  return (
    <Layout title="役職" session={session} nav="ranks">
      <h1>⛩ 役職</h1>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      {!props.roles && <p class="flash warn">Discord からロールを読めませんでした。ロールの付け替えと役職を足すことはできません（名前・格・昇格ラインは変えられます）。</p>}
      <p class="note">
        参拝者〜宮司などの役職です。役職のロールを持っている人は「承認された人」として数えられ（🧭案内待ちが外れる）、朱印の格や自動の昇格もここで決まります。
        名前・絵文字を変えても Discord のロールの名前は変わりません（変えるときは「ロール」のページで）。ロールを付け替えても、今持っている人のロールは付け替えません。
      </p>

      <form method="post" action="/ranks" class="card">
        <Csrf session={session} />
        <h2>今の役職</h2>
        <div class="table-wrap">
          <table class="compact">
            <thead>
              <tr>
                <th>絵文字</th>
                <th>名前</th>
                <th>Discord のロール</th>
                <th>人数</th>
                <th>なり方</th>
                <th>朱印の格</th>
                <th>通話の銭</th>
                <th>1 日の上限</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ranks.map((r) => {
                const fr = fromFile(r);
                const k = `rank.${r.key}`;
                const adminRole = Boolean(fr) && ADMIN_RANK_KEYS.includes(r.key);
                return (
                  <tr>
                    <td>
                      <input type="text" name={`${k}.emoji`} value={r.emoji} maxlength={16} size={3} />
                    </td>
                    <td>
                      <input type="text" name={`${k}.name`} value={r.name} maxlength={20} required size={8} />
                      {fr && fr.name !== r.name && <small> ファイル: {fr.name}</small>}
                    </td>
                    <td>
                      {adminRole || !props.roles ? (
                        <>
                          {roleName(r.roleId) ?? r.roleId}
                          {adminRole && (
                            <small class="note" title="管理画面に入れる人を決めるロールなので、config/guild.json で変えます">
                              {' '}
                              🔒 ファイルで設定
                            </small>
                          )}
                        </>
                      ) : (
                        <RoleSelect name={`${k}.roleId`} roles={props.roles} selected={r.roleId} used={used} self={r.name} required />
                      )}
                    </td>
                    <td class="num">{props.counts.get(r.roleId) ?? 0}</td>
                    <td class="nowrap kind-cell">
                      {fixedKind(r) ? (
                        !r.auto ? (
                          <>
                            任命制
                            <small class="note"> （固定）</small>
                          </>
                        ) : (
                          <>
                            入鯖時
                            <input type="hidden" name={`${k}.requiredGoen`} value="0" />
                          </>
                        )
                      ) : (
                        // ご縁で自動 ⇔ 任命制 を変えられる（任命制ならご縁の欄は隠れる）
                        <>
                          <select name={`${k}.kind`} aria-label="なり方">
                            <option value="auto" selected={r.auto}>
                              ご縁で自動
                            </option>
                            <option value="appointed" selected={!r.auto}>
                              任命制
                            </option>
                          </select>{' '}
                          <span class="goen">
                            ご縁 <input type="number" name={`${k}.requiredGoen`} value={String(r.auto ? r.requiredGoen : '')} min={1} size={5} aria-label="昇格に必要なご縁" />
                            {fr && fr.auto && fr.requiredGoen !== r.requiredGoen && <small> ファイル: {fr.requiredGoen}</small>}
                          </span>
                        </>
                      )}
                    </td>
                    <td>
                      <input type="number" name={`${k}.weight`} value={String(r.weight)} min={1} max={100} required size={3} />
                      {fr && fr.weight !== r.weight && <small> ファイル: {fr.weight}</small>}
                    </td>
                    <td class="nowrap">
                      <input type="number" name={`${k}.voicePercent`} value={String(r.voicePercent)} min={0} max={1000} required size={4} aria-label="通話でもらえる銭の倍率（%）" /> %
                      {fr && fr.voicePercent !== r.voicePercent && <small> ファイル: {fr.voicePercent}</small>}
                      <br />
                      <small class="note">10 分 {Math.round((cfg.economy.voicePer10Min * r.voicePercent) / 100).toLocaleString('ja-JP')} 枚</small>
                    </td>
                    <td class="nowrap">
                      <input
                        type="number"
                        name={`${k}.voiceCapPercent`}
                        value={r.voiceCapPercent === undefined ? '' : String(r.voiceCapPercent)}
                        min={0}
                        max={1000}
                        size={4}
                        placeholder={String(r.voicePercent)}
                        aria-label="通話でもらえる 1 日の上限の倍率（%。空なら通話の銭と同じ）"
                      />{' '}
                      %
                      <br />
                      <small class="note">1 日 {Math.round((cfg.economy.voiceDailyCap * (r.voiceCapPercent ?? r.voicePercent)) / 100).toLocaleString('ja-JP')} 枚まで</small>
                    </td>
                    <td>
                      {!fr && (
                        <button type="submit" formaction={`/ranks/${r.key}/delete`} class="danger" title="この役職を消す（ロールは残る）">
                          消す
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p class="note">
          朱印の格 = 朱印 1 回で渡すご縁。「ご縁で自動」の役職は、ご縁がたまると自動で上がります（下がることはありません）。昇格に必要なご縁は役職ごとに別の数にしてください。
          「任命制」の役職は、運営が Discord でロールを付けた人がなります（ご縁では上がりません）。任命制の役職は運営として扱うので、「読むだけ」のチャンネルにも書けます。
          宮司・神職と、入鯖時に付く役職のなり方は変えられません。
          通話の銭 = 通話でもらえる銭の倍率（100% でふつう・150% で 1.5 倍・0% でもらえない）。10 分ごとの量・コアタイムで増える分にかかります。1 日の上限 = その役職の 1 日にもらえる上限の倍率（空なら通話の銭と同じ %。例: 通話の銭 100%・1 日の上限 200% なら、10 分ごとはふつうのまま、長くいると 2 倍までもらえる）。いくつか役職を持っている人は、朱印の格がいちばん高い役職の倍率です。
        </p>
        <button type="submit" class="ok">
          保存
        </button>
      </form>

      {props.roles && (
        <section class="card anchor" id="rank-add">
          <h2>＋ 役職を足す</h2>
          <p class="note">先に「ロール」のページで Discord のロールを作っておき、ここで選びます。</p>
          <form method="post" action="/ranks/new" class="rank-add">
            <Csrf session={session} />
            <div class="fields">
              <label class="field">
                <span>絵文字（なくてもよい）</span>
                <input type="text" name="emoji" maxlength={16} />
              </label>
              <label class="field">
                <span>名前</span>
                <input type="text" name="name" maxlength={20} required />
              </label>
              <label class="field">
                <span>Discord のロール</span>
                <RoleSelect name="roleId" roles={props.roles.filter((r) => !used.has(r.id))} used={used} required />
              </label>
              <label class="field">
                <span>なり方</span>
                <select name="kind">
                  <option value="auto">ご縁で自動</option>
                  <option value="appointed">任命制（運営が付ける）</option>
                </select>
              </label>
              <label class="field goen-field">
                <span>昇格に必要なご縁</span>
                <input type="number" name="requiredGoen" min={1} value="500" />
              </label>
              <label class="field">
                <span>朱印の格</span>
                <input type="number" name="weight" min={1} max={100} value="1" required />
              </label>
              <label class="field">
                <span>通話の銭（%。100 でふつう）</span>
                <input type="number" name="voicePercent" min={0} max={1000} value="100" required />
              </label>
            </div>
            <button type="submit" class="ok">
              足す
            </button>
          </form>
        </section>
      )}
      {session.level === 'guji' && <EvalReset session={session} cfg={cfg} reset={props.reset} />}
      <p>
        <a href="/settings#sec-ranks">← 設定へ</a> ・ <a href="/roles">ロールのページへ →</a>
      </p>
    </Layout>
  );
}

/** 🔄 評価のリセット（一度だけ・宮司） */
function EvalReset(props: { session: AdminSession; cfg: GuildConfig; reset?: ResetState }) {
  const r = props.reset;
  const base = autoRanks(props.cfg.ranks)[0];
  const at = (iso: string) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  return (
    <section class="card" id="reset">
      <h2>🔄 評価のリセット（一度だけ）</h2>
      {r ? (
        <>
          <p>
            {at(r.at)} にリセットしました。取り消した朱印 {r.revoked.toLocaleString('ja-JP')} 件・役職を戻す人 {r.targets.length} 人。
          </p>
          <p class={r.finishedAt ? 'note' : 'flash ok'}>
            役職の付け替え: {r.done} / {r.targets.length} 人{r.finishedAt ? `（${at(r.finishedAt)} に終わりました）` : '（進めています。ページを開き直すと進み具合が変わります）'}
            {r.failed.length > 0 && `・うまくいかなかった人 ${r.failed.length} 人（BOT より上のロールなど。Discord で直してください）`}
          </p>
          {r.undoneAt ? (
            <p class="note">{at(r.undoneAt)} に朱印を元に戻しました。</p>
          ) : (
            <form method="post" action="/ranks/reset/undo" class="inline-form">
              <Csrf session={props.session} />
              <button type="submit">
                朱印だけ元に戻す（まちがえたとき）
              </button>
            </form>
          )}
        </>
      ) : (
        <>
          <p>
            みんなの評価をはじめからにします。<b>一度だけ</b>できます。
          </p>
          <ul>
            <li>押されている朱印を全部「取り消し」にします（記録は残ります）。ご縁は全員 0 から。同じ相手にまた朱印を押せます（押し直しでは銭は出ません）。</li>
            <li>ご縁で上がる役職を、全員 {base ? `${base.emoji ?? ''} ${base.name}` : 'いちばん下の役職'} に戻します。任命制の役職（宮司・神職など）と銭はそのままです。</li>
            <li>役職の付け替えは Discord に 1 人ずつ頼むので、人数が多いと少し時間がかかります。</li>
          </ul>
          <form method="post" action="/ranks/reset" class="fields">
            <Csrf session={props.session} />
            <label class="field">
              <span>確かめ: 「リセット」と入れてください</span>
              <input type="text" name="confirm" required autocomplete="off" />
            </label>
            <button type="submit" class="danger">
              評価をリセットする
            </button>
          </form>
        </>
      )}
    </section>
  );
}
