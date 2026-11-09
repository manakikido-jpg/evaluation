# 軌跡：Veo用の背景演出制作

2026年11月9日。Veoの具体的なモデルは未確認。このチャットから動画生成は実行できないため、**下記は生成指示と受入仕様。動画は未納品**。実機映像そのものの再現・公式素材の制作とは扱わない。

## 作る順番と表示

| 順 | ファイル | 発火条件（保存済み結果） | 最大表示時間 |
|---|---|---|---|
| 1 | `veo-god.mp4` | GOD当選 | 6秒 |
| 2 | `veo-gg.mp4` | GG当選 | 4.3秒 |
| 3 | `veo-gaia.mp4` | 同じ台でガイアへ移行 | 3秒 |
| 4 | `veo-zzone.mp4` | 同じ台でZ-ZONEへ移行／ゼロ揃い確定 | 2.8秒 |
| 5 | `veo-zgame.mp4` | 同じ台でZ-GAMEへ移行 | 3秒 |

まずGODを1本作り、色・光量・質感を合わせて残りへ進む。モデルが8秒生成なら8秒で作り、下記の利用区間が自然につながるようにする。長尺のBGMは別工程。生成音声は初版では使わず、既存BGM/停止音/当選音を保つ。

映像を置く場所は液晶の上部37.6%だけ。16:9から横長へ中央を切り取るため、重要な被写体を画面中央の高さ60%に収める。数字・当選名・獲得セット数はWebの確定結果を重ねる。三人のメダル・リール・金枠・右の5マス・外装は映像へ描かない。ゲーム進行や獲得処理を動画の終了で待たせない。

## Veoに貼る指示

すべて横16:9、720pまたは1080p、可能なら24〜30fps。モデルが対応する尺を選ぶ。5本とも同じ色と古代神殿の造形に合わせる。カメラは中央固定、奥行きだけで動かす。生成後にちらつき・急な白飛び・文字化けを見て採否を決める。

### 共通指示（各プロンプトの先頭へ）

> An original cinematic background for a fantasy temple game. Rich antique gold with turquoise enamel, detailed carved stone, realistic materials, majestic scale, symmetrical frontal composition, locked camera. A clean, readable dark midground where interface numbers will be composited later. Compose the key action inside the central 60 percent of the image height so the top and bottom can be cropped. Background only: no text, letters, numbers, logos, UI, slot cabinet, reels, slot symbols, coins, portrait medallions, side spikes, border, subtitles or watermark. No camera shake, hard cuts, rapid flashes or full-frame white strobe. Do not reproduce an existing game's footage. Keep the final composition stable. Silent visual reference; generated audio will be removed.

### 1. GOD：暗転→金光→神殿

> Begin with a vast ancient sanctuary in deep blue-black shadow. From 0 to 1 second, the chamber gently darkens as a thin vertical seam of gold light appears behind monumental doors. At 1.05 seconds, the doors open and warm golden light pours through with slow volumetric rays. Between 1 and 2 seconds, a gigantic original marble deity silhouette becomes visible beyond the doors, dignified and still, with a luminous halo and drifting gold dust. By 2.05 seconds, reveal a magnificent radiant gold sanctuary while keeping the center sufficiently dark for large overlaid lettering. Hold this view with slow drifting particles through 6 seconds and a stable ending through 8 seconds. Avoid a close-up face. Golden light must retain visible architectural detail, never a blown-out white frame.

Web側の既存タイミング：1.05秒に当選音と告知、2.05秒に獲得表示、6秒で動画を解放。映像のロードを待って音を遅らせない。

### 2. GG：扉→天上庭園

> A grand antique gold temple gate above the clouds, framed by distant columns. At 0.45 seconds, both doors begin a smooth ceremonial opening. At 1.05 seconds, reveal an expansive heavenly garden, white marble colonnades, turquoise streams, and warm sunlight behind the central opening. Slow golden particles rise from the ground; the camera remains locked and the architecture stays rigid. Settle into a clear, majestic composition by 3 seconds, hold through 4.3 seconds, then remain calm through 8 seconds. No deity face and no foreground object obscuring the center.

### 3. ガイア：夜景→月とオーロラ

> A floating ancient city at night, charcoal stone palaces with warm amber windows beneath a deep violet and blue sky. During the first second, a slow veil of luminous teal and violet aurora passes behind a monumental distant goddess statue. A large moon glows softly above the city; fine light particles drift downward with no flashes. Reach a stable atmospheric reveal by 2 seconds and hold the same view from 3 through 8 seconds. A solemn mysterious atmosphere, no explosions, no zoom and no text.

### 4. Z-ZONE：火山と五つの光

> A distant dark volcanic mountain beneath rolling teal storm clouds, viewed from an antique gold terrace. During the first second, small restrained amber cracks glow on the mountain and a thin lightning branch briefly illuminates the clouds without flashing the entire frame. Five small warm golden energy lights awaken sequentially far in the background, evenly spaced, not coins, not symbols and not interface indicators. Settle by 2 seconds, hold a restrained charged atmosphere from 2.8 through 8 seconds. Leave the center readable and the terrace below the crop unobtrusive.

5つの達成状態はWeb表示を正とする。映像の光は遠景の装飾で、達成済みの個数を意味しない。紛らわしい場合は5つの光を削除した版を採用する。

### 5. Z-GAME：雷雲→黄金の神殿

> Begin with a distant classical sanctuary beneath storm clouds. A warm gold lightning arc travels behind the columns from left to right in the first second, revealing an immense original deity statue holding a staff in the distant background. The marble sanctuary becomes luminous antique gold by 2 seconds, with slow vertical shafts of light and sparse golden embers. Keep the staff, statue, architecture and camera steady. Settle by 3 seconds and hold the composition through 8 seconds. Dramatic illumination without white strobe, no foreground weapon and no text.

## 納品から組込みまで

生成物を確認してから、H.264 / yuv420p / 無音MP4へ変換。横1280px程度、30fps以下、1本4MB以下を目安にする。音声除去と再圧縮の例（ffmpegがある作業環境で実行）：

```sh
ffmpeg -i input-god.mp4 -t 6 -an -vf "scale=1280:-2,fps=30" -c:v libx264 -pix_fmt yuv420p -crf 24 -movflags +faststart veo-god.mp4
```

残りは表の秒数とファイル名へ変更。生成した文字や数字をそのまま採用しない。明滅/人物崩れ/柱の溶け/端の黒帯/中央への被りがあれば再生成する。

検品後、`src/web/public/kiseki-media/`へ表の名前で追加する。ファイルが存在した演出だけ、起動時に版付きのURLとして登録される。未追加の動画は通信も再生もせず、既存のCSS/静止画演出を使う。追加後はビルド・再起動が必要で、本番へ直接置く作業はしない。

受入確認：

- 無料試遊の場面確認で実際に当選/区間移行を起こし、三人・右履歴・数字・リールとの重なりを390pxと大画面で確認する。演出見本ダイアログと単なる再読込では動画を自動再生しない。
- 音OFF/ONで既存音の挙動を確認する。動画音声は常にミュート。
- スキップ・次の操作・タブ非表示・ページ離脱・動き低減・軽量表示で動画が止まり、通信失敗/自動再生拒否でも通常表示と操作が続くことを確認する。
- 保存済みの当選・獲得・残高・抽選・体験券の時間と結果が変わらないことを確認する。
- 実際のMP4で最終検品後にPRへ追加する。現段階のプレイヤー試験用映像を完成演出として公開しない。
