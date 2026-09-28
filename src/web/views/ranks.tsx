import type { GuildConfig, Rank } from '../../config.js';
import type { AdminSession } from '../../db/schema.js';
import type { GuildRole } from '../../lib/discordRest.js';
import { Layout } from './layout.js';

export const RANKS_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  saved: { text: '保存しました（BOT には 1 分以内に反映されます）。', kind: 'ok' },
  saved_notices: { text: '保存しました。投稿済みの掲示の役職の名前・数字も書き換えました。', kind: 'ok' },
  added: { text: '役職を足しました。ロールを持っている人は、この役職として数えられます。', kind: 'ok' },
  deleted: { text: '役職を消しました（Discord のロールはそのまま残っています）。', kind: 'ok' },
  invalid: { text: '保存できませんでした。名前が空・ロールが重なっている・昇格に必要なご縁が同じ役職がある、などを確かめてください。', kind: 'warn' },
  no_roles: { text: 'Discord からロールを読めませんでした。時間をおいてもう一度お試しください。', kind: 'warn' },
  locked: { text: 'この役職は消せません（設定ファイルの役職です）。', kind: 'warn' },
};

function Csrf(props: { session: AdminSession }) {
  return <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
}

/** 管理画面に入れるかをロールで決めている役職（ロールを変えると入れなくなるので、ファイルで決める） */
export const ADMIN_RANK_KEYS = ['guji', 'shinshoku'];

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
}) {
  const { session, cfg, fileCfg } = props;
  const f = props.flash && Object.hasOwn(RANKS_FLASH, props.flash) ? RANKS_FLASH[props.flash] : undefined;
  const firstAutoKey = [...cfg.ranks].filter((x) => x.auto).sort((a, b) => a.requiredGoen - b.requiredGoen)[0]?.key;
  const ranks = [...cfg.ranks].sort((a, b) => b.weight - a.weight);
  const fromFile = (r: Rank) => fileCfg.ranks.find((x) => x.key === r.key);
  const used = new Map(cfg.ranks.map((r) => [r.roleId, r.name]));
  const roleName = (id: string) => props.roles?.find((r) => r.id === id)?.name;
  return (
    <Layout title="役職" session={session} nav="settings">
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
                          {adminRole && <small class="note"> （管理画面に入れる人を決めるロールなので、ファイルで変えます）</small>}
                        </>
                      ) : (
                        <RoleSelect name={`${k}.roleId`} roles={props.roles} selected={r.roleId} used={used} self={r.name} required />
                      )}
                    </td>
                    <td class="num">{props.counts.get(r.roleId) ?? 0}</td>
                    <td class="nowrap">
                      {fr ? (
                        !r.auto ? (
                          '任命制'
                        ) : r.key === firstAutoKey ? (
                          <>
                            入鯖時
                            <input type="hidden" name={`${k}.requiredGoen`} value="0" />
                          </>
                        ) : (
                          <>
                            ご縁 <input type="number" name={`${k}.requiredGoen`} value={String(r.requiredGoen)} min={0} required size={5} />
                            {fr.requiredGoen !== r.requiredGoen && <small> ファイル: {fr.requiredGoen}</small>}
                          </>
                        )
                      ) : (
                        // 社務所Web で足した役職は、なり方も変えられる
                        <>
                          <select name={`${k}.kind`}>
                            <option value="auto" selected={r.auto}>
                              ご縁で自動
                            </option>
                            <option value="appointed" selected={!r.auto}>
                              任命制
                            </option>
                          </select>{' '}
                          ご縁 <input type="number" name={`${k}.requiredGoen`} value={String(r.requiredGoen)} min={1} size={5} />
                        </>
                      )}
                    </td>
                    <td>
                      <input type="number" name={`${k}.weight`} value={String(r.weight)} min={1} max={100} required size={3} />
                      {fr && fr.weight !== r.weight && <small> ファイル: {fr.weight}</small>}
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
        </p>
        <button type="submit" class="ok">
          保存
        </button>
      </form>

      {props.roles && (
        <section class="card anchor" id="rank-add">
          <h2>＋ 役職を足す</h2>
          <p class="note">先に「ロール」のページで Discord のロールを作っておき、ここで選びます。</p>
          <form method="post" action="/ranks/new">
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
              <label class="field">
                <span>昇格に必要なご縁（ご縁で自動のとき）</span>
                <input type="number" name="requiredGoen" min={1} value="500" />
              </label>
              <label class="field">
                <span>朱印の格</span>
                <input type="number" name="weight" min={1} max={100} value="1" required />
              </label>
            </div>
            <button type="submit" class="ok">
              足す
            </button>
          </form>
        </section>
      )}
      <p>
        <a href="/settings#sec-ranks">← 設定へ</a> ・ <a href="/roles">ロールのページへ →</a>
      </p>
    </Layout>
  );
}
