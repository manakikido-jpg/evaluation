import type {AdminSession} from '../../db/schema.js';
import type {RuleVersion} from '../../services/casino/gaisen/engine.js';
import {BET,UNIT} from '../../services/casino/gaisen/engine.js';
import {REEL_STRIPS,REEL_LABELS,canonicalPosition,reelRows,type ReelSymbol} from '../../services/casino/gaisen/reelRules.js';
import {SymbolArt} from './gaisenReels.js';
import {Layout} from './layout.js';
import {assetUrl} from '../assets.js';
const EXAMPLES:{title:string;symbols:ReelSymbol[];note:string}[]=[
 {title:'青7 · リプレイ',symbols:['blue7','blue7','blue7'],note:`${BET}ポイント返却。次の1ゲーム分が戻ります。`},
 {title:'黄7 · 15枚役の例',symbols:['gold7','gold7','gold7'],note:`正しい押し順で${15*UNIT}ポイント。黄7のリプレイも同じ形になるため、払出欄で確認します。`},
 {title:'黄7 · レア役の例',symbols:['gold7','blue7','gold7'],note:`${15*UNIT}ポイント。左から狙う役があります。`},
 {title:'宝石 · 3枚役の例',symbols:['crest','crest','crest'],note:`押し順と目押しが合えば${3*UNIT}ポイント。届かなければ取りこぼします。`},
 {title:'赤7 · SGG',symbols:['red7','red7','red7'],note:`新版はリプレイで${BET}ポイント返却、SGGへ。右からのナビはフェイクも含みます。`},
 {title:'GOD · 神降臨',symbols:['god','god','god'],note:`${15*UNIT}ポイントと基本GG5セット。獲得した内容は保存済みの結果で確認します。`},
];
export function GaisenGuide({session,version}:{session:AdminSession;version:RuleVersion}){
 const path=version==='trial-2'?'/economy/gaisen-trial-v2':'/economy/gaisen-trial';
 return <Layout title="神殿スロットのリール配列・打ち方" nav="casinotest" session={session}>
 <link rel="stylesheet" href={assetUrl('gaisen-trial.css')}/>
 <main class="gt-root gt-guide-page">
 <header class="gt-guide-head"><small>SAKURA · DIVINE PALACE</small><h1>リール配列と打ち方</h1><p>神殿スロット · {version==='trial-2'?'新版':'旧版の比較用'} / 運営限定の無料試遊</p><a href={path} class="gt-guide-back">試遊を開く</a></header>
 <nav class="gt-guide-nav" aria-label="ガイドの目次"><a href="#reel-chart">20コマ配列</a><a href="#how-to-play">打ち方</a><a href="#stop-patterns">停止形</a></nav>
 <p class="gt-guide-notice">独自の配列・制御です。実機の配列や制御表ではありません。<strong>有効ラインは中段のみ。</strong>上・下段や斜めの揃いには払いません。一般公開・銭への接続は保留中です。</p>
 <section id="reel-chart" class="gt-guide-section"><h2><span>01</span> リール配列表</h2><p>各リール20コマ。20→1の順に並べています。回転は下へ流れ、20番の次に1番が中段へ来ます。</p>
 <table class="gt-strip-chart"><caption>左・中・右の20コマ（停止窓と共通）</caption><thead><tr><th scope="col">番号</th>{['左','中','右'].map(s=><th scope="col">{s}リール</th>)}</tr></thead><tbody>{Array.from({length:20},(_,i)=>19-i).map(position=><tr><th scope="row">{position+1}</th>{REEL_STRIPS.map(strip=><td aria-label={REEL_LABELS[strip[position]!]!}><SymbolArt symbol={strip[position]!} lazy/></td>)}</tr>)}</tbody></table>
 </section>
 <section id="how-to-play" class="gt-guide-section"><h2><span>02</span> 通常時の打ち方</h2>
 <ol class="gt-guide-steps"><li><b>レバーでスタート</b><p>1ゲーム{BET}ポイント。通常時は左からSTOP。押し順ナビが出たら、その順番を優先します。</p></li><li><b>中段に来る絵柄を狙う</b><p>新版の「目押し・4コマ滑り」はSTOPに触れた瞬間（キー操作は押した瞬間）の位置を使います。成立役の絵柄を最大4コマ先まで引き込みます。見送ると別の周回の同じ絵柄が止まります。</p></li><li><b>停止位置と払出を確認</b><p>桜・宝石を使う小役は、範囲に届かなければ払出0。GOD・3色の7は各5コマ以内にあり、押し順が合えば引き込めます。画面下の「停止位置と滑り」で番号を見比べられます。</p></li></ol>
 <div class="gt-guide-order" role="img" aria-label="通常は左、中、右の順。ナビがあるときはナビを優先">{['左STOP','中STOP','右STOP'].map((s,i)=><div><b>{i+1}</b><span>{s}</span></div>)}</div>
 <p>G-STOPは上部の抽選を左→中→右で止めます。HOLD中は中だけ。下部リールは自動補助で、上部の数字とは別です。</p>
 <details><summary>自動補助と保存について</summary><p>設定→リール操作から「自動補助」を選べます。控えめ・即表示・端末の動き低減・JavaScriptなしも補助です。旧版と更新前の回転中データは従来の補助を続けます。補助では位置を合わせて停止し、目押しによる取りこぼしを作りません。</p><p>回転を開き直すと表示の回転位置は再開しますが、停止済みの番号・滑り・払出は保存済みのままです。</p></details>
 </section>
 <section id="stop-patterns" class="gt-guide-section"><h2><span>03</span> 主な停止形</h2><p>新版の成立・押し順・目押しが合った例です。同じ絵柄でも止まる番号は複数あります。上・下段は飾りではなく実際の隣のコマですが、有効ラインではありません。</p>
 <div class="gt-pattern-grid">{EXAMPLES.map(example=><article class="gt-pattern"><h3>{example.title}</h3><div class="gt-pattern-window" role="img" aria-label={'中段に'+example.symbols.map(s=>REEL_LABELS[s]).join('・')}>{example.symbols.map((symbol,reel)=><div>{reelRows(reel,canonicalPosition(reel,symbol)).map((s,row)=><div class={row===1?'gt-pattern-center':''}><SymbolArt symbol={s} lazy/></div>)}</div>)}</div><p>{example.note}</p></article>)}</div>
 <p class="gt-guide-notice">成立役の抽選と、狙った絵柄が止まることは別です。上部の当選演出だけでは小役の払出は決まりません。実際の払出・履歴は保存された結果が基準です。旧版は赤7の払出などが新版と異なります。</p>
 </section><a href={path} class="gt-guide-back">試遊へ戻る</a>
 </main></Layout>;
}
