import type { Child } from 'hono/jsx';
import type { AdminSession } from '../../db/schema.js';
import { assetUrl } from '../assets.js';
import { LEVEL_LABEL } from '../format.js';

type Nav =
  | 'home'
  | 'stats'
  | 'economy'
  | 'casino'
  | 'glossary'
  | 'voice'
  | 'updates'
  | 'roles'
  | 'ranks'
  | 'market'
  | 'gacha'
  | 'interview'
  | 'members'
  | 'applications'
  | 'yaku'
  | 'soudan'
  | 'audit'
  | 'commands'
  | 'minutes'
  | 'ideas'
  | 'temp'
  | 'invites'
  | 'gift'
  | 'board'
  | 'guide'
  | 'cast'
  | 'notices'
  | 'channels'
  | 'shop'
  | 'settings';

/** 画面に出すログイン中の人（updatesUnseen: まだ読んでいない更新の数） */
export type SessionView = AdminSession & { updatesUnseen?: number };

/** page: 見られるページを選ばれている人に出すかを決めるページ（なければ key） */
type NavItem = { key: Nav; href: string; icon: string; label: string; gujiOnly?: boolean; page?: string };

/** 左のメニュー（仲間ごと） */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'ホーム・記録',
    items: [
      { key: 'home', href: '/', icon: '🏠', label: 'ホーム' },
      { key: 'stats', href: '/stats', icon: '📈', label: '推移' },
      { key: 'voice', href: '/voice', icon: '🎙', label: '通話の記録' },
      { key: 'audit', href: '/audit', icon: '📜', label: '記録' },
      { key: 'commands', href: '/commands', icon: '⌨', label: 'コマンド' },
    ],
  },
  {
    title: 'メンバー対応',
    items: [
      { key: 'members', href: '/members', icon: '👥', label: 'メンバー' },
      { key: 'applications', href: '/applications', icon: '📝', label: '申請' },
      { key: 'yaku', href: '/yaku', icon: '👹', label: '厄' },
      { key: 'soudan', href: '/soudan', icon: '💌', label: '相談' },
      { key: 'temp', href: '/temp', icon: '⏳', label: '一時的な権限' },
      { key: 'invites', href: '/invites', icon: '🔗', label: '招待・報酬' },
      { key: 'interview', href: '/interview', icon: '🍵', label: '面談告知' },
      { key: 'minutes', href: '/minutes', icon: '📓', label: '議事録' },
      { key: 'ideas', href: '/ideas', icon: '💡', label: 'アイデア・共有' },
    ],
  },
  {
    title: 'お金と品物',
    items: [
      { key: 'economy', href: '/economy', icon: '🪙', label: '経済' },
      { key: 'casino', href: '/economy/casino', icon: '🎰', label: 'カジノ', page: 'economy' },
      { key: 'gift', href: '/gacha#gacha-gift', icon: '🎁', label: 'みんなに配る', gujiOnly: true },
      { key: 'gacha', href: '/gacha', icon: '🎲', label: '物御籤' },
      { key: 'market', href: '/market', icon: '🏮', label: '市場' },
      { key: 'board', href: '/board', icon: '📌', label: '掲示板' },
      { key: 'guide', href: '/guide', icon: '🌸', label: '案内・給与' },
      { key: 'cast', href: '/cast', icon: '🎀', label: 'キャスト' },
      { key: 'shop', href: '/shop', icon: '🛍', label: 'ショップ', gujiOnly: true },
    ],
  },
  {
    title: '鯖の設定',
    items: [
      { key: 'notices', href: '/notices', icon: '🪧', label: '掲示', gujiOnly: true },
      { key: 'channels', href: '/channels', icon: '📁', label: 'チャンネル', gujiOnly: true },
      { key: 'roles', href: '/roles', icon: '🎭', label: 'ロール', gujiOnly: true },
      { key: 'ranks', href: '/ranks', icon: '⛩', label: '役職', gujiOnly: true },
      { key: 'glossary', href: '/glossary', icon: '📖', label: '用語集' },
      { key: 'settings', href: '/settings', icon: '⚙', label: '設定', gujiOnly: true },
    ],
  },
];

function ThemeChoice() {
  return <label class="theme-choice"><span aria-hidden="true">◐</span><span class="sr-only">表示モード</span>
    <select data-theme-choice aria-label="表示モード" disabled><option value="auto">端末に合わせる</option><option value="light">ライト</option><option value="dark">ダーク</option></select>
    <span class="sr-only" data-theme-status role="status"></span>
  </label>;
}

export function Layout(props: { title: string; session?: SessionView; nav?: Nav; scripts?: ('editor.js' | 'perms.js' | 'charts.js' | 'invite-selection.js')[]; /** 画面の横いっぱいに使う（大きな表のページ） */ wide?: boolean; children: Child }) {
  const { session, nav } = props;
  const unseen = session?.updatesUnseen ?? 0;
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="htmx-config" content='{"includeIndicatorStyles":false}' />
        <title>{`${props.title} | 社務所 Web`}</title>
        <script src={assetUrl('theme.js')}></script>
        <link rel="stylesheet" href={assetUrl('style.css')} />
        <script src={assetUrl('htmx.min.js')} defer></script>
        {(props.scripts ?? []).map((s) => (
          <script src={assetUrl(s)} defer></script>
        ))}
      </head>
      <body class={session ? 'with-side' : ''}>
        <a class="skip-link" href="#main-content">本文へ移動</a>
        {!session && <div class="guest-theme"><ThemeChoice /></div>}
        {session && (
          <>
            {/* ☰ で開け閉め（パソコン: チェックで閉じる／スマホ: チェックで開く）。JS がなくても動き、JS はパソコンで閉じたかを覚えるだけ */}
            <input type="checkbox" id="nav-toggle" class="nav-toggle" aria-label="メニューを開け閉めする" />
            <script src={assetUrl('menu.js')}></script>
            <header class="topbar">
              <label for="nav-toggle" class="hamburger" title="メニュー">
                <span></span>
                <span></span>
                <span></span>
              </label>
              <a class="brand" href="/">
                <span class="torii">⛩</span> 社務所 Web
                <small>咲楽ノ宮</small>
              </a>
              <span class="topbar-page">{props.title}</span>
              {(!session.pages || session.pages.includes('members')) && <form class="topbar-search" method="get" action="/members"><label class="sr-only" for="nav-search">メンバーを検索</label><input id="nav-search" type="search" name="q" placeholder="メンバーを検索" /><button type="submit" aria-label="メンバーを検索">⌕</button></form>}
              <div class="topbar-tools"><ThemeChoice /></div>
              {unseen > 0 && (
                <a class="topbar-updates" href="/updates" title="新しい更新">
                  📰 <span class="badge">{unseen}</span>
                </a>
              )}
            </header>
            <aside class="side" id="main-navigation">
              <nav class="side-nav" aria-label="メニュー">
                {NAV_GROUPS.map((g) => {
                  // 宮司だけのページ・見られるページを選ばれている人の、ほかのページは出さない
                  const items = g.items.filter((i) => (!i.gujiOnly || session.level === 'guji') && (!session.pages || session.pages.includes((i.page ?? i.key) as never)));
                  if (!items.length) return null;
                  // 見出しを押すと折りたためる（閉じたかは menu.js が覚える。今いるページの仲間は開いておく）
                  return (
                    <details class="nav-group" open data-group={g.title}>
                      <summary class="nav-title">{g.title}</summary>
                      <div class="nav-items">
                        {items.map((i) => (
                          <a href={i.href} class={nav === i.key ? 'on' : ''} aria-current={nav === i.key ? 'page' : undefined}>
                            <span class="nav-icon" aria-hidden="true">
                              {i.icon}
                            </span>
                            {i.label}
                          </a>
                        ))}
                      </div>
                    </details>
                  );
                })}
                <div class="nav-group">
                  <a href="/updates" class={nav === 'updates' ? 'on' : ''} aria-current={nav === 'updates' ? 'page' : undefined}>
                    <span class="nav-icon" aria-hidden="true">
                      📰
                    </span>
                    更新履歴
                    {unseen > 0 && (
                      <span class="badge" aria-label={`新しい更新 ${unseen} 件`}>
                        {unseen}
                      </span>
                    )}
                  </a>
                </div>
                <div class="me">
                  {session.avatarUrl && <img src={session.avatarUrl} alt="" width="28" height="28" />}
                  <span>
                    {session.username}
                    <small>{LEVEL_LABEL[session.level]}</small>
                  </span>
                  <form method="post" action="/logout">
                    <input type="hidden" name="_csrf" value={session.csrfToken} />
                    <button type="submit" class="link">
                      ログアウト
                    </button>
                  </form>
                </div>
              </nav>
            </aside>
            {/* スマホ: メニューの外を押すと閉じる */}
            <label for="nav-toggle" class="backdrop" aria-hidden="true"></label>
          </>
        )}
        <main id="main-content" class={props.wide ? 'wide' : undefined}>{props.children}</main>
        {session && <nav class="mobile-nav" aria-label="よく使うページ">
          {[
            { key: 'home', href: '/', icon: '⌂', label: 'ホーム' },
            { key: 'members', href: '/members', icon: '♙', label: 'メンバー' },
            { key: 'invites', href: '/invites', icon: '↗', label: '招待' },
          ].filter(item => !session.pages || session.pages.includes(item.key as never)).map(item => <a href={item.href} class={nav === item.key ? 'on' : ''} aria-current={nav === item.key ? 'page' : undefined}><span aria-hidden="true">{item.icon}</span>{item.label}</a>)}
          <button type="button" data-nav-toggle aria-controls="main-navigation" aria-expanded="false"><span aria-hidden="true">☰</span>メニュー</button>
        </nav>}
        {session && (
          <>
            {/* ポップアップ（data-popup の付いたものを押すと、ここに中身を出す） */}
            <dialog id="popup" class="popup">
              <div class="popup-head">
                <button type="button" class="link" data-popup-close>
                  ✕ 閉じる
                </button>
              </div>
              <div id="popup-body"></div>
            </dialog>
            <script src={assetUrl('popup.js')} defer></script>
          </>
        )}
      </body>
    </html>
  );
}

export function Avatar(props: { url: string | null; size?: number }) {
  const size = props.size ?? 32;
  return props.url ? (
    <img class="avatar" src={props.url} alt="" width={size} height={size} loading="lazy" />
  ) : (
    <span class={`avatar blank s${size}`}></span>
  );
}
