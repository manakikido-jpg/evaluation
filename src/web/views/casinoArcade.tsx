import {ArcadeArt,ArcadeGlyph} from './casinoArcadeArt.js';
import {randomUUID} from 'node:crypto';
import type {CasinoConfig} from '../../config.js';
import {ARCADE_KINDS,ARCADE_LABELS,type ArcadeKind} from '../../domain/casinoArcade.js';
import {arcadeMaxBet,type ArcadeRound} from '../../services/casino/arcade.js';
import {FORTUNE_MULT,MONEY_MULT,PLINKO_MULT,POKER_PAYS,kenoMultipliers,ARCADE_PAYOUT_LIMIT} from '../../services/casino/arcadeRules.js';
import {CasinoLayout,PlayingCard,type CasinoMe} from './casino.js';
import {assetUrl} from '../assets.js';
const base='/casino/arcade',fmt=(n:number)=>n.toLocaleString('ja-JP'),mult=(n:number)=>(n/1000).toFixed(3).replace(/\.?0+$/,'')+'倍';
const fields=(me:CasinoMe,action:string,r?:ArcadeRound)=><><input type="hidden" name="_csrf" value={me.session.csrfToken}/><input type="hidden" name="operationId" value={randomUUID()}/><input type="hidden" name="action" value={action}/>{r&&<><input type="hidden" name="id" value={r.id}/><input type="hidden" name="version" value={r.version}/></>}</>;
export const ARCADE_EXISTING=[['roulette','🎡 ルーレット'],['blackjack','🃏 ブラックジャック'],['slots','🎰 スロット'],['highlow','🔼 ハイ＆ロー'],['baccarat','🎴 バカラ']] as const;
const money=(n:number,me:CasinoMe)=>`${fmt(n)} ${me.coin.name}`;
function History({rows,me}:{rows:ArcadeRound[];me:CasinoMe}){return <section class="ag-history"><h2>最近の結果と続き</h2>{rows.length?<div class="ag-scroll"><table><thead><tr><th>回</th><th>台</th><th>投入</th><th>戻り</th><th>状態</th></tr></thead><tbody>{rows.map(r=><tr><td>#{r.id}</td><td><a href={`${base}/${r.model.kind}?round=${r.id}`}>{ARCADE_LABELS[r.model.kind].name}</a></td><td>{money(r.bet,me)}</td><td>{r.status==='done'?money(r.payout,me):'未精算'}</td><td>{r.status==='done'?'確定':'続きから'}</td></tr>)}</tbody></table></div>:<p>まだ遊んでいません。</p>}</section>;}
const english=(kind:ArcadeKind)=>({fortune:'FORTUNE WHEEL',moneywheel:'MONEY WHEEL',craps:'STREET CRAPS',duckrace:'DUCK RACE',crash:'CRASH',plinko:'PLINKO',penguin:'PENGUIN CROSS',keno:'KENO',videopoker:'VIDEO POKER',tower:'DRAGON TOWER',mines:'MINES'}[kind]);
const categories:Record<ArcadeKind,string>={fortune:'ホイール',moneywheel:'ホイール',craps:'ダイス',duckrace:'レース',crash:'タイミング',plinko:'ボールドロップ',penguin:'ステップ',keno:'ナンバー',videopoker:'カード',tower:'ステップ',mines:'宝石探し'};
export function ArcadeHub({me,c,rows}:{me:CasinoMe;c:CasinoConfig;rows:ArcadeRound[]}){
 const active=rows.find(r=>r.status==='playing'),order:ArcadeKind[]=['plinko','fortune','mines','duckrace','crash','videopoker','moneywheel','craps','penguin','keno','tower'];
 return <CasinoLayout title="新しいカジノ台" me={me} wide><link rel="stylesheet" href={assetUrl('casino-arcade.css')}/><main class="ag-root ag-lobby">
 <header class="ag-head"><div><small>SAKURA CASINO / THE ARCADE</small><h1>今夜は、どの台へ。</h1><p>真鍮の灯りの下で、11種類の勝負を。</p></div><a class="ag-back" href="/casino/hall">カジノへ戻る ↗</a></header>
 <div class="ag-lobby-line"><span>咲楽の遊技回廊</span><span>11 GAMES <i/> {fmt(me.balance)} {me.coin.name}</span></div>
 <p class="ag-notice">実際に{me.coin.name}を賭けます。配当・確率は咲楽ノ宮版の独自設定です。各台の表を確認してから遊んでください。</p>
 {active&&<p class="ag-active">進行中：<a href={`${base}/${active.model.kind}?round=${active.id}`}>{ARCADE_LABELS[active.model.kind].name} #{active.id} を続ける</a> · 先にこの回を終えると次の台へ進めます。</p>}
 <div class="ag-gallery">{order.map((k,i)=><a href={`${base}/${k}`} class={`ag-card ag-theme-${k} ${i===0?'ag-featured':''}`}><div class="ag-card-visual"><span class="ag-card-category">{categories[k]}</span><ArcadeArt kind={k}/><div class="ag-card-wordmark">{english(k)}</div><span class="ag-card-number">{String(i+1).padStart(2,'0')} / 11</span></div><div class="ag-card-info"><div><h2>{ARCADE_LABELS[k].name}</h2><p>{ARCADE_LABELS[k].note}</p><small>{c.games.includes('arcade')&&c.arcadeGames.includes(k)?`${fmt(c.minBet)}〜${fmt(arcadeMaxBet(c.maxBet,k))} ${me.coin.name}`:'新規受付はお休み中'}</small></div><b aria-label="台を開く">↗</b></div></a>)}</div>
 <section class="ag-existing"><h2>いつもの勝負も、こちらから。</h2>{ARCADE_EXISTING.filter(([id])=>c.games.includes(id)).map(([id,label])=><a href={'/casino/'+id}>{label}</a>)}</section><History rows={rows} me={me}/></main></CasinoLayout>;
}
function Wheel({kind}:{kind:'fortune'|'moneywheel'}){
 const colors=['#9f4c3f','#266957','#c2a363','#342e4e'],count=kind==='fortune'?10:40;
 const fill=(i:number)=>kind==='fortune'?colors[i%4]:colors[i<20?0:i<30?1:i<35?2:3];
 return <div class="ag-wheel-wrap"><i class="ag-pointer"/><svg viewBox="0 0 440 440" class="ag-wheel" data-ag-wheel role="img" aria-label="ホイールの盤面"><defs><linearGradient id="ag-wheel-rim" x2=".65" y2="1"><stop stop-color="#fff0bc"/><stop offset=".25" stop-color="#ae8143"/><stop offset=".48" stop-color="#ead096"/><stop offset=".7" stop-color="#60472c"/><stop offset="1" stop-color="#ceae6d"/></linearGradient><radialGradient id="ag-wheel-shade"><stop stop-color="#fff4c4" stop-opacity=".25"/><stop offset=".65" stop-opacity="0"/><stop offset="1" stop-opacity=".5"/></radialGradient></defs><circle cx="220" cy="220" r="216" fill="url(#ag-wheel-rim)"/><circle cx="220" cy="220" r="198" fill="#122d28" stroke="#0c1514" stroke-width="7"/>{Array.from({length:count},(_,i)=>{const a=(i/count*2*Math.PI)-Math.PI/2,b=((i+1)/count*2*Math.PI)-Math.PI/2,x=(a+b)/2;return <g><path d={`M220 220L${220+190*Math.cos(a)} ${220+190*Math.sin(a)}A190 190 0 0 1 ${220+190*Math.cos(b)} ${220+190*Math.sin(b)}Z`} fill={fill(i)} stroke="#edce9077" stroke-width="1"/>{kind==='fortune'&&<text x={220+146*Math.cos(x)} y={225+146*Math.sin(x)} text-anchor="middle">{mult(FORTUNE_MULT[i]!)}</text>}</g>;})}<circle cx="220" cy="220" r="190" fill="url(#ag-wheel-shade)"/>{Array.from({length:40},(_,i)=><circle cx={220+207*Math.cos(i*Math.PI/20)} cy={220+207*Math.sin(i*Math.PI/20)} r="3" fill="#ffedb2"/>)}<circle cx="220" cy="223" r="46" fill="#071c19"/><circle cx="220" cy="220" r="43" fill="url(#ag-wheel-rim)"/><circle cx="220" cy="220" r="32" fill="#193b31" stroke="#f2d99a"/><path d="m220 199 5 16 16 5-16 5-5 16-5-16-16-5 16-5Z" fill="#e6c787"/></svg></div>;
}
function Plinko({r}:{r?:ArcadeRound}){return <svg class="ag-plinko" viewBox="0 0 480 520" role="img" aria-label="9段のピンと10個のポケット">
 <defs><linearGradient id="ag-plinko-brass" x2=".6" y2="1"><stop stop-color="#fff1ba"/><stop offset=".3" stop-color="#8c6938"/><stop offset=".5" stop-color="#e9c989"/><stop offset="1" stop-color="#513c25"/></linearGradient><radialGradient id="ag-plinko-ivory" cx=".3" cy=".2"><stop stop-color="#fffef2"/><stop offset=".5" stop-color="#f5deb2"/><stop offset="1" stop-color="#ad8953"/></radialGradient><radialGradient id="ag-plinko-felt"><stop stop-color="#245c4d"/><stop offset="1" stop-color="#0a2825"/></radialGradient><filter id="ag-plinko-shadow" x="-1" y="-1" width="3" height="3"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".6"/></filter></defs>
 <path d="M211 9H269L454 432V511H26V432Z" fill="#061c1a" stroke="url(#ag-plinko-brass)" stroke-width="7"/>
 <path d="M215 19H265L442 433H38Z" fill="url(#ag-plinko-felt)" stroke="#d6b57c44" stroke-width="1"/>
 <path d="M215 20 37 434M265 20 443 434" fill="none" stroke="#edca8a55" stroke-width="2"/>
 <text x="240" y="331" text-anchor="middle" class="ag-plinko-watermark">SAKURA</text><text x="240" y="352" text-anchor="middle" class="ag-plinko-submark">P L I N K O  C L U B</text>
 {Array.from({length:9},(_,row)=>Array.from({length:row+1},(_,i)=>{const x=240+(2*i-row)*20,y=75+row*43;return <g><ellipse cx={x+1} cy={y+5} rx="7" ry="5" fill="#020d0b" opacity=".7"/><circle cx={x} cy={y} r="5.5" fill="url(#ag-plinko-brass)"/><circle cx={x-1} cy={y-2} r="1.6" fill="#fff2c0"/></g>;}))}
 {PLINKO_MULT.map((n,i)=><g data-ag-pocket={i} data-win={String(r?.model.index===i)}><rect x={40+i*40} y="451" width="40" height="54" rx="4" fill={i<2||i>7?'#743e31':i<4||i>5?'#7b6236':'#245847'} stroke="url(#ag-plinko-brass)" stroke-width="1.5"/><path d={`M${44+i*40} 500H${76+i*40}`} stroke="#030f0c" stroke-width="3"/><text x={60+i*40} y="480" text-anchor="middle">{mult(n)}</text><circle cx={60+i*40} cy="491" r="2" fill="#e4c180"/></g>)}
 <circle cx="240" cy="25" r="9" fill="url(#ag-plinko-ivory)" filter="url(#ag-plinko-shadow)" data-ag-ball/>
 </svg>;}
function Dice({n}:{n:number}){const dots:Record<number,[number,number][]>={1:[[50,50]],2:[[25,25],[75,75]],3:[[25,25],[50,50],[75,75]],4:[[25,25],[75,25],[25,75],[75,75]],5:[[25,25],[75,25],[50,50],[25,75],[75,75]],6:[[25,25],[75,25],[25,50],[75,50],[25,75],[75,75]]};return <svg viewBox="0 0 100 100" class="ag-die" role="img" aria-label={'サイコロ '+n}><rect x="2" y="7" width="96" height="91" rx="15" fill="#9f8d65"/><rect x="2" y="2" width="96" height="91" rx="15" fill="#e8dfbd" stroke="#fff5d1" stroke-width="2"/>{dots[n]?.map(([x,y])=><g><circle cx={x} cy={y} r="8" fill="#20372b"/><path d={`M${x-4} ${y+3}Q${x} ${y+7} ${x+4} ${y+3}`} fill="none" stroke="#8a9a72" stroke-width="1"/></g>)}</svg>;}
function RuleTable({kind}:{kind:ArcadeKind}){
 return <details class="ag-rules"><summary>遊び方・確率・配当表</summary><p>倍率は投入した銭を含みます。1銭未満は切り捨て。1回の払戻上限は{fmt(ARCADE_PAYOUT_LIMIT)}銭で、上限を超えない賭け額に制限します。新しい賭けは1秒間隔です。</p>
 {kind==='fortune'&&<><p>10区画は同じ確率で止まります。</p><p>{FORTUNE_MULT.map((n,i)=><span>区画{i+1}：{mult(n)}　</span>)}</p><p>丸め前の期待払戻は95%。</p></>}
 {kind==='moneywheel'&&<><p>赤50%・青緑25%・金12.5%・紫12.5%。選んだ色に止まると払い戻します。</p><p>{MONEY_MULT.map((n,i)=><span>{['赤','青緑','金','紫'][i]}：{mult(n)}　</span>)}</p><p>丸め前の期待払戻は95%。</p></>}
 {kind==='craps'&&<p>公平なサイコロ2個。初投7/11は2倍、2/3/12は0。他はポイントとなり、次からポイントで2倍、7で0、他は振り直しです。ちんちろとは別のルールです。</p>}
 {kind==='duckrace'&&<p>5羽は同じ確率で1着になります。的中は4.85倍、はずれは0。丸め前の期待払戻は97%。</p>}
 {kind==='plinko'&&<><p>9段で左右を各1/2で抽選します。軌道とポケットはサーバーで確定してから表示します。</p><p>左から：{PLINKO_MULT.map(n=>mult(n)).join(' / ')}。</p><p>丸め前の期待払戻は約94.95%。</p></>}
 {kind==='mines'&&<p>25マスに地雷3個。安全なマスを1つ以上開けば途中で受け取れます。地雷は0、全22マス成功は自動受取。成功k回の倍率は0.97÷（22個からk個を選ぶ組合せ÷25個からk個を選ぶ組合せ）、上限1,000倍です。地雷は毎回の開始時に固定されます。</p>}
 {kind==='tower'&&<p>各階3マスに危険1個。成功率は各階2/3、9階まで。1階以上進むと途中受取でき、9階成功は自動受取。k階の倍率は0.97÷(2/3)のk乗です。</p>}
 {kind==='penguin'&&<p>道は8本、各道の成功率80%。1本以上進むと途中受取でき、全て渡ると自動受取。k本の倍率は0.97÷0.8のk乗です。</p>}
 {kind==='crash'&&<p>倍率は約7秒でe倍に増え、最大100倍。破裂点は開始時に非公開で確定します。1倍で破裂する確率は約3%、1倍を超えるm倍まで生き残る確率は約0.97÷m。受取はサーバーが操作を受け付けた時点の倍率で決まり、破裂後は0です。100倍に生き残ると自動受取できます。再読込しても時間は戻りません。</p>}
 {kind==='videopoker'&&<><p>52枚から重複なしで5枚。残す札を選び、1回交換。Aはストレートの上端/下端に使えます。ワンペアはJ以上のみです。</p><table><tbody>{POKER_PAYS.map(([name,n])=><tr><th>{name}</th><td>{n}倍</td></tr>)}</tbody></table></>}
 {kind==='keno'&&<><p>40個から1〜10個選び、重複なしで10個を抽選します。一致数の4乗に比例する独自の表です。丸め前の期待払戻は97%。</p>{Array.from({length:10},(_,i)=>i+1).map(k=><details><summary>{k}個選ぶ場合</summary><p>{kenoMultipliers(k).map((n,h)=><span>{h}個一致：{mult(n)}　</span>)}</p></details>)}</>}
 </details>;
}
export function ArcadePage({me,c,kind,round,rows,active,error}:{me:CasinoMe;c:CasinoConfig;kind:ArcadeKind;round?:ArcadeRound;rows:ArcadeRound[];active?:ArcadeRound;error?:string}){
 const label=ARCADE_LABELS[kind],r=round,m=r?.model,playing=r?.status==='playing',path=`${base}/${kind}`,max=arcadeMaxBet(c.maxBet,kind),enabled=c.games.includes('arcade')&&c.arcadeGames.includes(kind),busy=active&&active.id!==r?.id;
 const move=(action:string)=>fields(me,action,r),collect=['mines','tower','penguin','crash'].includes(kind),canCollect=playing&&(kind==='crash'||!!m?.step),amount=playing&&m?Math.floor(r.bet*m.mult/1000):0;
 return <CasinoLayout title={label.name} me={me} wide><link rel="stylesheet" href={assetUrl('casino-arcade.css')}/><script src={assetUrl('casino-arcade.js')} defer/>
 <section class={`ag-root ag-theme-${kind}`} data-casino-arcade data-ag-build={assetUrl('casino-arcade.js').split('?v=')[1]} data-ag-model={m?JSON.stringify(m):undefined} data-ag-round={r?.id} data-ag-version={r?.version} data-ag-bet={r?.bet} data-ag-currency={me.coin.name} data-ag-done={String(!!m?.done)} data-ag-kind={kind}>
 <header class="ag-head"><div><small>SAKURA CASINO / {categories[kind]}</small><h1>{label.name}</h1><p>{label.note}</p></div><a class="ag-back" href={base}>台の一覧へ ↗</a></header>
 <p class="ag-notice">{me.coin.name}を賭ける正式版 · 配当・確率は咲楽ノ宮版の独自設定です。</p>{error&&<p class="ag-error" role="alert">{error}</p>}{!enabled&&<p class="ag-active">新しい賭けの受付はお休み中です。進行中の回は精算できます。</p>}{busy&&<p class="ag-active"><a href={`${base}/${active!.model.kind}?round=${active!.id}`}>進行中の{ARCADE_LABELS[active!.model.kind].name}を先に終えてください。</a></p>}
 <div class="ag-play-layout"><div class="ag-machine"><div class="ag-marquee"><span>SAKURA</span><strong>{english(kind)}</strong><span>No. {String(ARCADE_KINDS.indexOf(kind)+1).padStart(2,'0')}</span></div><div class="ag-stage">
 {['fortune','moneywheel'].includes(kind)&&<Wheel kind={kind as 'fortune'|'moneywheel'}/>}
 {kind==='plinko'&&<Plinko r={r}/>}
 {kind==='duckrace'&&<div class="ag-race">{Array.from({length:5},(_,i)=><div class="ag-race-lane"><b>{i+1}</b><span data-ag-duck={i} aria-label={(i+1)+'番のアヒル'}><ArcadeGlyph kind="duck"/></span></div>)}</div>}
 {kind==='crash'&&<div class="ag-crash"><strong data-ag-crash-mult>{mult(m?.mult??1000)}</strong><span class="ag-rocket" data-ag-rocket><ArcadeGlyph kind="rocket"/></span><small>受取はサーバー受付時の倍率で確定</small><p data-ag-connection role="status"/></div>}
 {kind==='craps'&&<div class="ag-dice"><p>ポイント：{m?.point||'未設定'}</p><div>{(m?.rolls.at(-1)??[1,1]).map(n=><Dice n={n}/>)}</div><small>直近：{m?.rolls.map(a=>a.join('+')).join(' / ')||'振ってスタート'}</small></div>}
 {kind==='mines'&&<form method="post" action={path} class="ag-mines">{move('pick')}{Array.from({length:25},(_,i)=><button type="submit" name="choice" value={i} data-ag-cell={i} data-state={m?.board?.[i]??'hidden'} disabled={!playing||m?.board?.[i]!=='hidden'} aria-label={(i+1)+'番のマス '+(m?.board?.[i]??'未開封')}>{m?.board?.[i]==='safe'?<ArcadeGlyph kind="gem"/>:m?.board?.[i]==='bomb'?<ArcadeGlyph kind="bomb"/>:<><span class="ag-tile-mark">✦</span><small>{String(i+1).padStart(2,'0')}</small></>}</button>)}</form>}
 {kind==='tower'&&<div class="ag-tower">{Array.from({length:9},(_,j)=>8-j).map(level=><div class={m?.step===level?'current':''}><b>{level+1}F</b>{[0,1,2].map(col=><span class={m?.selected[level]===col?'selected':''}>{m?.selected[level]===col?<ArcadeGlyph kind={level<(m?.step??0)?'gem':'dragon'}/>:<i>✧</i>}</span>)}</div>)}</div>}
 {kind==='penguin'&&<div class="ag-crossing">{Array.from({length:9},(_,j)=>8-j).map(level=><div><b>{level===0?'出発':level+'本目'}</b><span>{m?.step===level?<ArcadeGlyph kind="penguin"/>:level>0?<ArcadeGlyph kind="car"/>:<i class="ag-start-mark">START</i>}</span><i/></div>)}</div>}
 {kind==='videopoker'&&<form method="post" action={path} class="ag-poker">{move('draw')}<div>{Array.from({length:5},(_,i)=><label class="ag-hold">{m?.hand[i]!==undefined?<PlayingCard c={m.hand[i]!}/>:<span class="pc back"/>}<input type="checkbox" name="picks" value={i} checked={!playing&&m?.selected.includes(i)} disabled={!playing}/><span>残す</span></label>)}</div>{playing&&<button type="submit">選んだ札を残して交換する</button>}</form>}
 {kind==='keno'&&<div class="ag-keno-result">{Array.from({length:40},(_,i)=>i+1).map(n=><span data-hit={String(!!m?.shown.includes(n))} data-picked={String(!!m?.selected.includes(n))}>{n}</span>)}</div>}
 </div>
 {r&&<section class="ag-result" role="status" data-win={String(r.status==='done'&&r.payout>0)}><small>第{r.id}回 · {r.status==='done'?'結果確定':'進行中'} · 投入 {money(r.bet,me)}</small><h2>{m?.result}</h2>{m&&['moneywheel','duckrace'].includes(kind)&&<p>賭けた対象：{kind==='moneywheel'?['赤','青緑','金','紫'][m.selected[0]??0]:(m.selected[0]!+1)+'番のアヒル'}</p>}<strong>{r.status==='done'?money(r.payout,me)+' 戻り':collect?<span>現在 <b data-ag-current-mult>{mult(m?.mult??0)}</b> · 受取予定 <b data-ag-current-pay>{money(amount,me)}</b></span>:'次の操作を選んでください'}</strong></section>}
 {playing&&<div class="ag-turn-actions">
 {kind==='tower'&&<form method="post" action={path}>{move('pick')}<p>{m!.step+1}階で進むマスを選ぶ</p>{[0,1,2].map(i=><button type="submit" name="choice" value={i}>{['左','中央','右'][i]}</button>)}</form>}
 {kind==='penguin'&&<form method="post" action={path}>{move('step')}<button type="submit">次の道へ進む</button></form>}
 {kind==='craps'&&<form method="post" action={path}>{move('roll')}<button type="submit">サイコロを振る</button></form>}
 {collect&&<form method="post" action={path} data-ag-collect>{move('collect')}<button type="submit" disabled={!canCollect}>途中で受け取る</button></form>}
 {kind==='crash'&&<form method="post" action={path} data-ag-settle hidden>{move('settle')}<button>結果を確定する</button></form>}
 <form method="post" action={path} class="ag-forfeit">{move('giveup')}<button type="submit">この回を終了（戻り0）</button></form>
 </div>}
 </div><aside>
 <section class="ag-wager"><div class="ag-console-label"><span>PLAYER CONSOLE</span><i/></div><h2>{playing?'この回の投入':'投入額を決める'}</h2>{playing?<p>{money(r!.bet,me)} 投入済み。再読込しても同じ回を続けます。</p>:<form method="post" action={path} data-ag-start>{fields(me,'start')}<label>賭ける{me.coin.name}<input type="number" name="bet" min={c.minBet} max={max} step="1" value={Math.max(c.minBet,Math.min(100,max,me.balance))} required/></label>
 {kind==='moneywheel'&&<fieldset><legend>賭ける色</legend>{MONEY_MULT.map((n,i)=><label><input type="radio" name="choice" value={i} checked={i===0}/>{['赤','青緑','金','紫'][i]} {mult(n)}</label>)}</fieldset>}
 {kind==='duckrace'&&<fieldset><legend>応援するアヒル</legend>{[0,1,2,3,4].map(i=><label><input type="radio" name="choice" value={i} checked={i===0}/>{i+1}番</label>)}</fieldset>}
 {kind==='keno'&&<fieldset><legend>1〜10個選ぶ</legend><div class="ag-keno-picks">{Array.from({length:40},(_,i)=>i+1).map(n=><label><input type="checkbox" name="picks" value={n}/><span>{n}</span></label>)}</div><small data-ag-keno-count>選択 0 / 10個</small></fieldset>}
 <button type="submit" disabled={!enabled||!!busy||max<c.minBet||me.balance<c.minBet}>{me.coin.name}を賭けて開始</button><p class="ag-wager-note">{fmt(c.minBet)}〜{fmt(max)} {me.coin.name}。開始時に残高から引き、確定した払戻だけが戻ります。</p></form>}</section>
 <RuleTable kind={kind}/><p class="ag-help">表示は保存済みの結果に合わせた演出です。画面の動きは払戻を変えません。通信に失敗したときは再び賭けず、<a href={r?`${path}?round=${r.id}`:path}>この回の状態を確認</a>してください。</p>
 </aside></div><History rows={rows} me={me}/>
 </section></CasinoLayout>;
}
