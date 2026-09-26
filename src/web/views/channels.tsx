import type { AdminSession } from '../../db/schema.js';
import type { GuildChannel } from '../../lib/discordRest.js';
import type { ChannelMode } from '../../services/channels.js';
import { Layout } from './layout.js';

export const CHANNEL_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  saved: { text: '保存しました。Discord に反映しました。', kind: 'ok' },
  unchanged: { text: '変わったところがありませんでした。', kind: 'ok' },
  invalid: { text: '入力を確かめてください（名前は 1〜100 文字、説明は 1024 文字まで）。', kind: 'warn' },
  failed: { text: 'Discord に反映できませんでした。BOT の「チャンネルの管理」「ロールの管理」権限を確かめてください。', kind: 'warn' },
};

function Flash(props: { code?: string }) {
  const f = props.code && Object.hasOwn(CHANNEL_FLASH, props.code) ? CHANNEL_FLASH[props.code] : undefined;
  return f ? <p class={`flash ${f.kind}`}>{f.text}</p> : null;
}

/** Discord の年齢制限（見るのに Discord の年齢確認が要る） */
function AgeGate(props: { channel: GuildChannel }) {
  return (
    <label class="field check">
      <input type="checkbox" name="nsfw" value="yes" checked={Boolean(props.channel.nsfw)} />
      <span>🔞 Discord の年齢制限（見るのに Discord の年齢確認が要る）</span>
    </label>
  );
}

/** 名前を変えるフォーム（カテゴリ・通話。通話は年齢制限も） */
function RenameForm(props: { session: AdminSession; channel: GuildChannel; label: string; ageGate?: boolean }) {
  return (
    <form method="post" action={`/channels/${props.channel.id}/name`} class="inline-actions rename">
      <input type="hidden" name="_csrf" value={props.session.csrfToken} />
      <span class="note">{props.label}</span>
      <input type="text" name="name" value={props.channel.name} maxlength={100} required aria-label={`${props.label}の名前`} />
      {props.ageGate && (
        <>
          <input type="hidden" name="ageGateField" value="1" />
          <AgeGate channel={props.channel} />
        </>
      )}
      <button type="submit">保存</button>
    </form>
  );
}

export function ChannelsPage(props: {
  session: AdminSession;
  groups: { category: GuildChannel | null; items: { channel: GuildChannel; mode: ChannelMode }[]; voice: GuildChannel[] }[];
  flash?: string;
}) {
  const { session } = props;
  return (
    <Layout title="チャンネル" session={session} nav="channels">
      <h1>チャンネル</h1>
      <Flash code={props.flash} />
      <p class="note">
        チャンネル・カテゴリ・通話の名前、チャンネルの上に出る説明（トピック）、「書き込める／読むだけ」を変えられます。読むだけのチャンネルは、メッセージ・スレッドは送れず、リアクションだけ付けられます（神職・宮司と BOT は書けます）。見える範囲は変わりません。
      </p>
      <p class="note">
        🔞 Discord の年齢制限を付けると、見るのに Discord の年齢確認が要ります。宵宮は、宵参り申請を運営が承認した人だけが見られるので、年齢制限は付けなくて大丈夫です（その代わり、性的な画像・動画・露骨な話は出さないでください。出す部屋を作るなら、その部屋にだけ年齢制限を付けます）。
      </p>
      <p class="note">
        名前を変えても BOT は同じチャンネルとして扱います（ID で覚えているため）。テキストチャンネルの名前は、Discord が英字を小文字に、空白を「-」に変えます。掲示の <code>{'{#絵馬}'}</code> のようなリンクは、飾り（絵文字・記号）を除いて同じ名前なら見つかります。まったく別の名前にしたときは、掲示の <code>{'{#…}'}</code> も新しい名前に直してください。
      </p>
      {props.groups.map((g) => (
        <section class="card">
          <h2>{g.category ? g.category.name : 'カテゴリなし'}</h2>
          {g.category && <RenameForm session={session} channel={g.category} label="カテゴリ" />}
          <div class="shop-items">
            {g.items.map(({ channel, mode }) => (
              <form method="post" action={`/channels/${channel.id}`} class="shop-item">
                <input type="hidden" name="_csrf" value={session.csrfToken} />
                <div class="shop-item-head">
                  <strong>#{channel.name}</strong>
                  <span class={`tag ${mode === 'readonly' ? 'gray' : 'green'}`}>{mode === 'readonly' ? '読むだけ' : '書き込める'}</span>
                </div>
                <label class="field">
                  <span>名前</span>
                  <input type="text" name="name" value={channel.name} maxlength={100} required />
                </label>
                <label class="field">
                  <span>説明（チャンネルの上に出る）</span>
                  <textarea name="topic" rows={2} maxlength={1024}>
                    {channel.topic ?? ''}
                  </textarea>
                </label>
                <input type="hidden" name="nsfwField" value="1" />
                <AgeGate channel={channel} />
                <div class="inline-actions">
                  <label class="field check">
                    <input type="radio" name="mode" value="writable" checked={mode === 'writable'} />
                    <span>書き込める</span>
                  </label>
                  <label class="field check">
                    <input type="radio" name="mode" value="readonly" checked={mode === 'readonly'} />
                    <span>読むだけ（リアクションは可）</span>
                  </label>
                  <button type="submit" class="ok">
                    保存
                  </button>
                </div>
              </form>
            ))}
          </div>
          {g.voice.length > 0 && (
            <div class="voice-list">
              {g.voice.map((v) => (
                <RenameForm session={session} channel={v} label="🔊 通話" ageGate />
              ))}
            </div>
          )}
        </section>
      ))}
    </Layout>
  );
}
