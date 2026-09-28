import type { Child } from 'hono/jsx';
import type { AdminSession } from '../../db/schema.js';
import { assetUrl } from '../assets.js';
import { LEVEL_LABEL } from '../format.js';

type Nav =
  | 'home'
  | 'stats'
  | 'economy'
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
  | 'temp'
  | 'invites'
  | 'notices'
  | 'channels'
  | 'shop'
  | 'settings';

/** 画面に出すログイン中の人（updatesUnseen: まだ読んでいない更新の数） */
export type SessionView = AdminSession & { updatesUnseen?: number };

type NavItem = { key: Nav; href: string; icon: string; label: string; gujiOnly?: boolean };

/** 左のメニュー（仲間ごと） */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: '見る',
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
      { key: 'invites', href: '/invites', icon: '🔗', label: '招待' },
      { key: 'interview', href: '/interview', icon: '🍵', label: '面談告知' },
      { key: 'minutes', href: '/minutes', icon: '📓', label: '議事録' },
    ],
  },
  {
    title: 'お金と品物',
    items: [
      { key: 'economy', href: '/economy', icon: '🪙', label: '経済' },
      { key: 'gacha', href: '/gacha', icon: '🎲', label: '物御籤' },
      { key: 'market', href: '/market', icon: '🏮', label: '市場' },
      { key: 'shop', href: '/shop', icon: '🛍', label: 'ショップ', gujiOnly: true },
    ],
  },
  {
    title: 'Discord の設定',
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

export function Layout(props: { title: string; session?: SessionView; nav?: Nav; scripts?: 'editor.js'[]; children: Child }) {
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
        <link rel="stylesheet" href={assetUrl('style.css')} />
        <script src={assetUrl('htmx.min.js')} defer></script>
        {(props.scripts ?? []).map((s) => (
          <script src={assetUrl(s)} defer></script>
        ))}
      </head>
      <body class={session ? 'with-side' : ''}>
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
              {unseen > 0 && (
                <a class="topbar-updates" href="/updates" title="新しい更新">
                  📰 <span class="badge">{unseen}</span>
                </a>
              )}
            </header>
            <aside class="side">
              <nav class="side-nav" aria-label="メニュー">
                {NAV_GROUPS.map((g) => {
                  const items = g.items.filter((i) => !i.gujiOnly || session.level === 'guji');
                  if (!items.length) return null;
                  return (
                    <div class="nav-group">
                      <div class="nav-title">{g.title}</div>
                      {items.map((i) => (
                        <a href={i.href} class={nav === i.key ? 'on' : ''} aria-current={nav === i.key ? 'page' : undefined}>
                          <span class="nav-icon" aria-hidden="true">
                            {i.icon}
                          </span>
                          {i.label}
                        </a>
                      ))}
                    </div>
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
        <main>{props.children}</main>
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
