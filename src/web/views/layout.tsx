import type { Child } from 'hono/jsx';
import type { AdminSession } from '../../db/schema.js';
import { LEVEL_LABEL } from '../format.js';

type Nav = 'home' | 'members' | 'applications' | 'yaku' | 'soudan' | 'audit' | 'notices' | 'settings';

export function Layout(props: { title: string; session?: AdminSession; nav?: Nav; children: Child }) {
  const { session, nav } = props;
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="htmx-config" content='{"includeIndicatorStyles":false}' />
        <title>{`${props.title} | 社務所 Web`}</title>
        <link rel="stylesheet" href="/static/style.css" />
        <script src="/static/htmx.min.js" defer></script>
      </head>
      <body>
        {session && (
          <header class="top">
            <a class="brand" href="/">
              <span class="torii">⛩</span> 社務所 Web
              <small>咲楽ノ宮</small>
            </a>
            <nav>
              <a href="/" class={nav === 'home' ? 'on' : ''}>
                ホーム
              </a>
              <a href="/members" class={nav === 'members' ? 'on' : ''}>
                メンバー
              </a>
              <a href="/applications" class={nav === 'applications' ? 'on' : ''}>
                申請
              </a>
              <a href="/yaku" class={nav === 'yaku' ? 'on' : ''}>
                厄
              </a>
              <a href="/soudan" class={nav === 'soudan' ? 'on' : ''}>
                相談
              </a>
              <a href="/audit" class={nav === 'audit' ? 'on' : ''}>
                記録
              </a>
              {session.level === 'guji' && (
                <a href="/notices" class={nav === 'notices' ? 'on' : ''}>
                  掲示
                </a>
              )}
              {session.level === 'guji' && (
                <a href="/settings" class={nav === 'settings' ? 'on' : ''}>
                  設定
                </a>
              )}
            </nav>
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
          </header>
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
