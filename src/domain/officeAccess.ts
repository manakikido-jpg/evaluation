import { WEB_PAGE_KEYS, type WebPage } from '../config.js';

/** セットは出発点。保存するときは選択されたページを固定し、後から増えたページを自動で渡さない。 */
export const OFFICE_PRESETS: { id: string; label: string; pages: WebPage[]; writePages: WebPage[] }[] = [
  { id: 'guide', label: '案内', pages: ['guide', 'members', 'applications', 'interview'], writePages: ['guide', 'applications', 'interview'] },
  { id: 'events', label: 'イベント', pages: ['board', 'minutes', 'ideas', 'economy'], writePages: ['board', 'minutes', 'ideas'] },
  { id: 'safety', label: '治安', pages: ['security', 'members', 'yaku', 'soudan', 'tickets', 'audit'], writePages: ['security', 'yaku', 'soudan', 'tickets'] },
  { id: 'economy', label: '経済', pages: ['economy', 'gacha', 'market', 'invites'], writePages: ['economy', 'gacha', 'market'] },
  { id: 'reader', label: '閲覧のみ', pages: ['stats', 'glossary', 'org'], writePages: [] },
];
export function parseOfficeGrant(body: Record<string, unknown>): { pages: WebPage[]; writePages: WebPage[] } {
  const pages = WEB_PAGE_KEYS.filter(k => body[`page_${k}`] === 'read' || body[`page_${k}`] === 'write');
  return { pages, writePages: pages.filter(k => body[`page_${k}`] === 'write') };
}
export function canViewOffice(access: { level: string; pages: readonly string[] | null }, page: WebPage): boolean {
  return access.level === 'guji' || access.pages === null || access.pages.includes(page);
}
