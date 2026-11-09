/** 管理画面共通の線画アイコン。ゲームの図柄や画像には使わない。 */
const paths:Record<string,string>={
 home:'M3 10 12 3l9 7M5 9v12h14V9M9 21v-7h6v7',
 members:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
 stats:'M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7M2 21h20',
 cast:'M7 3v4M17 3v4M3 10h18M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2M7 14h3M14 14h3M7 18h3',
 economy:'M12 2v20M17 5H9a4 4 0 0 0 0 8h6a3 3 0 0 1 0 6H6',
 guide:'M21 11a8 8 0 0 1-8 8H7l-4 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5M7 8h10M7 12h7',
 applications:'M9 3H5v18h14V3h-4M9 2h6v4H9zM7 12l3 3 7-7',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 2h6l1 4 4 1 2 5-3 3v4l-5 3-3-2-4 1-4-5 2-3-1-4 5-5z',
 channels:'M5 3v18M19 3v18M2 8h20M2 16h20',
 notices:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
 org:'M9 2h6v5H9zM2 17h6v5H2zM16 17h6v5h-6zM12 7v5M5 17v-5h14v5',
 documents:'M14 2H4v20h16V8l-6-6v6h6M8 12h8M8 16h8',
 search:'M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
};
const families:Record<string,string>={voice:'guide',soudan:'guide',interview:'guide',tickets:'guide',posts:'documents',minutes:'documents',audit:'documents',recordings:'documents',updates:'documents',glossary:'documents',market:'economy',shop:'economy',casino:'economy',gacha:'economy',fortune:'economy',eventlottery:'cast',coretime:'cast',boosttime:'cast',rooms:'channels',roomknock:'channels',roles:'members',ranks:'members',alts:'members',evaluation:'applications',invites:'members',security:'settings',navorder:'settings',commands:'settings',board:'documents'};
export function OfficeIcon({name}:{name:string}){return <svg class="office-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d={paths[families[name]??name]??paths.documents}/></svg>;}
export const OFFICE_HINTS:Record<string,string>={home:'対応待ちと今日の状況',members:'メンバーの確認・管理',cast:'キャスト・接客の管理',guide:'案内の受付・担当・記録',applications:'申請内容の確認・対応',economy:'銭の残高・出入り・設定',casino:'カジノの設定・記録',channels:'チャンネル・権限の確認',org:'役割・担当・ページ権限',stats:'人数・活動の推移',soudan:'相談の受付・回答',settings:'サーバー全体の設定',invites:'招待元・報酬の確認',audit:'運営操作の履歴',minutes:'議事録・やること',notices:'案内・お知らせの管理'};
