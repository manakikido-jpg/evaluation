import type { AdminSession } from '../../db/schema.js';
import type { GuildChannel } from '../../lib/discordRest.js';
import { applies, cellOf, kindOf, MAIN_PERMS, MATRIX_PERMS, SCOPE_LABEL, type Cell, type PermScope, type PermTemplate } from '../../services/permMatrix.js';
import { Layout } from './layout.js';

/**
 * 🧮 チャンネル権限（マトリクスとテンプレート）。マスを押すと 中立 → 許可 → 拒否 と変わる（perms.js）。
 * 出す列はブラウザに覚える（ふだんは主要 14 項目）
 */

const FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  tpl_saved: { text: 'テンプレートを保存しました。', kind: 'ok' },
  tpl_deleted: { text: 'テンプレートを消しました。', kind: 'ok' },
  tpl_invalid: { text: 'テンプレートを保存できませんでした（名前を入れて、1 つ以上の権限を「変えない」以外にしてください）。', kind: 'warn' },
  applied: { text: 'テンプレートを当てました。', kind: 'ok' },
  apply_none: { text: '当てるチャンネルを選んでください（テンプレートの種類に合うチャンネルだけ当てられます）。', kind: 'warn' },
  apply_unchanged: { text: '変わるところはありませんでした。', kind: 'ok' },
  apply_failed: { text: '途中で Discord に断られました（BOT が持っていない権限は許可できません）。当てられた分はそのままです。', kind: 'warn' },
  invalid: { text: '選び直してください。', kind: 'warn' },
};

const Csrf = (p: { session: AdminSession }) => <input type="hidden" name="_csrf" value={p.session.csrfToken} />;
const CELL_MARK: Record<Cell, string> = { allow: '✓', deny: '✕', neutral: '-' };
const CELL_LABEL: Record<Cell, string> = { allow: '許可', deny: '拒否', neutral: '中立' };
const KIND_ICON = { text: '#', voice: '🔊', category: '📁' } as const;
const SCOPES: PermScope[] = ['base', 'text', 'voice'];

export type MatrixGroup = { category: GuildChannel | null; items: GuildChannel[] };
type RoleOpt = { id: string; name: string; members?: number };

function Tabs(p: { tab: 'matrix' | 'templates'; roleId?: string }) {
  const q = p.roleId ? `&role=${p.roleId}` : '';
  return (
    <nav class="pm-tabs" aria-label="切り替え">
      <a href={`/channels/perms?tab=matrix${q}`} class={p.tab === 'matrix' ? 'on' : ''}>
        📊 権限マトリクス一覧
      </a>
      <a href={`/channels/perms?tab=templates${q}`} class={p.tab === 'templates' ? 'on' : ''}>
        ⚡ テンプレート一括適用
      </a>
    </nav>
  );
}

/** 表に出す列を選ぶ（ブラウザに覚える） */
function ColumnPicker() {
  return (
    <details class="pm-picker">
      <summary>
        ⚙ 表示項目の選択 <b data-pm-count>{MAIN_PERMS.length}/{MATRIX_PERMS.length}</b>
      </summary>
      <div class="pm-picker-body card">
        <p class="note">画面に出したい権限にチェックを入れてください。選んだものはこのブラウザに覚えて、次に開いたときも同じです。</p>
        <div class="pm-quick">
          クイック選択:
          <button type="button" data-pm-quick="all">
            すべて選択（{MATRIX_PERMS.length}）
          </button>
          <button type="button" data-pm-quick="main">
            主要 {MAIN_PERMS.length} 項目
          </button>
          <button type="button" data-pm-quick="text">
            テキストのみ（{MATRIX_PERMS.filter((p) => p.scope !== 'voice').length}）
          </button>
          <button type="button" data-pm-quick="voice">
            ボイスのみ（{MATRIX_PERMS.filter((p) => p.scope !== 'text').length}）
          </button>
          <button type="button" data-pm-quick="none">
            全解除
          </button>
        </div>
        {SCOPES.map((sc) => (
          <fieldset class="pm-pick-group">
            <legend>
              {SCOPE_LABEL[sc]} <small>{MATRIX_PERMS.filter((p) => p.scope === sc).length} 項目</small>
            </legend>
            {MATRIX_PERMS.filter((p) => p.scope === sc).map((p) => (
              <label class="pm-pick">
                <input type="checkbox" value={String(p.no)} data-pm-col data-scope={p.scope} checked={MAIN_PERMS.includes(p.no)} />
                <span class="pm-no">{p.no}</span>
                <span>
                  <b>{p.label}</b>
                  <small>{p.key}</small>
                </span>
              </label>
            ))}
          </fieldset>
        ))}
        <div class="pm-picker-done">
          <button type="button" class="ok" data-pm-close>
            完了
          </button>
        </div>
      </div>
    </details>
  );
}

function Legend() {
  return (
    <section class="card pm-legend">
      <h2>権限項目の凡例（番号一覧）</h2>
      <p class="note">
        マスを押すと 中立 → 許可 → 拒否 → 中立 と変わり、すぐ Discord に反映されます。<span class="pm-cell allow">✓</span> 許可（ALLOW）・<span class="pm-cell deny">✕</span> 拒否（DENY）・
        <span class="pm-cell neutral">-</span> 中立（カテゴリ・ほかのロールに従う）・<span class="pm-na">/</span> そのチャンネルにない権限
      </p>
      <ol class="pm-legend-list">
        {MATRIX_PERMS.map((p) => (
          <li>
            <span class="pm-no">{p.no}</span>
            <b>{p.label}</b> <code>{p.key}</code>
            {p.note && <small> {p.note}</small>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PermMatrixPage(props: {
  session: AdminSession;
  roles: RoleOpt[];
  roleId: string;
  kind: 'all' | 'text' | 'voice';
  groups: MatrixGroup[];
  flash?: string;
}) {
  const { session, roleId } = props;
  const f = props.flash && Object.hasOwn(FLASH, props.flash) ? FLASH[props.flash] : undefined;
  const show = (c: GuildChannel) => props.kind === 'all' || kindOf(c) === props.kind;
  const Row = (p: { c: GuildChannel; child?: boolean; cat?: string }) => {
    const o = (p.c.permission_overwrites ?? []).find((x) => x.id === roleId);
    const k = kindOf(p.c);
    return (
      <tr class={`pm-row ${k}${p.child ? ' child' : ''}`} data-pm-parent={p.cat}>
        <th scope="row" class="pm-name">
          {k === 'category' ? (
            <button type="button" class="pm-fold" data-pm-fold={p.c.id} aria-expanded="true" title="たたむ・ひらく">
              ▼
            </button>
          ) : null}
          <span class="pm-icon">{KIND_ICON[k]}</span> {p.c.name}
        </th>
        {MATRIX_PERMS.map((m) => {
          if (!applies(m, p.c))
            return (
              <td class="pm-td" data-pm-colno={m.no} hidden={!MAIN_PERMS.includes(m.no)}>
                <span class="pm-na" title="このチャンネルにない権限">
                  /
                </span>
              </td>
            );
          const cell = cellOf(o, m.bit);
          return (
            <td class="pm-td" data-pm-colno={m.no} hidden={!MAIN_PERMS.includes(m.no)}>
              <button type="button" class={`pm-cell ${cell}`} data-ch={p.c.id} data-bit={String(m.bit)} data-cell={cell} title={`${p.c.name} ・ ${m.no}. ${m.label}: ${CELL_LABEL[cell]}`}>
                {CELL_MARK[cell]}
              </button>
            </td>
          );
        })}
      </tr>
    );
  };
  return (
    <Layout title="チャンネル権限" session={session} nav="channels" scripts={['perms.js']} wide>
      <div class="page-head">
        <h1>🧮 チャンネル権限 &amp; テンプレート適用</h1>
        <a href="/channels">← チャンネル</a>
      </div>
      <Tabs tab="matrix" roleId={roleId} />
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <section class="card pm-wrap" data-pm data-csrf={session.csrfToken} data-role={roleId}>
        <form method="get" action="/channels/perms" class="pm-bar" data-pm-autosubmit>
          <input type="hidden" name="tab" value="matrix" />
          <label>
            対象ロール:{' '}
            <select name="role">
              {props.roles.map((r) => (
                <option value={r.id} selected={r.id === roleId}>
                  {r.name}
                  {r.members !== undefined ? `（${r.members} 名）` : ''}
                </option>
              ))}
            </select>
          </label>
          <span class="pm-kinds" role="radiogroup" aria-label="チャンネルの種類">
            {(
              [
                ['all', 'すべて'],
                ['text', 'テキスト'],
                ['voice', 'ボイス'],
              ] as const
            ).map(([k, label]) => (
              <label class={props.kind === k ? 'on' : ''}>
                <input type="radio" name="kind" value={k} checked={props.kind === k} /> {label}
              </label>
            ))}
          </span>
          <noscript>
            <button type="submit">表示</button>
          </noscript>
          <ColumnPicker />
          <button type="button" data-pm-quick="all" class="pm-showall">
            🌐 すべての権限を表示
          </button>
          <button type="button" data-pm-foldall class="pm-foldall">
            📁 すべて折りたたみ
          </button>
        </form>
        <p class="pm-status note" data-pm-status aria-live="polite"></p>
        <div class="table-wrap pm-scroll">
          <table class="pm-table">
            <thead>
              <tr>
                <th scope="col" class="pm-name">
                  チャンネル名
                </th>
                {MATRIX_PERMS.map((m) => (
                  <th scope="col" class="pm-th" data-pm-colno={m.no} hidden={!MAIN_PERMS.includes(m.no)} title={`${m.no}. ${m.label}（${m.key}）`}>
                    <span class="pm-no">{m.no}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.groups.map((g) => {
                const items = g.items.filter(show);
                if (g.category && !items.length && props.kind !== 'all') return null;
                return (
                  <>
                    {g.category && <Row c={g.category} />}
                    {items.map((c) => (
                      <Row c={c} child={Boolean(g.category)} cat={g.category?.id} />
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <Legend />
    </Layout>
  );
}

const TARGET_LABEL = { all: 'すべて（テキスト / ボイス）', text: 'テキストだけ', voice: 'ボイスだけ' } as const;

export function PermTemplatesPage(props: {
  session: AdminSession;
  roles: RoleOpt[];
  roleId: string;
  templates: PermTemplate[];
  edit?: PermTemplate;
  groups: MatrixGroup[];
  flash?: string;
  /** 当てるテンプレート（選んだもの） */
  applyId?: string;
}) {
  const { session } = props;
  const f = props.flash && Object.hasOwn(FLASH, props.flash) ? FLASH[props.flash] : undefined;
  const t = props.edit;
  const applying = props.templates.find((x) => x.id === props.applyId) ?? props.templates[0];
  return (
    <Layout title="チャンネル権限" session={session} nav="channels" scripts={['perms.js']} wide>
      <div class="page-head">
        <h1>🧮 チャンネル権限 &amp; テンプレート適用</h1>
        <a href="/channels">← チャンネル</a>
      </div>
      <Tabs tab="templates" roleId={props.roleId} />
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}

      <section class="card">
        <h2>⚡ テンプレートを一括で当てる</h2>
        {props.templates.length === 0 ? (
          <p class="empty">まだテンプレートがありません。下で作ってください。</p>
        ) : (
          <form method="post" action="/channels/perms/apply" class="pm-apply" data-pm-apply>
            <Csrf session={session} />
            <div class="fields">
              <label class="field">
                <span>テンプレート</span>
                <select name="template" required>
                  {props.templates.map((x) => (
                    <option value={x.id} selected={x.id === applying?.id}>
                      {x.name}（{TARGET_LABEL[x.target]}・{Object.keys(x.perms).length} 項目）
                    </option>
                  ))}
                </select>
              </label>
              <label class="field">
                <span>当てるロール</span>
                <select name="role" required>
                  {props.roles.map((r) => (
                    <option value={r.id} selected={r.id === props.roleId}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p class="note">
              選んだチャンネルの、そのロールの権限の上書きに、テンプレートの「許可・拒否・中立に戻す」を当てます（「変えない」の権限・ほかのロールはそのまま）。テンプレートの種類に合わないチャンネル（テキスト用のテンプレートとボイスチャンネルなど）は飛ばします。カテゴリに当てても、中のチャンネルには広がりません（中のチャンネルも選んでください）。
            </p>
            <div class="pm-apply-quick">
              <button type="button" data-pm-check="all">
                すべて選ぶ
              </button>
              <button type="button" data-pm-check="text">
                テキストを選ぶ
              </button>
              <button type="button" data-pm-check="voice">
                ボイスを選ぶ
              </button>
              <button type="button" data-pm-check="none">
                すべて外す
              </button>
            </div>
            <div class="pm-chlist">
              {props.groups.map((g) => (
                <fieldset>
                  <legend>
                    {g.category ? (
                      <label>
                        <input type="checkbox" name="channels" value={g.category.id} data-kind="category" data-cat={g.category.id} /> 📁 {g.category.name}
                      </label>
                    ) : (
                      'カテゴリなし'
                    )}
                  </legend>
                  {g.items.map((c) => (
                    <label class="pm-ch">
                      <input type="checkbox" name="channels" value={c.id} data-kind={kindOf(c)} data-in={g.category?.id} /> {KIND_ICON[kindOf(c)]} {c.name}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <label class="field check">
              <input type="checkbox" name="confirm" value="yes" required />
              <span>選んだチャンネルに当てる（すぐ Discord に反映されます）</span>
            </label>
            <button type="submit" class="ok">
              ⚡ 一括で当てる
            </button>
          </form>
        )}
      </section>

      <section class="card">
        <h2>📋 テンプレート</h2>
        {props.templates.length === 0 ? (
          <p class="empty">まだありません。</p>
        ) : (
          <table class="compact">
            <thead>
              <tr>
                <th>名前</th>
                <th>種類</th>
                <th>中身</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {props.templates.map((x) => (
                <tr>
                  <td>
                    <b>{x.name}</b>
                    {x.note && <div class="note">{x.note}</div>}
                  </td>
                  <td>{TARGET_LABEL[x.target]}</td>
                  <td class="wrap">
                    {MATRIX_PERMS.filter((p) => x.perms[String(p.no)]).map((p) => (
                      <span class={`pm-tag ${x.perms[String(p.no)]}`}>
                        {CELL_MARK[x.perms[String(p.no)]!]} {p.no}. {p.label}
                      </span>
                    ))}
                  </td>
                  <td class="nowrap">
                    <a href={`/channels/perms?tab=templates&edit=${x.id}#pm-edit`}>編集</a>{' '}
                    <form method="post" action={`/channels/perms/templates/${x.id}/delete`} class="inline">
                      <Csrf session={session} />
                      <button type="submit" class="danger small">
                        消す
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section class="card anchor" id="pm-edit">
        <h2>{t ? `✏ テンプレートを直す: ${t.name}` : '➕ 新規 権限テンプレートの作成'}</h2>
        <form method="post" action="/channels/perms/templates" class="pm-tpl">
          <Csrf session={session} />
          {t && <input type="hidden" name="id" value={t.id} />}
          <div class="fields">
            <label class="field">
              <span>テンプレート名 *</span>
              <input type="text" name="name" maxlength={40} required value={t?.name ?? ''} placeholder="例: 📢 告知専用チャンネル（発言禁止）" />
            </label>
            <label class="field">
              <span>当てるチャンネルの種類</span>
              <select name="target">
                {(['all', 'text', 'voice'] as const).map((k) => (
                  <option value={k} selected={(t?.target ?? 'all') === k}>
                    {TARGET_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>メモ・説明</span>
              <input type="text" name="note" maxlength={200} value={t?.note ?? ''} placeholder="例: 発言を止めて、見るだけにする" />
            </label>
          </div>
          <div class="pm-tpl-head">
            <b>権限（当てるロールのルール）</b>
            <button type="button" data-pm-tpl-reset>
              すべて「変えない」にする
            </button>
          </div>
          {SCOPES.map((sc) => (
            <fieldset class="pm-pick-group">
              <legend>
                {SCOPE_LABEL[sc]} <small>{MATRIX_PERMS.filter((p) => p.scope === sc).length} 項目</small>
              </legend>
              {MATRIX_PERMS.filter((p) => p.scope === sc).map((p) => {
                const v = t?.perms[String(p.no)] ?? 'keep';
                return (
                  <label class="pm-pick">
                    <span class="pm-no">{p.no}</span>
                    <span>
                      <b>{p.label}</b>
                      <small>{p.key}</small>
                    </span>
                    <select name={`p.${p.no}`} class={`pm-sel ${v}`}>
                      <option value="keep" selected={v === 'keep'}>
                        変えない
                      </option>
                      <option value="allow" selected={v === 'allow'}>
                        ✓ 許可
                      </option>
                      <option value="deny" selected={v === 'deny'}>
                        ✕ 拒否
                      </option>
                      <option value="neutral" selected={v === 'neutral'}>
                        - 中立に戻す
                      </option>
                    </select>
                  </label>
                );
              })}
            </fieldset>
          ))}
          <div class="inline-actions">
            {t && <a href="/channels/perms?tab=templates">やめる</a>}
            <button type="submit" class="ok">
              保存する
            </button>
          </div>
        </form>
      </section>
    </Layout>
  );
}
