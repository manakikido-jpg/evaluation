import { html } from 'hono/html';
import { cards, playableCards } from '../../services/shinpu/engine.js';
import { assetUrl } from '../assets.js';

export function ShinpuTestPage({ csrf, name }: { csrf: string; name: string }) {
  const art = JSON.stringify(Object.fromEntries([...cards, ...playableCards].map((c) => [c.id,
    assetUrl(c.id.startsWith('SK-') ? `shinpu-catalog-thumbnails-${c.id}.webp` : `shinpu-card-${c.id}.webp`)])));
  const fullArt = JSON.stringify(Object.fromEntries([...cards, ...playableCards].map((c) => [c.id,
    assetUrl(c.id.startsWith('SK-') ? `shinpu-catalog-cards-${c.id}.webp` : `shinpu-card-${c.id}.webp`)])));
  return html`<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>神符合戦 | 咲楽ノ宮・遊べる試作版</title>
        <link rel="stylesheet" href="${assetUrl('shinpu.css')}" />
      </head>
      <body data-csrf="${csrf}" data-art="${art}" data-art-full="${fullArt}">
        <header>
          <div class="brand"><span class="crest" aria-hidden="true">✿</span><span>咲楽ノ宮 / 神符合戦</span></div>
          <nav><span class="tag">運営テスト</span><button data-dialog="rules">遊び方</button><button id="leave">部屋を退出</button></nav>
        </header>
        <main class="wrap" id="lobby">
          <section class="arena">
            <h1>運営テストの部屋</h1>
            <p>${name}さん、運営同士で対戦できます。足りない席は式神CPUに任せられます。</p>
            <p><a href="/casino/shinpu/cards">神器図鑑（237枚）を見る</a></p>
            <label for="count">対戦人数</label
            ><select id="count">
              <option value="2">2人</option>
              <option value="3">3人</option>
              <option value="4" selected>4人</option>
              <option value="5">5人</option>
              <option value="6">6人</option>
            </select>
            <div class="actions"><button class="primary" id="create">部屋を作る</button><button id="refresh">部屋の一覧を更新</button></div>
            <div id="room-list"></div>
          </section>
        </main>
        <main class="wrap" id="waiting" hidden>
          <section class="arena">
            <h1>運営の参加を待っています</h1>
            <p id="waiting-seats"></p>
            <label for="invite">部屋へのリンク（入場は運営のみ）</label><input id="invite" readonly />
            <div class="actions">
              <button id="copy">リンクをコピー</button><button class="primary" id="start">空いている席をCPUにして開始</button>
            </div>
            <p class="hint">作成者が開始できます。開始後の参加はできません。部屋は2時間で終了し、Webの再起動でも消えます。</p>
          </section>
        </main>
        <main class="wrap" id="game" hidden>
          <div class="intro">
            <div>
              <h2>札を重ねて、勝機をつかむ。</h2>
              <p>攻撃札を選ぶ → 相手を選ぶ →「攻撃する」。道具は1枚選んで使えます。</p>
            </div>
            <span class="statuspill" id="round"></span>
          </div>
          <section class="players" id="players" aria-label="参加者・攻撃対象"></section>
          <div class="board">
            <aside class="logbox">
              <h3>✿ 戦いの記録</h3>
              <div class="log" id="log"></div>
            </aside>
            <section class="arena battle-arena">
              <div class="battle-heading">
                <h1 id="phase"></h1>
                <span id="deadline" class="deadline" aria-live="off"></span>
              </div>
              <div id="summon-effect" class="summon-effect" role="status" aria-live="polite" hidden></div>
              <div class="selection-stage">
                <div id="selected-cards" class="selected-cards" aria-label="選んだ札"></div>
                <div class="calculation">
                  <h2 id="message"></h2>
                  <div class="summary" id="summary"></div>
                </div>
                <div id="target-preview" class="target-preview"></div>
              </div>
              <div class="actions">
                <button class="primary" id="main-action"></button><button id="clear-selection">↶ 選択を戻す</button
                ><button id="exchange-open">両替</button><button id="pass">様子を見る</button
                ><button class="log-toggle" data-dialog="history">記録</button>
              </div>
              <p class="muted" id="hint"></p>
              <fieldset id="card-options" hidden><legend>札の使い方</legend>
                <label id="heal-target-label" hidden>回復する人<select id="heal-target"></select></label>
                <label id="second-target-label" hidden>2人目の攻撃対象<select id="second-target"></select></label>
                <label id="element-label" hidden>選ぶ属性<select id="chosen-element"><option>火</option><option>水</option><option>風</option><option>雷</option><option>土</option><option>光</option><option>闇</option></select></label>
                <label id="optional-pay-label" hidden><input type="checkbox" id="optional-pay" /><span id="optional-pay-description">追加の霊銭・MPを払う</span></label>
              </fieldset>
              <section id="card-choice" hidden><h2 id="choice-label"></h2><div id="choice-cards" class="choice-cards"></div><p id="choice-count"></p></section>
            </section>
            <section class="handarea">
              <div class="handheading">
                <span id="hand-title">あなたの神器</span><span class="small">札を押して選択・もう一度押すと解除</span>
              </div>
              <div class="hand" id="hand" aria-label="あなたの手札"></div>
            </section>
          </div>
        </main>
        <div class="toast" id="toast" role="status" aria-live="polite"></div>
        <footer>
          神符合戦・運営テスト · 運営同士＋CPU / テスト専用<br />対戦内の「霊銭」はサーバーの銭と別です。本番の残高には影響しません。
        </footer>
        <dialog id="rules">
          <button class="close" data-close>閉じる</button>
          <h2>遊び方</h2>
          <div class="rule">
            <p>最後までHPが残った人の勝利。80手番に達すると残りHPで決着します（同点は引き分け）。</p>
            <ol>
              <li>自分の手番に通常の攻撃札を1枚まで選び、＋付きの攻撃札を追加できます。＋付きだけでも攻撃できます。上の相手を押して「攻撃する」。攻撃力とMP消費を合算します。</li>
              <li>攻撃されたら防御札を必要な枚数選び「この札で防御」。選ばず受けることもできます。</li>
              <li>回復や道具は1枚で使います。使用・両替・様子見で手番が進みます。</li>
              <li>自分の次の手番に手札が7枚まで補充されます。HP上限60、MP上限20、手札上限10。</li>
            </ol>
            <p class="hint">
              両替は霊銭4→MP4、霊銭4→HP8、MP3→霊銭4。火傷は次の自分の番の開始に2ダメージ・1回です。山札は札ごとの出現重みで用意し、なくなったら捨て札を混ぜます。札の選択も2分で時間切れとなり、サーバーが有効な候補を選んで進めます。
            </p>
            <p>実装済み：全237種類の札と特別札「式神を呼ぶ」。属性防御、条件付き攻撃、複数対象、反射、火傷、強化、回復、山札からの選択、霊銭での売買、手札交換、CPU対戦。</p>
            <p>
              「式神を呼ぶ」はMP3でHP10回復・継続ダメージ解除。aisか小林の式神が登場します。本人が同じ名前で参加していればDiscordアイコン、それ以外は仮の狐の肖像を表示します。
            </p>
            <p>同じ属性の防具はさらに2防ぎます。属性間の有利・不利、守護神、病気、チーム戦、9人対戦はこの237枚仕様には含みません。鈴音の連矢への防御は1枚までです。</p>
          </div>
        </dialog>
        <dialog id="card-detail"><button class="close" data-close>閉じる</button><h2 id="card-detail-title"></h2>
          <img id="card-detail-image" width="900" height="1200" alt="" /><p id="card-detail-text"></p>
        </dialog>
        <dialog id="exchange">
          <button class="close" data-close>閉じる</button>
          <h2>両替</h2>
          <p>1回の両替で手番が進みます。</p>
          <div class="exchange">
            <button data-exchange="mp">霊銭4 → MP4回復</button><button data-exchange="hp">霊銭4 → HP8回復</button
            ><button data-exchange="coin">MP3 → 霊銭4</button>
          </div>
          <p class="hint">試作用のレートです。サーバーの銭には影響しません。</p>
        </dialog>
        <dialog id="history">
          <button class="close" data-close>閉じる</button>
          <h2>対戦の記録</h2>
          <div class="log" id="history-log"></div>
        </dialog>
        <script src="${assetUrl('shinpu.js')}" defer></script>
      </body>
    </html>`;
}
