import type { AdminSession } from '../../db/schema.js';
import { audienceOf, type Audience, type CommandInfo, type CommandOptionInfo } from '../../services/commandList.js';

const AUDIENCE_TAG: Record<Audience, string> = { all: '入ったばかりの人にも', member: '承認された人', yakudoshi: '👹 厄年の人だけ', staff: '運営' };
import { Layout } from './layout.js';

export const COMMANDS_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  notice_created: { text: '掲示を作りました。内容を見て「保存して Discord に反映」を押すと出ます。', kind: 'ok' },
  notice_invalid: { text: '出すチャンネルを選んでください。', kind: 'warn' },
};

function Options(props: { options: CommandOptionInfo[] }) {
  if (!props.options.length) return null;
  return (
    <span class="cmd-opts">
      {props.options.map((o) => (
        <span class={`tag ${o.required ? 'red' : 'gray'}`} title={o.description || undefined}>
          {o.name}
          {o.required ? '（必須）' : ''}
          {o.description ? `: ${o.description}` : ''}
        </span>
      ))}
    </span>
  );
}

function CommandRows(props: { list: CommandInfo[] }) {
  return (
    <ul class="ch-list">
      {props.list.map((c) => (
        <li class="ch-row cmd-row">
          <code class="cmd-name">{c.kind === 'menu' ? `🖱 ${c.name}` : `/${c.name}`}</code>
          <div class="ch-main">
            <div>
              {c.description} <span class={`tag ${audienceOf(c) === 'all' ? 'green' : 'gray'}`}>{AUDIENCE_TAG[audienceOf(c)]}</span>
            </div>
            <Options options={c.options} />
            {c.subcommands.length > 0 && (
              <ul class="cmd-subs">
                {c.subcommands.map((s) => (
                  <li>
                    <code>
                      /{c.name} {s.name}
                    </code>{' '}
                    … {s.description}
                    <Options options={s.options} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CommandsPage(props: { session: AdminSession; list: CommandInfo[]; channels?: { id: string; name: string; category: string | null }[]; flash?: string }) {
  const members = props.list.filter((c) => !c.staff);
  const staff = props.list.filter((c) => c.staff);
  const f = props.flash && Object.hasOwn(COMMANDS_FLASH, props.flash) ? COMMANDS_FLASH[props.flash] : undefined;
  return (
    <Layout title="コマンド" session={props.session} nav="commands">
      <div class="page-head">
        <h1>⌨ コマンドのまとめ</h1>
      </div>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <p class="note">
        Discord で BOT に使えるコマンドの一覧です（BOT に登録しているものをそのまま出しているので、コマンドが増えるとここにも増えます）。Discord で <code>/</code> を打つと出てきます。
        赤い印は、入れないと使えない項目です。Discord の <code>/コマンド</code> では、その人のロールに合うもの（右の印）だけが出ます。
      </p>

      <section class="card ch-group">
        <div class="ch-cat">
          <span class="ch-cat-name">🙋 だれでも使える</span>
          <span class="ch-count">{members.length}</span>
        </div>
        <CommandRows list={members} />
      </section>

      <section class="card ch-group">
        <div class="ch-cat">
          <span class="ch-cat-name">🛡 運営（神職・宮司）だけ</span>
          <span class="ch-count">{staff.length}</span>
          <span class="note">「メンバーをタイムアウト」の権限がある人にだけ出ます。使えるかは BOT が役職で確かめます</span>
        </div>
        <CommandRows list={staff} />
      </section>

      {props.channels && (
        <section class="card">
          <h2>📣 メンバー向けのまとめを Discord に出す</h2>
          <p class="note">
            「だれでも使える」コマンドの一覧を、掲示として作ります（本文は <code>{'{コマンド一覧}'}</code> なので、コマンドが増えると掲示の中身も新しくなります）。作ったあと、掲示の編集ページで文面を直してから Discord に出せます。
          </p>
          <form method="post" action="/commands/notice" class="inline-actions">
            <input type="hidden" name="_csrf" value={props.session.csrfToken} />
            <select name="channelId" required aria-label="出すチャンネル">
              <option value="">出すチャンネルを選ぶ</option>
              {props.channels.map((c) => (
                <option value={c.id}>
                  {c.category ? `${c.category} / ` : ''}#{c.name}
                </option>
              ))}
            </select>
            <button type="submit" class="ok">
              掲示を作る
            </button>
          </form>
        </section>
      )}
    </Layout>
  );
}
