/**
 * 入鯖申請・宵参り申請などのパネル（Discord API の形のまま）。
 * BOT の /panel とセットアップスクリプトの両方で使う。
 */

const SHU = 0xd7003a;

/** Discord の年齢確認（2026-09〜）で、宵参りの人でも年齢制限チャンネルが見られないことがある */

export type PanelKind = 'apply' | 'yoimairi' | 'shop' | 'gender' | 'market' | 'contact' | 'bell' | 'gacha' | 'notify';

export type PanelMessage = {
  embeds: { title: string; description: string; color: number }[];
  components: { type: 1; components: { type: 2; style: 1 | 2 | 3; label: string; custom_id: string; emoji?: { name: string } }[] }[];
};

export function panelMessage(kind: PanelKind, opts: { /** 通貨の名前（なければ銭） */ coinName?: string } = {}): PanelMessage {
  const coin = opts.coinName ?? '銭';
  if (kind === 'shop') return shopPanel(coin);
  if (kind === 'market') {
    return {
      embeds: [
        {
          title: '🏪 市場',
          description: [
            `開業権利を持つ方が、イラスト・歌・作ったもの・通話（雑談・寝落ち）などを${coin}で売っています。出品のカードの「買う」から買えます。`,
            '',
            `・${coin}は社務所が預かり、「受け取った」を押すと売った人に渡します（押さなくても期限が来たら渡します）`,
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
      embeds: [
        {
          title: '🎁 物御籤（ものみくじ）',
          description: [
            `${coin}で引くくじです。運勢に応じて、物御籤でしか受けられない色守り・称号や、いろいろな券が出ます。`,
            '',
            '・「物御籤売り場へ入る」を押すと、値段・出る割合・天井までの回数が（自分にだけ）出ます。そこから 1 回か 10 連で引けます',
            '・🎉 はじめての 1 回は無料です',
            '・「📜 中身と排出率」で、出る中身と、それぞれの出る確率を見られます',
            '・大吉が出たら #おみくじ でお祝いします',
            `・${coin}だけで引けます（本物のお金は使いません）`,
            '',
            '-# `/物御籤` でも引けます',
          ].join('\n'),
          color: SHU,
        },
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 1, label: '物御籤売り場へ入る', custom_id: 'gacha:open', emoji: { name: '🎁' } },
            { type: 2, style: 2, label: '中身と排出率', custom_id: 'gacha:rates', emoji: { name: '📜' } },
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
