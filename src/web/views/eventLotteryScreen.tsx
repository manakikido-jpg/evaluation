import type {eventLotteryView} from '../../services/eventLottery.js';
import {assetUrl} from '../assets.js';

type Model=Awaited<ReturnType<typeof eventLotteryView>>;
export function eventLotteryScreenState(model:Model,now:Date,cursor?:{after?:string;focus?:string}){
 // 連続抽選や通信の復旧でも、共有画面が未表示の当選者を飛ばさない。
 let selected=model.results.at(-1);
 if(cursor?.focus)selected=model.results.find(r=>r.id===cursor.focus)??selected;
 else if(cursor?.after==='start')selected=model.results[0];
 else if(cursor?.after){const index=model.results.findIndex(r=>r.id===cursor.after);if(index>=0)selected=model.results[index+1]??model.results[index];}
 const revealed=!!selected&&selected.createdAt.getTime()+3000<=now.getTime();
 return {
  name:model.event.name,state:model.event.state,
  participants:model.participants.filter(p=>!p.refunded).length,
  winners:model.results.filter(r=>r.createdAt.getTime()+3000<=now.getTime()).length,
  draw:selected?{id:selected.id,prize:selected.prizeName,winner:revealed?selected.displayName:null,coins:revealed?selected.coins:null}:null,
 };
}
export type EventLotteryScreenState=ReturnType<typeof eventLotteryScreenState>;
export function eventLotteryDemoState():EventLotteryScreenState{return {name:'テスト抽選会',state:'closed',participants:8,winners:0,draw:null};}
export function EventLotteryScreen({state,endpoint,demo=false}:{state:EventLotteryScreenState;endpoint:string;demo?:boolean}){
 const stage=state.draw?(state.draw.winner===null?'drawing':'winner'):state.state==='cancelled'?'cancelled':state.state==='completed'?'ended':'waiting';
 const waiting=state.state==='open'?'ただいま参加受付中':state.state==='cancelled'?'このイベントは中止になりました':state.state==='completed'?'本日の抽選は終了しました':'まもなく抽選が始まります';
 return <html lang="ja"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="robots" content="noindex, nofollow"/><title>{state.name} · 抽選会</title><link rel="stylesheet" href={assetUrl('event-lottery-screen.css')}/><script src={assetUrl('event-lottery-screen.js')} defer/></head>
 <body class="els-body"><main class="els-screen" data-el-screen data-demo={demo?'true':undefined} data-endpoint={endpoint} data-initial={JSON.stringify(state)} data-stage={stage} data-long-name={String((state.draw?.winner?.length??0)>24)}>
  <header class="els-heading"><p>咲楽ノ宮 <span>祭事大抽選会</span></p><h1 data-screen-name>{state.name}</h1>{demo&&<p class="els-demo-badge">テストモード · 架空の参加者と景品</p>}</header>
  <div class="els-ornament" aria-hidden="true"><i/><i/><i/></div>
  <section class="els-stage" aria-label="当選発表"><p class="els-eyebrow" data-screen-label>{stage==='winner'?'ご当選':stage==='drawing'?'運命のひとくじ':['cancelled','ended'].includes(stage)?'お知らせ':'幸運を、あなたに'}</p>
   <h2 class="els-prize" data-screen-prize hidden={!state.draw}>{state.draw?.prize}</h2>
   <div class="els-waiting" data-screen-waiting hidden={!!state.draw}><strong data-screen-wait-title>{demo?'テストでくじを引いてみましょう':waiting}</strong><p data-screen-wait-note>{demo?'「テストで1回引く」を押すと演出が始まります':['cancelled','completed'].includes(state.state)?'ご参加ありがとうございました':'当選発表まで、そのままお待ちください'}</p></div>
   <div class="els-drawing" data-screen-drawing hidden={stage!=='drawing'} aria-label="くじを引いて開封中"><div class="els-lottery" aria-hidden="true"><div class="els-ticket"><b>福</b><small>もうすぐ発表</small><i class="els-ticket-fold"><span>封</span></i></div><div class="els-box"><b>福 引</b><small>幸運のひとくじ</small></div><svg class="els-hand" viewBox="0 0 80 80"><path d="M25 77 17 47Q15 37 22 34L29 48 24 18Q23 9 31 9Q36 9 37 17L42 37 42 9Q42 2 49 3Q55 4 54 11L52 38 58 20Q60 14 66 17Q71 20 68 26L61 48Q60 58 66 77Z"/></svg></div><strong class="els-draw-caption" aria-hidden="true"><span class="els-step-pull">くじを引いています…</span><span class="els-step-open">札を開いています…</span></strong><p>あなたに幸運が届きますように</p></div>
   <div class="els-winner" data-screen-winner hidden={stage!=='winner'} aria-live="polite" aria-atomic="true"><strong data-screen-winner-name>{state.draw?.winner}</strong><span class="els-honorific">さん</span><p class="els-coins" data-screen-coins hidden={!state.draw?.coins}><span data-screen-amount>{state.draw?.coins?.toLocaleString('ja-JP')}</span><small>銭</small></p><p class="els-congratulations">おめでとうございます</p></div>
   <div class="els-confetti" aria-hidden="true">{Array.from({length:18},()=> <i/>)}</div>
  </section>
  {demo&&<div class="els-demo-controls"><button type="button" data-screen-demo-draw>テストで1回引く</button><button type="button" data-screen-demo-reset>最初に戻す</button></div>}
  <footer class="els-footer"><p><span>参加</span><strong data-screen-participants>{state.participants}</strong><span>人</span><b>／</b><span>当選</span><strong data-screen-winners>{state.winners}</strong><span>人</span></p><p data-screen-footer>{demo?'練習用です。銭の増減・景品の消費・Discord発表はありません':state.state==='completed'?'ご参加ありがとうございました':'当選結果はDiscordでも発表します'}</p></footer>
  <div class="els-toolbar"><button type="button" data-screen-fullscreen>全画面</button></div><p class="els-connection" data-screen-connection hidden role="status"/>
 </main></body></html>;
}
