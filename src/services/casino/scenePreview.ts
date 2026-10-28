import { CASINO_GAMES, type CasinoGame } from '../../config.js';
import { roomRng } from './roomPreview.js';
import { shuffledShoe } from './cards.js';
import { bacDeal } from './baccarat.js';
import { bjStart, bjStand, handValue } from './blackjack.js';
import { rollTurn, turnHand, handName as diceName } from './chinchiro.js';
import { initialBoard, legalMoves, applyMove, nextTurn, countStones, type Stone } from './othello.js';
import { stopsFor, REELS, judge, SLOT_SYMBOLS, PAYLINES } from './slots.js';
import { bestHand, handName } from './tables/pokerHands.js';

export type SceneFamily = 'blackjack'|'highlow'|'baccarat'|'roulette'|'slots'|'atslot'|'dice'|'othello'|'poker'|'daifugo'|'babanuki'|'mahjong'|'keiba'|'life';
type SceneSpec = {name:string;room:string;family:SceneFamily;art:'roulette'|'blackjack'|'highlow'|'slots'|'salon'|'club';group:'solo'|'table';seats:number;steps:[string,string,string,string];note:string};
const cardSteps:[string,string,string,string]=['着席','配札','オープン','結果'];
const solo=(name:string,room:string,family:SceneFamily,art:SceneSpec['art'],note:string,steps=cardSteps):SceneSpec=>({name,room,family,art,note,group:'solo',seats:0,steps});
const table=(base:SceneSpec,name:string,seats:number):SceneSpec=>({...base,name,group:'table',seats});
const bj=solo('ブラックジャック','花灯りの奥座敷','blackjack','blackjack','伏せ札から合計・勝敗へ、視線を卓の中央に集めます。');
const bac=solo('バカラ','紫苑の貴賓室','baccarat','salon','プレイヤーとバンカーを左右に置き、開いたカードと点数を強調します。');
const rl=solo('ルーレット','夜桜の迎賓館','roulette','roulette','BET対象の金色の光が円盤と回り、出た数字を白く照らします。',['BET','回転','停止','結果']);
const dice=solo('ちんちろ','月見の賽座敷','dice','club','どんぶりに落ちる賽と、決まった役を大きく見せます。',['構える','振る','目を確認','役']);
const ot=solo('オセロ','碧月の対局室','othello','club','置ける場所・最後の一手・石の反転を分けて伝えます。',['対局前','手番','石の反転','終局']);
export const GAME_SCENES:Record<CasinoGame,SceneSpec>={
 blackjack:bj,highlow:solo('ハイ＆ロー','狐面の勝負処','highlow','highlow','次のカードと灯籠の連勝記録を同じ視線に置きます。',['構える','選ぶ','カードを開く','連勝']),baccarat:bac,roulette:rl,
 slots:solo('スロット','桜灯の遊技殿','slots','slots','回るリール・STOP・揃ったライン・ランプを順番に見せます。',['着席','回す','STOP','結果']),
 atslot:solo('白狐ATスロット','白狐の祭殿','atslot','slots','押し順とリールを読みやすくし、液晶の場面と告知を連動させます。',['着席','押し順','STOP','告知']),
 chinchiro:dice,othello:ot,versus:{...ot,name:'メンバー対戦',group:'table',seats:2,note:'ふたりの席と現在の手番を表示する、オセロ対戦の演出見本です。'},
 bj_table:table(bj,'ブラックジャック卓',5),baccarat_table:table(bac,'バカラ卓',8),roulette_table:table(rl,'ルーレット卓',8),chinchiro_table:table(dice,'ちんちろ卓',6),
 poker:{...solo('ポーカー','夜藤の勝負席','poker','salon','手札・共有カード・ポット・現在の手番をまとめた卓。伏せた相手のカードはオープン段階で見せます。',['着席','フロップ','リバー','ショーダウン']),group:'table',seats:6},
 daifugo:{...solo('大富豪','金扇の遊戯室','daifugo','salon','場のカード・自分の手札・手番と順位を分けて見せます。',['着席','手番','カードを出す','順位']),group:'table',seats:5},
 babanuki:{...solo('ババ抜き','月兎の遊戯室','babanuki','salon','引く相手の手札と、揃ったペアへ視線を誘導します。',['着席','カードを引く','ペア成立','順位']),group:'table',seats:4},
 mahjong:{...solo('麻雀','咲楽ノ宮雀荘','mahjong','club','牌の厚み、手牌と河、手番と和了の表示を揃えます。',['配牌','手番','ツモ','和了表示']),group:'table',seats:4},
 keiba:{...solo('みんなでダービー','咲楽ノ宮競馬場','keiba','roulette','出走・追走・ゴール・確定結果を中継の雰囲気で繋ぎます。既存の3D試遊にも移れます。',['出走前','レース','ゴール','結果']),group:'table',seats:0},
 life:{...solo('人生ゲーム','桜めぐりの旅路','life','club','立体的な旅の盤と、現在地・できごと・ゴールの記録を見せます。',['出発','サイコロ','できごと','ゴール']),group:'table',seats:4},
};
/** 固定の演出見本。対戦・賭け・報酬は発生せず、関数の判定結果を表示するだけ。 */
export function scenePreview(q:URLSearchParams){
 const key=q.get('game')??'baccarat';if(!CASINO_GAMES.includes(key as CasinoGame))throw Error('ゲームを選び直してください。');
 const raw=q.get('sample')??'1';if(!/^[123]$/.test(raw))throw Error('見本を選び直してください。');
 const stage=q.get('stage')??'0';if(!/^[0-3]$/.test(stage))throw Error('場面を選び直してください。');
 const game=key as CasinoGame,sample=Number(raw),spec=GAME_SCENES[game],rng=roomRng(300+sample),shoe=shuffledShoe(1,rng);
 const bj=bjStand(bjStart(roomRng(sample))),bac=bacDeal(roomRng(sample)),rolls=rollTurn(roomRng(sample)),stops=stopsFor(sample===2?'none':'grape',rng);
 const poker={hand:shoe.slice(0,2),other:shoe.slice(2,4),board:shoe.slice(4,9)};
 const hero=bestHand([...poker.hand,...poker.board]),villain=bestHand([...poker.other,...poker.board]);
 let board=initialBoard(),turn:Stone|null='B';const positions=[board],lastMoves:number[]=[];
 for(let i=0;i<60&&turn;i++){const moves=legalMoves(board,turn);if(!moves.length)break;const move=moves[rng(moves.length)]!;board=applyMove(board,turn,move)!;lastMoves.push(move);positions.push(board);turn=nextTurn(board,turn);}
 return {game,sample,stage:Number(stage),spec,cards:shoe,bj:{player:bj.player,dealer:bj.dealer,result:bj.result,playerTotal:handValue(bj.player).total,dealerTotal:handValue(bj.dealer).total},bac,
 dice:{dice:rolls.at(-1)!.dice,label:diceName(turnHand(rolls))},slots:{stops,keys:stops.map((stop,i)=>[-1,0,1].map(row=>REELS[i]![(stop+row+21)%21]!)),grid:stops.map((stop,i)=>[-1,0,1].map(row=>SLOT_SYMBOLS[REELS[i]![(stop+row+21)%21]!].emoji)),role:judge(stops).role,lineRows:PAYLINES[judge(stops).line]?.rows},
 poker:{...poker,label:handName(hero.score),result:hero.score>villain.score?'あなたの勝ち':hero.score===villain.score?'引き分け':'相手の勝ち'},
 othello:{positions,lastMoves,counts:countStones(board)},
 };
}
export type ScenePreview=ReturnType<typeof scenePreview>;

export type SceneOutcome='win'|'lose'|'draw'|'neutral'|'demo';
/** 勝敗のある見本だけ実際の判定で分ける。装飾の進行を本物の勝ちにしない。 */
export function sceneOutcome(m:ScenePreview):SceneOutcome{
 switch(m.spec.family){
  case 'blackjack': return m.bj.result==='push'?'draw':m.bj.result==='win'||m.bj.result==='blackjack'?'win':'lose';
  case 'slots':return m.slots.role==='none'?'lose':'win';
  case 'othello':return m.othello.counts.B===m.othello.counts.W?'draw':m.othello.counts.B>m.othello.counts.W?'win':'lose';
  case 'poker':return m.poker.result==='あなたの勝ち'?'win':m.poker.result==='引き分け'?'draw':'lose';
  case 'baccarat':case 'dice':return 'neutral';
  default:return 'demo';
 }
}
export const SCENE_CUES:Record<SceneFamily,[string,string,string,string]>={
 blackjack:['静かな卓に、カードが届く。','最後の1枚を待つひととき。','カード、オープン。','勝負の余韻を、卓の上に。'],
 highlow:['狐面の勝負師と向かい合う。','上か、下か。次のカードへ。','運命の1枚を、開く。','灯籠が照らす、連勝の見本。'],
 baccarat:['貴賓室に、ふたつの手札。','プレイヤーか、バンカーか。','両者のカードを、オープン。','数字が揃い、勝負は決着。'],
 roulette:['金色の光に、願いを乗せる。','玉の行方を、目で追う。','ゆっくりと、停止の瞬間へ。','出た数字を、白い光で。'],
 slots:['桜灯の遊技席へようこそ。','3つのリールが、走り出す。','最後のSTOP、その瞬間。','揃った段を、光で確かめる。'],
 atslot:['月夜の祭殿に、白狐の気配。','押し順に合わせて、ひとつずつ。','リールが止まり、場面が変わる。','白狐の告知演出を体験。'],
 dice:['賽を構え、息を合わせる。','どんぶりに響く、3つの音。','跳ねた賽が、静かに止まる。','決まった役を、大きく見せる。'],
 othello:['盤を挟んで、向かい合う。','一手を選ぶ、静かな緊張。','石が返り、景色が変わる。','最後の石まで、見届ける。'],
 poker:['夜藤の席で、勝負を待つ。','共有カードに、視線が集まる。','最後の1枚、リバー。','ショーダウン。手札を開く。'],
 daifugo:['手札を広げ、勝負の席へ。','いまは、あなたの手番。','場へ出すカードを、鮮やかに。','上がりの余韻と、順位の見本。'],
 babanuki:['隣の手札へ、そっと手を伸ばす。','どの1枚か、迷うひととき。','ペアが揃い、手札が軽くなる。','最後の1枚まで、どきどき。'],
 mahjong:['牌の並ぶ音と、対局の始まり。','静かな卓に、次のツモ。','引いた1枚を、手牌の横へ。','和了の瞬間を、金桜で。'],
 keiba:['8頭が揃い、スタートを待つ。','歓声の中を、追走する。','ゴール前、最後の直線。','一走を見届ける、中継の余韻。'],
 life:['桜の旅路が、ここから始まる。','サイコロに、次の行き先を。','止まった先で、できごとが待つ。','ゴールで振り返る、旅の思い出。'],
};
