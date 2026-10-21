import { expect, it } from 'vitest';
import { Layout } from '../src/web/views/layout.js';
import type { AdminSession } from '../src/db/schema.js';
const session: AdminSession = { id:'preview', userId:'700000000000000001', username:'運営', avatarUrl:null, level:'guji', pages:null, accountId:null, csrfToken:'test', checkedAt:new Date(), expiresAt:new Date(), createdAt:new Date() };

it('ページ検索の対象は閲覧できるページだけで、宮司限定リンクを広げない',()=>{
  const html=Layout({title:'ホーム', session:{...session,level:'shinshoku',pages:['home','members']}, nav:'home', children:'ホーム'}).toString();
  expect(html).toContain('data-nav-search');
  expect(html).toContain('href="/members"');
  expect(html).not.toContain('href="/settings"');
  expect(html).not.toContain('href="/roles"');
  expect(html).not.toContain('href="/economy"');
  expect(html).toContain('aria-current="page"');
});
it('共通操作を外部JSで読み、本文への移動先と明示的な閉じるボタンを備える',()=>{
  const html=Layout({title:'設定',session,nav:'settings',children:'設定'}).toString();
  expect(html).toContain('/static/office-ui.js?v=');
  expect(html).toContain('data-nav-close');
  expect(html).toContain('id="main-content" tabindex="-1"');
  expect(html).not.toMatch(/onclick=|style=|<script>/);
});
it('ログイン前には運営メニューと社務所用JSを出さない',()=>{
  const html=Layout({title:'ログイン',children:'ログイン'}).toString();
  expect(html).not.toContain('data-nav-search');
  expect(html).not.toContain('office-ui.js');
  expect(html).not.toContain('href="/members"');
});
it('通常画面はその場保存に対応し、専用エディタとログイン画面は通常送信を維持する', () => {
  const normal = Layout({title:'役職',session,children:'設定'}).toString();
  expect(normal).toContain('data-office-inplace');
  expect(normal).toContain('/static/office-actions.js?v=');
  const editor = Layout({title:'掲示',session,scripts:['editor.js'],children:'編集'}).toString();
  expect(editor).not.toContain('data-office-inplace');
  const guest = Layout({title:'ログイン',children:'ログイン'}).toString();
  expect(guest).not.toContain('office-actions.js');
  expect(guest).not.toContain('data-office-inplace');
});
