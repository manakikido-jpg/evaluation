/**
 * 入鯖申請・宵参り申請・お守りのパネル（Discord API の形のまま）。
 * BOT の /panel とセットアップスクリプトの両方で使う。
 */

const SHU = 0xd7003a;

export type PanelKind = 'apply' | 'yoimairi' | 'omamori';

export type PanelMessage = {
  embeds: { title: string; description: string; color: number }[];
  components: { type: 1; components: { type: 2; style: 1 | 2; label: string; custom_id: string; emoji?: { name: string } }[] }[];
};

/** お守り 1 つ分（config の roles.omamori と同じ形） */
export type OmamoriPanelItem = { roleId: string; label: string; emoji: string; description: string; adultOnly: boolean };

export function panelMessage(kind: PanelKind, opts: { omamori?: OmamoriPanelItem[] } = {}): PanelMessage {
  if (kind === 'omamori') return omamoriPanel(opts.omamori ?? []);
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
        description: '宵宮（18 歳以上だけのエリア）に入るための申請です。入鯖のときに「18 歳以上」と申告した方だけ申請できます。',
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
  return {
    embeds: [
      {
        title: '🧧 授与所 ― お守り',
        description: [
          'お守りを持っていると、その募集の通知が届きます。ボタンを押すと授かり、もう一度押すと返せます。',
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
