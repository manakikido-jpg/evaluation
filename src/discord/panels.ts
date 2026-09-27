/**
 * 入鯖申請・宵参り申請・お守りのパネル（Discord API の形のまま）。
 * BOT の /panel とセットアップスクリプトの両方で使う。
 */

const SHU = 0xd7003a;

/** Discord の年齢確認（2026-09〜）で、宵参りの人でも年齢制限チャンネルが見られないことがある */

export type PanelKind = 'apply' | 'yoimairi' | 'omamori' | 'shop' | 'gender' | 'market' | 'contact';

export type PanelMessage = {
  embeds: { title: string; description: string; color: number }[];
  components: { type: 1; components: { type: 2; style: 1 | 2 | 3; label: string; custom_id: string; emoji?: { name: string } }[] }[];
};

/** お守り 1 つ分（config の roles.omamori と同じ形） */
export type OmamoriPanelItem = { roleId: string; label: string; emoji: string; description: string; adultOnly: boolean };

export function panelMessage(kind: PanelKind, opts: { omamori?: OmamoriPanelItem[] } = {}): PanelMessage {
  if (kind === 'omamori') return omamoriPanel(opts.omamori ?? []);
  if (kind === 'shop') return shopPanel();
  if (kind === 'market') {
    return {
      embeds: [
        {
          title: '🏪 市場',
          description: [
            '開業権利を持つ方が、イラスト・歌・作ったもの・通話（雑談・寝落ち）などを花びらで売っています。出品のカードの「買う」から買えます。',
            '',
            '・花びらは社務所が預かり、「受け取った」を押すと売った人に渡します（押さなくても期限が来たら渡します）',
            '・困ったときは、取引のスレッドの「問題あり」で運営が確認します',
            '・通話は 18 歳以上どうしだけ。性的なもの・本物のお金のやり取りは禁止です',
            '',
            '-# 出品するには #授与所 の「開業権利」を受けてから、下のボタンを押してください',
          ].join('\n'),
          color: SHU,
        },
      ],
      components: [{ type: 1, components: [{ type: 2, style: 1, label: '出品する', custom_id: 'market:new', emoji: { name: '🏪' } }] }],
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

function omamoriPanel(items: OmamoriPanelItem[]): PanelMessage {
  const rows: PanelMessage['components'] = [];
  for (let i = 0; i < items.length; i += 5) {
    rows.push({
      type: 1,
      components: items.slice(i, i + 5).map((o) => ({
        type: 2,
        style: 2,
        label: `${o.label}のお守り`,
        custom_id: `omamori:${o.roleId}`,
        ...(o.emoji ? { emoji: { name: o.emoji } } : {}),
      })),
    });
  }
  // 自分がどれを授かっているか見るボタン（本人にだけ見える）
  rows.push({ type: 1, components: [{ type: 2, style: 1, label: '自分のお守りを見る', custom_id: 'omamori:mine', emoji: { name: '🧧' } }] });
  return {
    embeds: [
      {
        title: '🧧 授与所 ― お守り',
        description: [
          'お守りを持っていると、その募集の通知が届きます。ボタンを押すと授かり、もう一度押すと返せます。押すと、あなたが授かっているお守りが ✅ で出ます（「自分のお守りを見る」でも見られます）。',
          '',
          ...items.map((o) => `${o.emoji} **${o.label}のお守り** … ${o.description}`),
          '',
          '**募集するとき**は、メッセージにお守りを付けて送ってください（例: `@寝落ちのお守り 23 時から寝落ちしませんか`）。',
          '-# 通知が多いと感じたら、いつでも返せます',
        ].join('\n'),
        color: SHU,
      },
    ],
    components: rows,
  };
}

/** #授与所 のショップのボタン */
function shopPanel(): PanelMessage {
  return {
    embeds: [
      {
        title: '🛍 授与所 ― 授与品',
        description: '花びらで授与品（色守り・称号・花吹雪・贈り物 など）を受けられます。下のボタンから一覧を開いてください（自分にだけ表示されます）。',
        color: SHU,
      },
    ],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: '授与品を見る', custom_id: 'shop:open', emoji: { name: '🛍' } }] }],
  };
}
