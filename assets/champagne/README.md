# シャンパンの専用ボトル素材

5種類のPNGは2026年10月24日に、このBOT用に画像生成ツールで制作したアニメ調POPのデザインを動画用にしたものです。人物・外部ブランド・外部画像は使っていません。

- sakura.png：桜のしずく。淡いピンク、桜、リボン。
- moon.png：月夜の泡。紺紫、三日月、星。
- silver.png：白銀のきらめき。白銀、氷青、クリスタル。
- rose.png：咲楽ロゼ。ルビーピンク、薔薇、王冠。
- yozakura.png：宵桜の祝杯。黒金、夜桜、大きな王冠。

POP原画は開発環境の`/workspace/generated_images/exec-13d5a930-2b23-4de8-81e2-b2fb8623dd27.png`。余白を設けた透明素材シートは`/workspace/generated_images/exec-f6c1965e-913b-4d32-8fb9-e7eb26b15c30.png`。5つのセルを分け、透明部分を整えて220×280へ縮小したものがこのPNGです。原画は本番ビルドに含めません。

`castChampagneImage.ts`が使い、既存のDockerfileの`COPY assets ./assets`で配置されます。名前・価格は固定マスタから描画します。画像は小さなPNGのみを同梱し、GIFは必要時に生成・キャッシュします。
