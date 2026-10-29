import type {CasinoConfig} from '../../config.js';

type PursePolicy=Pick<CasinoConfig,'keibaPurseMinBet'|'keibaPurseOthersMin'|'keibaBetPurseMult'|'keibaBetDailyCap'|'keibaEntryFee'|'keibaNoBetPurse'|'keibaNoBetDailyCap'>;
const fmt=(n:number)=>n.toLocaleString('ja-JP');
/** レースと馬主の部屋で、現在の設定と同じ保証条件を案内する。金額は画面の通貨単位。 */
export function keibaPurseGuide(c:PursePolicy):string{
 const minimum=Math.max(1,c.keibaPurseMinBet);
 const condition=minimum===1?'本人がこのレースの馬券を買えば対象です。':`本人がこのレースに${fmt(minimum)}以上賭けると対象です。`;
 const others=c.keibaPurseOthersMin>0?`ほかの人の賭け合計も${fmt(c.keibaPurseOthersMin)}以上必要です。`:'ほかの人の賭けは不要です。';
 const daily=c.keibaBetDailyCap>0?`受取人1人につき1日${fmt(c.keibaBetDailyCap)}まで（日本時間0時区切り）。`:'保証上乗せの日額上限はありません。';
 const fee=c.keibaEntryFee>0?`出走料${fmt(c.keibaEntryFee)}を賞金・手当等から引きます（受取分を超えて引きません）。`:'';
 return `${condition}${others}1〜5着の賞金の不足分を、本人の賭け額の${fmt(c.keibaBetPurseMult)}倍まで補います。必ず${fmt(c.keibaBetPurseMult)}倍もらえる意味ではありません。${daily}同じレースの複数頭は馬主ごとに上乗せ予算を共有します。${fee}条件を満たさない場合の1着保証基準は${fmt(c.keibaNoBetPurse)}${c.keibaNoBetDailyCap>0?`（上乗せは別枠で1人1日${fmt(c.keibaNoBetDailyCap)}まで）`:''}です。共同所有は持分で分配します。定時開催の大レースは賭け条件・保証上乗せ上限・出走料の対象外です（イベント大会には通常の制限を適用）。馬券の払戻は別です。`;
}
