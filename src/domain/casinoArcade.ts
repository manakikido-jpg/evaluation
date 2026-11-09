/** 参考資料で名前を確認できた新規台。配当は咲楽ノ宮の独自設定。 */
export const ARCADE_KINDS=['fortune','moneywheel','craps','duckrace','crash','plinko','penguin','keno','videopoker','tower','mines'] as const;
export type ArcadeKind=typeof ARCADE_KINDS[number];
export const ARCADE_LABELS:Record<ArcadeKind,{name:string;emoji:string;note:string}>={
 fortune:{name:'ホイール・オブ・フォーチュン',emoji:'☸',note:'回ったホイールの倍率で決まる'},
 moneywheel:{name:'マネーホイール',emoji:'🎡',note:'色を選んで、止まる場所を当てる'},
 craps:{name:'ストリートクラップス',emoji:'🎲',note:'2個のサイコロ。ポイントをもう一度出そう'},
 duckrace:{name:'ダックレース',emoji:'🦆',note:'5羽から1羽を選んでレース'},
 crash:{name:'クラッシュ',emoji:'🚀',note:'倍率が上がる。破裂する前に受け取ろう'},
 plinko:{name:'プリンク',emoji:'⠿',note:'9段のピンを抜け、ポケットの倍率へ'},
 penguin:{name:'ペンギンクロス',emoji:'🐧',note:'道を渡るほど倍率アップ。途中でも受取れる'},
 keno:{name:'ケノ',emoji:'🔢',note:'40個から1〜10個選び、10個の抽選結果と勝負'},
 videopoker:{name:'1Pポーカー',emoji:'🃏',note:'残す札を選び、1回交換して役を作る'},
 tower:{name:'ドラゴンタワー',emoji:'🐉',note:'3マスから選んで9階へ。危険を避けて進もう'},
 mines:{name:'マインスイーパー',emoji:'💎',note:'25マスに地雷3個。安全なマスを開いて受取ろう'},
};
export const isArcadeKind=(v:unknown):v is ArcadeKind=>typeof v==='string'&&(ARCADE_KINDS as readonly string[]).includes(v);
