/**
 * 入鯖申請・宵参り申請などのパネル（Discord API の形のまま）。
 * BOT の /panel とセットアップスクリプトの両方で使う。
 */

import { fileURLToPath } from 'node:url';
import type { APIEmbed } from 'discord.js';

const SHU = 0xd7003a;
const GACHA_BANNER = fileURLToPath(new URL('../web/public/gacha/prayer-banner.png', import.meta.url));

/** Discord の年齢確認（2026-09〜）で、宵参りの人でも年齢制限チャンネルが見られないことがある */

export type PanelKind = 'apply' | 'yoimairi' | 'shop' | 'gender' | 'market' | 'contact' | 'bell' | 'gacha' | 'notify';

export type PanelMessage = {
  embeds: APIEmbed[];
  components: { type: 1; components: { type: 2; style: 1 | 2 | 3; label: string; custom_id: string; emoji?: { name: string } }[] }[];
};

type PanelOptions = { /** 通貨の名前（なければ銭） */ coinName?: string };
export type GachaPanelMessage = PanelMessage & { files: { attachment: string; name: string; description: string }[] };

export function panelMessage(kind: 'gacha', opts?: PanelOptions): GachaPanelMessage;
export function panelMessage(kind: PanelKind, opts?: PanelOptions): PanelMessage;
export function panelMessage(kind: PanelKind, opts: PanelOptions = {}): PanelMessage | GachaPanelMessage {
  const coin = opts.coinName ?? '銭';
  if (kind === 'shop') return shopPanel(coin);
  if (kind === 'market') {
    return {
      embeds: [
        {
          title: '🏪 市場',
          description: [
            `開業権利を持つ方が、イラスト・歌・作ったもの・通話（ツーショ・寝かしつけ・メンケア・相談など）を${coin}で売っています。出品のカードの「買う」か「💬 値段を提案する」から。`,
            '',
            `・${coin}は社務所が預かり、「受け取った」を押すと売った人に渡します（押さなくても期限が来たら渡します）`,
            '・「💬 ○○枚から」の出品は、買いたい値段を提案して、売る人が受けると取引になります',
            '・📝 **依頼の募集**: してほしいことと予算を出すと、開業権利を持つ方が手を挙げます。選ぶと取引になります',
            '・📞 **今すぐ通話できる人**: 🟢 待機中の人の一覧です（30 分で消えます）',
            '・終わったら ⭐ で評価できます。通話の相手が来なかったときは「🚫 来なかった」で運営が確かめて返金します',
            '・困ったときは、取引のスレッドの「問題あり」で運営が確認します',
            '・通話は 18 歳以上どうしだけ。性的なもの・本物のお金のやり取りは禁止です',
            '',
            '-# 出品・引き受けるには #授与所 の「開業権利」を受けてください（依頼はだれでも出せます）',
          ].join('\n'),
          color: SHU,
        },
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 1, label: '出品する', custom_id: 'market:new', emoji: { name: '🏪' } },
            { type: 2, style: 1, label: '依頼を募集する', custom_id: 'market:req', emoji: { name: '📝' } },
            { type: 2, style: 3, label: '今すぐ通話できる人', custom_id: 'market:standby', emoji: { name: '📞' } },
          ],
        },
      ],
    };
  }
  if (kind === 'bell') {
    return {
      embeds: [
        {
          title: '🔔 呼び鈴',
          description: [
            '困ったことがあったら、下のボタンで運営（神職）を呼べます。',
            '・通話で困っている人がいる、荒らしがいる、使い方が分からない など',
            '・呼んだことは神職にだけ伝わります。神職が気づいたら、BOT から DM でお知らせします',
            '',
            '-# `/呼び鈴` でも呼べます。人に知られたくない相談は `/相談`（匿名）へ',
          ].join('\n'),
          color: SHU,
        },
      ],
      components: [{ type: 1, components: [{ type: 2, style: 1, label: '運営を呼ぶ', custom_id: 'bell:ring', emoji: { name: '🔔' } }] }],
    };
  }
  if (kind === 'gacha') {
    return {
      embeds: [{ image: { url: 'attachment://gacha-prayer.png' } }],
      files: [{ attachment: GACHA_BANNER, name: 'gacha-prayer.png', description: '咲楽ノ宮の祈願所。物御籤（ものみくじ）と、カジノの景品が当たる勝負の御籤。下のボタンから売り場・中身と排出率・勝負の御籤を開けます。' }],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 1, label: '物御籤売り場へ入る', custom_id: 'gacha:open', emoji: { name: '🎁' } },
            { type: 2, style: 2, label: '中身と排出率', custom_id: 'gacha:rates', emoji: { name: '📜' } },
            { type: 2, style: 2, label: '勝負の御籤（カジノの景品）', custom_id: 'casino-gacha:open', emoji: { name: '🎰' } },
          ],
        },
      ],
    };
  }
  if (kind === 'notify') {
    return {
      embeds: [
        {
          title: '🔔 通知 OK／🔕 通知 NG',
          description: [
            '募集（「〇〇を募集する」）と、運営のお知らせの通知を受け取るかを選んでください。',
            '',
            '🔔 **通知OK** … 通知が鳴ります（はじめはこちら）',
            '🔕 **通知NG** … BOT の募集・お知らせで鳴りません',
            '',
            '-# いつでも押し直して変えられます。NG でも、チャンネルを見ればお知らせは読めます（@everyone のお知らせは鳴ります）',
          ].join('\n'),
          color: SHU,
        },
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 3, label: '通知OK', custom_id: 'notify:ok', emoji: { name: '🔔' } },
            { type: 2, style: 2, label: '通知NG', custom_id: 'notify:ng', emoji: { name: '🔕' } },
          ],
        },
      ],
    };
  }
  if (kind === 'contact') {
    const levels = [
      ['ok', 'OK', '⭕', 3],
      ['ask', '要相談', '💬', 2],
      ['ng', 'NG', '❌', 2],
    ] as const;
    const rowOf = (k: 'dm' | 'friend', label: string) => ({
      type: 1 as const,
      components: levels.map(([l, text, emoji, style]) => ({ type: 2 as const, style, label: `${label} ${text}`, custom_id: `contact:${k}:${l}`, emoji: { name: emoji } })),
    });
    return {
      embeds: [
        {
          title: '📩 DM・フレンド追加',
          description: [
            'DM やフレンド追加をしてもいいかを選んでください。ロールになって、名前を押すとプロフィールに出ます。',
            '',
            '⭕ **OK** … 気軽にどうぞ',
            '💬 **要相談** … サーバーの中で一声かけてから',
            '❌ **NG** … しないでください',
            '',
            '-# いつでも押し直して変えられます。相手が NG・要相談なのに DM を送り続けるのは迷惑行為です',
          ].join('\n'),
          color: SHU,
        },
      ],
      components: [rowOf('dm', 'DM'), rowOf('friend', 'フレンド')],
    };
  }
  if (kind === 'gender') {
    return {
      embeds: [
        {
          title: '🪧 性別を選ぶ',
          description: [
            '自己紹介を書くチャンネル（#絵馬-男性・#絵馬-女性）と、プロフィールのロールが決まります。',
            '',
            '-# 前からいる方向けです（これから入る方は、入鯖申請で選びます）。一度選んだら、変えたいときは神職に知らせてください',
          ].join('\n'),
          color: SHU,
        },
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 2, label: '男性', custom_id: 'gender:male', emoji: { name: '♂️' } },
            { type: 2, style: 2, label: '女性', custom_id: 'gender:female', emoji: { name: '♀️' } },
          ],
        },
      ],
    };
  }
  if (kind === 'apply') {
    return {
      embeds: [
        {
          title: '⛩ 社務所 ― 入鯖申請',
          description: [
            '咲楽ノ宮へようこそ。下のボタンから入鯖を申請してください。',
            '',
            '・13 歳以上の方が参加できます',
            '・申請の内容は神職だけが見ます',
            '・承認されると 🔰参拝者 になり、お参り期間が始まります',
          ].join('\n'),
          color: SHU,
        },
      ],
      components: [{ type: 1, components: [{ type: 2, style: 1, label: '入鯖を申請する', custom_id: 'apply:start' }] }],
    };
  }
  return {
    embeds: [
      {
        title: '🔞 宵参りの申請（18 歳以上）',
        description: [
          '宵宮（18 歳以上だけのエリア）に入るための申請です。入鯖のときに「18 歳以上」と申告した方だけ申請できます。',
          '',
          '-# 神職が確認して承認すると、宵宮が見えるようになります',
        ].join('\n'),
        color: SHU,
      },
    ],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: '宵参りを申請する', custom_id: 'yoimairi:start' }] }],
  };
}

/** #授与所 のショップのボタン */
function shopPanel(coin: string): PanelMessage {
  return {
    embeds: [
      {
        title: '🛍 授与所 ― 授与品',
        description: [
          `${coin}で授与品を受けられます。下のボタンから一覧を開いてください（自分にだけ表示されます）。`,
          '',
          '🎨 **色守り** … 名前の色が変わる',
          '🏷 **称号** … プロフィールに称号が付く',
          '🎁 **贈る** … 花吹雪・贈り物',
          '🎐 **おみくじ・絵馬** … もう 1 回・自己紹介のピン留め',
          '🧾 **免罪符** … 厄を祓う',
          '',
          '-# 🏮 奉納（サーバーブースト）している方は割引があります',
        ].join('\n'),
        color: SHU,
      },
    ],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: '授与品を見る', custom_id: 'shop:open', emoji: { name: '🛍' } }] }],
  };
}
