import { assetUrl } from '../assets.js';

/** 競馬だけに読み込む共通の見た目。ゲームの処理は持たない。 */
export const KeibaTheme = () => <><link rel="stylesheet" href={assetUrl('keiba-theme.css')}/><span class="kb-theme" hidden/></>;
const links = [
  ['/casino/tables/keiba', '観戦・馬券'],
  ['/casino/keiba/stable', '馬主の部屋'],
  ['/casino/keiba/club', '育成・収支'],
  ['/casino/keiba/events', '大会・ランキング'],
  ['/casino/keiba/replays', 'リプレイ'],
] as const;
export const KeibaNav = (p: { current?: string }) => <nav class="kb-theme-nav" aria-label="競馬のメニュー">{links.map(([href, label]) => <a href={href} aria-current={p.current === href ? 'page' : undefined}>{label}</a>)}</nav>;
export const KeibaHero = (p: { title: string; note: string }) => <header class="kb-theme-hero"><p>咲楽ノ宮 競馬場 <span aria-hidden="true">✿</span></p><h1>{p.title}</h1><div>{p.note}</div></header>;
