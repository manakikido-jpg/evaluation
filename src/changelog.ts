/**
 * 更新履歴（パッチノート）。管理画面の「更新履歴」に出る。
 * 変更を入れるときは、いちばん上に 1 つ足す（新しい順）。id は一度決めたら変えない（「読んだ」の目印に使う）。
 *
 * - kind: new = 新しい機能 / improve = よくなった / fix = 直した
 * - where: どこが変わったか（Discord = メンバーにも見える / 社務所Web = 運営だけ / 運用 = VPS・セットアップ）
 */
export type ChangelogKind = 'new' | 'improve' | 'fix';
export type ChangelogWhere = 'Discord' | '社務所Web' | '運用';

export type ChangelogAnnouncement = {
  priority: 'required' | 'optional' | 'none';
  audience: string;
  steps: string[];
  postText: string;
  imagePrompt: string;
  notes?: string;
};

export type ChangelogEntry = {
  id: string;
  /** 日本時間の日付 YYYY-MM-DD */
  date: string;
  kind: ChangelogKind;
  where: ChangelogWhere[];
  title: string;
  items: string[];
  /** 周知担当向け。未記載の更新は要確認として表示する。 */
  announcement?: ChangelogAnnouncement;
};

export const CHANGELOG: ChangelogEntry[] = [
  { id: '2026-10-25-member-role-floating', date: '2026-10-25', kind: 'improve', where: ['社務所Web'], title: 'メンバーのロール絞り込みを浮動パネルに', items: ['ロールの選択をフローティング表示にし、名前で検索しながらチェックできます。選択数もその場で更新します。', '「リセット」でロール条件だけを解除します。名前・役職・年齢・在籍など、ほかの検索条件と実際のメンバーのロールは変えません。'], announcement: { priority: 'none', audience: '社務所Webのメンバー一覧を使う運営', steps: ['メンバー一覧の「ロールで絞り込む」を開く。', 'ロール名を検索してチェックする。', 'ロール条件をなくすときは「リセット」を押す。閉じるボタン・外側クリック・Escapeでパネルを閉じられる。'], postText: '', imagePrompt: '', notes: '一般メンバーへの告知や画像制作は不要です。ロールの付与/剥奪ではなく、一覧の検索条件の操作です。' } },
  { id: '2026-10-25-visit-revenue-workshop', date: '2026-10-25', kind: 'new', where: ['Discord', '社務所Web'], title: '参拝帳の着せ替え収益と制作工房', items: ['SHOPから着せ替えの月別・累計・商品別の売上と運営収益を確認できます。', '制作権利で自分用の背景・フレームを保存し、運営確認後に販売申請できます。作品売上は制作者70％・運営30％。権利は価格未定のため初期販売停止です。'], announcement: { priority: 'optional', audience: '宮司・参拝帳の作品制作を考えているメンバー', steps: ['宮司はSHOPの「参拝帳の着せ替え収益」から月別・累計と制作審査を確認する。', '制作権利は価格未定・販売停止。価格と開始は運営の案内を待つ。', '販売開始後は本人用の着せ替えWebにある「制作工房」で権利を買い、自分用保存または運営への販売申請を行う。'], postText: '【参拝帳の制作工房を用意しました】背景・フレームを自分用に使ったり、運営の確認後に販売できる制作権利を用意しました。作品の売上は制作者70％・運営30％です。制作権利は価格が決まるまで販売停止中です。開始と価格は運営からの案内をお待ちください。', imagePrompt: '和風の参拝帳と制作工房の案内。背景・透過フレーム→運営確認→販売、の流れと「制作者70％・運営30％」を図解。「制作権利は販売準備中」と明示し、未定の価格や販売開始日を作らない。', notes: '現在は権利販売停止です。開始前に購入を促す案内や架空の価格を出さないでください。' } },
