import { describe, expect, it } from 'vitest';
import { HomePage } from '../src/web/views/pages.js';
import type { AdminSession } from '../src/db/schema.js';
const now = new Date('2026-10-08T03:00:00Z');
const session: AdminSession = {id:'sample',userId:'sample',username:'さくら',avatarUrl:null,level:'guji',pages:null,accountId:null,csrfToken:'sample-only',checkedAt:now,expiresAt:now,createdAt:now};
const props = {session, stats:{members:3,joined:1,left:0,promoted:0,shuin:0,yaku:0},todo:{applications:1,omairi:0,soudan:1,invites:3,permissions:null},recent:[],names:new Map<string,string>(),now,inviteRows:[]};
describe('ホームの案内と見られるページ', () => {
  it('権限が読めないときは未取得と表示して点検へ案内する', () => {
    const html = HomePage(props).toString();
    expect(html).toContain('未取得');
    expect(html).toContain('取得できませんでした');
    expect(html).toContain('href="/channels/check"');
    expect(html).toContain('href="/invites?filter=unknown#invite-rewards"');
  });
  it('制限された人にはほかのページへの操作や検索を出さない', () => {
    const html = HomePage({...props,session:{...session,pages:['home']},inviteRows:undefined}).toString();
    for(const href of ['/members','/channels/check','/invites','/soudan','/applications','/stats','/audit']) {
      expect(html).not.toContain(`href="${href}`);
    }
    expect(html).not.toContain('id="nav-search"');
    expect(html).toContain('data-theme-choice');
    expect(html).toContain('data-nav-toggle');
  });
});
