import { OMIKUJI_LINE_MAX, OMIKUJI_SPECIAL_MAX, type GuildConfig } from '../../config.js';
import { FORTUNE_KEYS, TONE_LABEL, TONES } from '../../omikujiTexts.js';
import { FORTUNES } from '../../services/omikuji.js';
import type { AdminSession } from '../../db/schema.js';

/** 社務所Web の知らせ（⛩ おみくじの文と紙） */
export const OMIKUJI_TEXTS_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  otexts_saved: { text: '⛩ おみくじの文と紙を保存しました（BOT には 1 分以内に反映されます）。', kind: 'ok' },
  otexts_partial: { text: '⛩ おみくじの文を保存しましたが、入らなかった台紙があります（PNG・JPEG で 4MB まで。WebP は使えません）。', kind: 'warn' },
  otexts_invalid: { text: '⛩ おみくじの文を保存できませんでした。項目の名前（6 文字まで）・数（一言は運勢ごとに 80 まで・項目の文は 40 まで）を確かめてください。', kind: 'warn' },
  otexts_long: { text: `⛩ 保存できませんでした。1 行は ${OMIKUJI_LINE_MAX} 文字までです（長い行を 2 つに分けてください）。`, kind: 'warn' },
  otexts_reset: { text: '⛩ おみくじの文を、はじめの文に戻しました（台紙はそのまま）。', kind: 'ok' },
  otexts_bg_deleted: { text: '⛩ 台紙を消しました（ここで描いた柄に戻ります）。', kind: 'ok' },
};

const lines = (xs: readonly string[]) => xs.join('\n');
const Csrf = (props: { session: AdminSession }) => <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
function Flash(props: { code?: string }) {
  const f = props.code && Object.hasOwn(OMIKUJI_TEXTS_FLASH, props.code) ? OMIKUJI_TEXTS_FLASH[props.code] : undefined;
  return f ? <p class={`flash ${f.kind}`}>{f.text}</p> : null;
}

/** 台紙の枠（絵・選ぶ・消す・紙の見本） */
function BgSlot(props: { k: string; title: string; hash?: string; note?: string; noPreview?: boolean }) {
  const { k, hash } = props;
  return (
    <div class={`art-slot${hash ? ' has' : ''}`}>
      <strong>{props.title}</strong>
      {props.noPreview ? (
        <span class="note">名前を入れると、紙の見本が出ます。</span>
      ) : (
        <a href={`/settings/omikuji-preview/${k}`} target="_blank" rel="noopener" class="slip-preview">
          <img src={`/settings/omikuji-preview/${k}?v=${hash ?? 'none'}`} alt={`${props.title} の紙の見本`} loading="lazy" />
        </a>
      )}
      {props.note && <span class="note">{props.note}</span>}
      <label class="art-pick">
        <span>{hash ? '別の台紙にする' : '台紙を選ぶ（なくても OK）'}</span>
        <input type="file" name={`bg.${k}`} accept="image/png,image/jpeg" data-art-input aria-label={`${props.title} の台紙`} />
      </label>
      {hash && (
        <button type="submit" form={`otexts-bgdel-${k}`} class="art-del">
          台紙を消す
        </button>
      )}
    </div>
  );
}

/** ⛩ おみくじの文と紙: 運勢ごとの一言・項目（運勢の向きごと）・ラッキー場所・台紙。1 行 1 つ */
export function OmikujiTextsSection(props: { session: AdminSession; cfg: GuildConfig; bg: Record<string, string>; flash?: string }) {
  const t = props.cfg.omikujiTexts;
  const sp = props.cfg.omikujiSpecial;
  // 項目は今あるもの＋新しい 1 つ（名前を空にすると消える）
  const items = [...t.items, ...(t.items.length < 8 ? [{ key: '', emoji: '', label: '', fixed: false, good: [], normal: [], bad: [] }] : [])];
  return (
    <section class="card anchor" id="sec-omikujitexts">
      <h2>📜 おみくじの文と紙</h2>
      <p class="note">
        /おみくじ の結果は、縦書きのおみくじの紙（画像）で出ます。一言は運勢ごとに選び、同じ人には、その運勢の文をひととおり出し切るまで同じ文を出しません。項目は運勢の向き（いい日・ふつうの日・よくない日）に合わせて選びます。どれも <strong>1 行に 1 つ</strong>（{OMIKUJI_LINE_MAX} 文字まで）。台紙は運勢ごとに入れられます（縦長 1:2 の PNG・JPEG）。台紙を入れると、BOT は紙や枠を描かずに、台紙の真ん中の無地のところを探して、その中に字だけ書きます（まわりを飾り、真ん中を明るい無地にしてください）。紙の見本は保存すると新しくなります。
      </p>
      {props.flash && <Flash code={props.flash} />}
      <form method="post" action="/settings/omikuji-texts" enctype="multipart/form-data" id="otexts-form" data-art-form>
        <Csrf session={props.session} />
        <div class="fields">
          <label class="field">
            <span>神社の名前（紙の上と印に出る。空なら「御神籤」だけ）</span>
            <input type="text" name="shrine" value={t.shrine} maxlength={8} />
          </label>
          <label class="field check">
            <input type="checkbox" name="slip" value="yes" {...(t.slip ? { checked: true } : {})} />
            <span>結果をおみくじの紙（画像）で出す（外すと、前のように文字だけ）</span>
          </label>
          <label class="field check">
            <input type="checkbox" name="shake" value="yes" {...(t.shake ? { checked: true } : {})} />
            <span>引いたとき「ガラガラ…」と少し待たせる（運営吉は、光る → 絵 → 紙 の順に出る）</span>
          </label>
        </div>

        <h3>運勢ごとの一言と台紙</h3>
        <div class="otexts-fortunes">
          {FORTUNE_KEYS.map((k) => {
            const f = FORTUNES.find((x) => x.key === k)!;
            return (
              <details class="otexts-fortune">
                <summary>
                  <strong>{f.name}</strong>（{t.messages[k].length} 文・出る確率 {f.weight}%）{props.bg[k] ? '・台紙あり' : ''}
                </summary>
                <div class="otexts-row">
                  <label class="field">
                    <span>一言（1 行 1 つ。第〇番は上からの順番）</span>
                    <textarea name={`msg.${k}`} rows={Math.min(16, Math.max(6, t.messages[k].length + 1))}>
                      {lines(t.messages[k])}
                    </textarea>
                  </label>
                  <BgSlot k={k} title={f.name} hash={props.bg[k]} />
                </div>
              </details>
            );
          })}
        </div>

        <h3>項目（運勢の向きごとの文）</h3>
        <p class="note">「毎日出す」の項目はいつも出ます。外した項目は、その中から毎日 1 つ。名前を空にすると、その項目は消えます（いちばん下の空の枠で、新しい項目を足せます）。</p>
        {items.map((it, n) => (
          <details class="otexts-item">
            <summary>{it.key ? `${it.emoji} ${it.label}${it.fixed ? '（毎日出す）' : '（日替わり）'}` : '＋ 新しい項目'}</summary>
            <input type="hidden" name={`item.${n}.key`} value={it.key} />
            <div class="fields">
              <label class="field">
                <span>名前（6 文字まで）</span>
                <input type="text" name={`item.${n}.label`} value={it.label} maxlength={6} />
              </label>
              <label class="field">
                <span>絵文字（文字だけで出すとき）</span>
                <input type="text" name={`item.${n}.emoji`} value={it.emoji} maxlength={8} />
              </label>
              <label class="field check">
                <input type="checkbox" name={`item.${n}.fixed`} value="yes" {...(it.fixed ? { checked: true } : {})} />
                <span>毎日出す</span>
              </label>
            </div>
            <div class="otexts-tones">
              {TONES.map((tone) => (
                <label class="field">
                  <span>{TONE_LABEL[tone]}</span>
                  <textarea name={`item.${n}.${tone}`} rows={7}>
                    {lines(it[tone])}
                  </textarea>
                </label>
              ))}
            </div>
          </details>
        ))}
        <label class="field">
          <span>🍀 ラッキー場所（運勢とは関係なし。空にすると出さない）</span>
          <textarea name="places" rows={6}>
            {lines(t.places)}
          </textarea>
        </label>

        <h3>🎴 運営吉の紙の台紙</h3>
        <p class="note">運営吉は、上の「運営吉」で入れた絵を大きく出したあとに、この紙を出します。台紙がなければ、その人の色で金の枠の特別な柄を描きます。</p>
        <div class="art-grid">
          {Array.from({ length: OMIKUJI_SPECIAL_MAX }, (_, i) => i + 1).map((n) => (
            <BgSlot k={`unei${n}`} title={sp.list[n - 1]?.name ?? `${n} 枠目（名前なし）`} hash={props.bg[`unei${n}`]} noPreview={!sp.list[n - 1]} />
          ))}
        </div>
        <div class="art-savebar">
          <span data-art-count>文・台紙をまとめて保存します。</span>
          <button type="submit" class="ok">
            保存する
          </button>
        </div>
      </form>
      <form method="post" action="/settings/omikuji-texts/reset" class="otexts-reset" data-confirm="一言・項目・ラッキー場所を、はじめの文に戻します（台紙と神社の名前はそのまま）。よいですか？">
        <Csrf session={props.session} />
        <button type="submit">
          はじめの文に戻す
        </button>
      </form>
      {Object.keys(props.bg).map((k) => (
        <form method="post" action={`/settings/omikuji-bg/${k}/delete`} id={`otexts-bgdel-${k}`} hidden>
          <Csrf session={props.session} />
        </form>
      ))}
    </section>
  );
}
