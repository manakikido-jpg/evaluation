# 軌跡版の液晶素材

追加：special-scenes-atlas.pngはimage_genで独自生成した3等分のGG/PGG/SGG背景。左から夕日の海上神殿、雲上の黄金宮殿、環のある惑星と紫の宇宙。sharpで各512×1024pxのセルを切り出し、scene-{gg,pgg,sgg}.webpへ変換しています。造形の編集は行っていません。

generate-audio.pyは独自の和音/旋律/倍音/打音から、GG・PGG・SGGのBGM3点（19.2/24/15秒）と突入音3点を作る再現用スクリプト。既存曲/録音/実機音を使用しません。BGMは両端をゼロへ収めた全長ループ、44.1kHz/2ch/128kbpsのMP3です。配信はsrc/web/public/kiseki-media、実行時のPython依存はありません。

2026年11月5日。image_genで独自生成。spring/garden/ruins.pngは泉・庭園・遺跡の背景。altar.pngは本人提供の三神を参考にした金/ブロンズ主体の透過装飾です。左が紫髪、中央が白髪/赤、右が青髪の人物。識別色は縁だけに抑えています。実機の画像・ロゴは転載していません。

配信用はsrc/web/public/kiseki-mediaのWebP。背景800/1440px、装飾1200px。PNGは比較と再変換用に保存します。

初版：altar-integrated.pngは小さい三神をリール列へ揃えた細い金の上枠、apron.pngは文字を含まない黒/深い赤/金の腰パネル背景。旧altar.pngとともに比較用に残します。初版ではGODの文字をHTMLで重ねていました。

実機らしい質感の再調整：reel-housing.pngは三神/側柱/下のバルコニーを一体で描いた透過造形。中央の透明窓に実際のHTMLリールを配置し、配信用altar-1200.webpの現行元とします。apron-relief.pngは立体GOD文字を含む腰パネル（現行apron-1200.webp）、marquee-relief.pngは独自の赤金GOD GAME銘板（marquee-720.webp）。旧文字なし素材は比較用に維持。

symbol-atlas.pngは2列×3段の独自図柄シート。上段左=黄7/右=赤7、中段左=青7/右=GOD、下段左=花/右=紋章。等分した各セルを配信用384×128pxの透過WebP6点へ切り出しています。造形の編集はimage_gen、sharpはセルの分割・サイズ変更・WebP変換だけに使用。全て軌跡専用、凱旋の図柄/配列/停止ロジックを変更しません。

## 接触・ブレーキ・払出しなどの短い独自音

`python3 assets/kiseki-lcd-source/generate-effects.py` で8点の `fx-*.mp3` を生成します。numpyとffmpegが必要です。録音素材は使わず、固定した波形・ノイズから合成します。デコード後の8点すべてでクリップしたサンプルがないことを確認しました。端末のスピーカーでの聴感とは別の確認です。
