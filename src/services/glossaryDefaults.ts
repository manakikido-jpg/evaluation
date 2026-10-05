/**
 * 用語集のはじめの言葉（社務所Web の「用語集」で「標準の言葉を入れる」を押すと入る。あとから自由に直せる）。
 * 説明の {通貨} {お参り期間} {#チャンネル} などは、掲示・/用語 に出すときに今の設定で置き換わる。
 */

export type GlossaryCategory = 'roles' | 'system' | 'economy' | 'gacha' | 'places' | 'voice';

export const GLOSSARY_CATEGORIES: Record<GlossaryCategory, { label: string; emoji: string }> = {
  roles: { label: '役職・ロール', emoji: '⛩' },
  system: { label: '仕組み', emoji: '🌸' },
  economy: { label: '{通貨}と授与品', emoji: '🪙' },
  gacha: { label: '物御籤・券・札', emoji: '🎁' },
  places: { label: '場所', emoji: '🗺' },
  voice: { label: '通話', emoji: '🎙' },
};

export const GLOSSARY_CATEGORY_KEYS = Object.keys(GLOSSARY_CATEGORIES) as GlossaryCategory[];
export const isGlossaryCategory = (v: unknown): v is GlossaryCategory => typeof v === 'string' && Object.hasOwn(GLOSSARY_CATEGORIES, v);

export type GlossaryDefault = { category: GlossaryCategory; term: string; reading?: string; emoji?: string; description: string; aliases?: string };

export const DEFAULT_TERMS: GlossaryDefault[] = [
  // 役職・ロール
  { category: 'roles', emoji: '⛩', term: '宮司', reading: 'ぐうじ', description: '鯖主' },
  { category: 'roles', emoji: '🎐', term: '神職', reading: 'しんしょく', description: '運営' },
  { category: 'roles', emoji: '🏮', term: '総代', reading: 'そうだい', description: '古参' },
  { category: 'roles', emoji: '🎋', term: '世話役', reading: 'せわやく', description: '常連' },
  { category: 'roles', emoji: '🍃', term: '氏子', reading: 'うじこ', description: 'メンバー' },
  { category: 'roles', emoji: '🔰', term: '参拝者', reading: 'さんぱいしゃ', description: '新人' },
  { category: 'roles', emoji: '🧭', term: '案内待ち', reading: 'あんないまち', description: '入ったばかりで、まだ入鯖申請が承認されていない人' },
  { category: 'roles', emoji: '📝', term: '絵馬待ち', reading: 'えままち', description: '承認されて、自己紹介（絵馬）を書くのを待っている人。書くと 🔰参拝者 になる' },
  { category: 'roles', emoji: '👹', term: '厄年', reading: 'やくどし', description: '警告中（朱印を押せない）' },
  { category: 'roles', emoji: '🔞', term: '宵参り', reading: 'よいまいり', description: '18 歳以上エリア（宵宮）に入れる人' },
  { category: 'roles', emoji: '🏪', term: '開業', reading: 'かいぎょう', description: '市場に出品できる人（授与所の「開業権利」で受ける）', aliases: '開業権利' },
  { category: 'roles', emoji: '🎨', term: '色守り', reading: 'いろまもり', description: '名前の色が変わるロール（授与所・物御籤で受ける）' },
  { category: 'roles', emoji: '🏷', term: '称号', reading: 'しょうごう', description: 'プロフィールに付く肩書きのロール（授与所・物御籤で受ける）' },

  // 仕組み
  { category: 'system', emoji: '📖', term: '御朱印帳', reading: 'ごしゅいんちょう', description: '自分の評価カード（`/御朱印帳`）' },
  { category: 'system', emoji: '🌸', term: '朱印', reading: 'しゅいん', description: '評価スタンプ。相手の名前を右クリック（スマホは長押し）→「アプリ」→「🌸 朱印を押す」' },
  { category: 'system', emoji: '🎀', term: 'ご縁', reading: 'ごえん', description: '評価ポイント。貯まると役職が上がる' },
  { category: 'system', emoji: '⚖', term: '格', reading: 'かく', description: '朱印 1 回で渡せるご縁（役職が上がると増える）' },
  { category: 'system', emoji: '👹', term: '厄', reading: 'やく', description: '警告。付いている間は 👹厄年' },
  { category: 'system', emoji: '📜', term: '免罪符', reading: 'めんざいふ', description: '{通貨}で厄を祓う札（`/免罪符`）' },
  { category: 'system', emoji: '🗓', term: 'お参り期間', reading: 'おまいりきかん', description: '入ってから最初の {お参り期間} 日' },
  { category: 'system', emoji: '🔔', term: '呼び鈴', reading: 'よびりん', description: '運営を呼ぶボタン（`/呼び鈴`）' },
  { category: 'system', emoji: '📮', term: '相談', reading: 'そうだん', description: '神職に匿名で相談できる（`/相談`）' },
  { category: 'system', emoji: '🏆', term: '番付', reading: 'ばんづけ', description: 'ご縁・物御籤などのランキング（{#番付}）' },
  { category: 'system', emoji: '🎉', term: '慶事', reading: 'けいじ', description: '昇格・称号・お祝いの発表（{#慶事}）' },
  { category: 'system', emoji: '🏮', term: '奉納', reading: 'ほうのう', description: 'サーバーブースト。奉納している人は授与品の割引などがある', aliases: 'ブースト' },
  { category: 'system', emoji: '⏰', term: 'コアタイム', description: '{コアタイム}。この間の通話は{通貨}が {コアタイム倍率}' },

  // 通貨と授与品
  { category: 'economy', emoji: '🪙', term: '{通貨}', description: 'サーバーの中だけのお金（本物のお金では買えない）。`/残高` で見られる', aliases: '通貨,お金' },
  { category: 'economy', emoji: '🎁', term: '初期配布', reading: 'しょきはいふ', description: '参拝者になったときに 1 回だけもらえる{通貨}（{初期配布} 枚）' },
  { category: 'economy', emoji: '🏮', term: '授与所', reading: 'じゅよしょ', description: '{通貨}で授与品（色守り・称号・ピン留めなど）を受けるところ（{#授与所}）', aliases: 'ショップ' },
  { category: 'economy', emoji: '🎀', term: '授与品', reading: 'じゅよひん', description: '授与所で受けられる品物' },
  { category: 'economy', emoji: '💝', term: '贈り物', reading: 'おくりもの', description: 'ほかの人に{通貨}を贈る授与品（参拝者から）', aliases: '送金' },
  { category: 'economy', emoji: '🌸', term: '花吹雪', reading: 'はなふぶき', description: '相手に花吹雪を降らせてお祝いする授与品' },
  { category: 'economy', emoji: '🏪', term: '市場', reading: 'いちば', description: '開業した人のイラスト・歌・作成物・通話などを{通貨}で売り買いするところ（{#市場}）' },
  { category: 'economy', emoji: '🎴', term: 'おみくじ', description: '1 日 1 回引ける（`/おみくじ`）。{通貨}がもらえる（{おみくじの銭}）' },
  { category: 'economy', emoji: '🤝', term: '招待のお礼', reading: 'しょうたいのおれい', description: '招待した人が参拝者になると{通貨}がもらえる（{招待のお礼} 枚）' },

  // 物御籤・券・札
  { category: 'gacha', emoji: '🎁', term: '物御籤', reading: 'ものみくじ', description: '{通貨}で引くくじ（`/物御籤`）。色守り・称号・券・札などが当たる', aliases: 'ガチャ' },
  { category: 'gacha', emoji: '🌟', term: '超大当たり', reading: 'ちょうおおあたり', description: '物御籤のいちばん上の運勢' },
  { category: 'gacha', emoji: '🎊', term: '大吉', reading: 'だいきち', description: '物御籤の大当たり（中吉・小吉・吉と続く）' },
  { category: 'gacha', emoji: '🧱', term: '天井', reading: 'てんじょう', description: '大吉が出ないまま決まった回数引くと、次は大吉が確定' },
  { category: 'gacha', emoji: '🎫', term: '物御籤の無料券', reading: 'ものみくじのむりょうけん', description: '物御籤を 1 回タダで引ける券', aliases: '無料券' },
  { category: 'gacha', emoji: '🌟', term: '金の10連券', reading: 'きんのじゅうれんけん', description: '物御籤を 10 連タダで引ける券。10 回のうち 1 回は大吉以上が確定', aliases: '金券,金の券' },
  { category: 'gacha', emoji: '🧧', term: '福の札', reading: 'ふくのふだ', description: '使うと 24 時間、通話でもらえる{通貨}が 2 倍' },
  { category: 'gacha', emoji: '🍀', term: '運気アップの札', reading: 'うんきあっぷのふだ', description: '使うと、次の 10 回は物御籤の大吉が出やすくなる' },
  { category: 'gacha', emoji: '🏷', term: '名前の飾り札', reading: 'なまえのかざりふだ', description: '使うと 7 日間、名前の前に好きな絵文字を 1 つ付けられる' },
  { category: 'gacha', emoji: '🐉', term: '十二支のお守り', reading: 'じゅうにしのおまもり', description: '物御籤で集めるお守り。12 そろうと称号がもらえる' },
  { category: 'gacha', emoji: '🍶', term: 'おすそ分け', reading: 'おすそわけ', description: '大吉以上が出ると、同じ通話の人にも{通貨}が配られる' },
  { category: 'gacha', emoji: '🎟', term: '券', reading: 'けん', description: '部屋代無料券・割引券など。持っている券は `/残高` で見られる。使うと効く札は `/物御籤` の「券を使う」から' },

  // 場所
  { category: 'places', term: '鳥居', reading: 'とりい', description: '入口（{#鳥居}）' },
  { category: 'places', term: 'しきたり', description: 'ルール・用語集・朱印の仕組み（{#しきたり}）' },
  { category: 'places', term: '社務所', reading: 'しゃむしょ', description: '入鯖申請・宵参り申請の受付（{#社務所}）' },
  { category: 'places', term: '御触書', reading: 'おふれがき', description: 'お知らせ（{#御触書}）' },
  { category: 'places', term: '絵馬殿', reading: 'えまでん', description: 'メンバー紹介（絵馬-男性・絵馬-女性・運営紹介・アイコン紹介）', aliases: '絵馬' },
  { category: 'places', term: '境内', reading: 'けいだい', description: '雑談（{#境内}）' },
  { category: 'places', term: 'お出迎え', reading: 'おでむかえ', description: '新しく参拝した方のお知らせ（{#お出迎え}）' },
  { category: 'places', term: '手水舎', reading: 'ちょうずや', description: '浮上したら一言・雑談通話の募集（{#手水舎}）' },
  { category: 'places', term: '写真館', reading: 'しゃしんかん', description: '画像・スクショ（{#写真館}）' },
  { category: 'places', term: '縁日', reading: 'えんにち', description: 'ゲームの募集（{#縁日}）' },
  { category: 'places', term: '屋台', reading: 'やたい', description: 'ゲームの話題（{#屋台}）' },
  { category: 'places', term: '宿帳', reading: 'やどちょう', description: '寝落ち通話の募集（{#宿帳}）' },
  { category: 'places', term: '宵宮', reading: 'よいみや', description: '18 歳以上エリア（宵参りの人だけ）' },
  { category: 'places', term: '御神酒処', reading: 'おみきどころ', description: 'お酒の話・飲み通話の募集' },

  // 通話
  { category: 'voice', term: '拝殿', reading: 'はいでん', description: 'みんなの雑談通話' },
  { category: 'voice', term: '縁側', reading: 'えんがわ', description: '「➕ 縁側をひらく」に入るとできる自分の雑談部屋' },
  { category: 'voice', term: '神楽殿', reading: 'かぐらでん', description: '配信・イベント' },
  { category: 'voice', term: '宿坊', reading: 'しゅくぼう', description: '寝落ち通話（「➕ 宿坊をひらく」で自分の部屋）' },
  { category: 'voice', term: '➕ ○○をひらく', description: '入ると自分の通話部屋ができる（名前・人数は自分で変えられる。全員抜けると消える）', aliases: '通話部屋,部屋' },
  { category: 'voice', term: '奥の院', reading: 'おくのいん', description: '放置（AFK）' },
];
