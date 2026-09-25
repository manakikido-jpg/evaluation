/**
 * 入鯖申請・宵参り申請のパネル（Discord API の形のまま）。
 * BOT の /panel とセットアップスクリプトの両方で使う。
 */

const SHU = 0xd7003a;

export type PanelKind = 'apply' | 'yoimairi';

export type PanelMessage = {
  embeds: { title: string; description: string; color: number }[];
  components: { type: 1; components: { type: 2; style: 1; label: string; custom_id: string }[] }[];
};

export function panelMessage(kind: PanelKind): PanelMessage {
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
