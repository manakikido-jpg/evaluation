/** 実際の送信データによる見本。Discordへ送信せず、公開設定も保存しない。 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { controlPanel } from '../../src/discord/controlPanel.js';
import { vcPanel } from '../../src/discord/views.js';
import { setMusubiMode, setNewSystemVisible } from '../../src/domain/terms.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const nameMap: Record<string, string> = {}, now = new Date('2026-11-27T12:00:00Z');
const channel = '950000000000000001', owner = '810000000000000001';
const entrance = JSON.parse(JSON.stringify(vcPanel(channel, false, false, true, true)));
const before = JSON.parse(JSON.stringify(controlPanel(channel, owner)));
setMusubiMode(true); setNewSystemVisible(true);
const active = JSON.parse(JSON.stringify(controlPanel(channel, owner)));
setMusubiMode(false); setNewSystemVisible(false);
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function markdown(s = '') {
  return escape(s)
    .replace(/&lt;@(\d+)&gt;/g, (_, id) => `<span class="mention">@${escape(nameMap[id] || '参加者')}</span>`)
    .replace(/&lt;t:(\d+):R&gt;/g, (_, t) => `<span class="timestamp">あと${Math.max(0, Math.ceil((Number(t) * 1000 - +now) / 86400000))}日</span>`)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '<span class="preview-link">$1</span>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^&gt; (.*)$/gm, '<span class="quote">$1</span>')
    .replace(/\n/g, '<br>');
}
function renderMessage(payload: any) {
  if (payload.flags & 32768) {
    const items = payload.components[0].components.map((c: any) => {
      if (c.type === 14) return '<hr>';
      if (c.type === 10) return `<div class="v2-heading">${markdown(c.content).replace(/^## ([^<]+)/, '<h3>$1</h3>')}</div>`;
      if (c.type === 9) return `<div class="v2-row"><div>${c.components.map((t: any) => markdown(t.content)).join('')}</div><button type="button" class="button-${c.accessory.style}">${escape(c.accessory.label)}</button></div>`;
      return '';
    }).join('');
    return `<div class="bot-line">⛩ <strong>社務所</strong> <span class="bot-tag">APP</span><small>21:00</small></div><article class="v2-panel">${items}</article>`;
  }
  const embeds = (payload.embeds || []).map((embed: any) => {
    const groups: any[][] = [];
    for (const f of embed.fields || []) {
      const last = groups.at(-1);
      if (f.inline && last?.[0]?.inline && last.length < 3) last.push(f); else groups.push([f]);
    }
    return `<article class="embed ${embed.color === 0xf7a8b8 ? 'sakura' : embed.color === 0x8a8a8a ? 'gray' : 'shu'}"><h3>${markdown(embed.title)}</h3>${embed.description ? `<div class="description">${markdown(embed.description)}</div>` : ''}${groups.map(g => `<div class="fields-row cols-${g.length}">${g.map(f => `<section class="field"><h4>${markdown(f.name)}</h4><div>${markdown(f.value)}</div></section>`).join('')}</div>`).join('')}${embed.footer ? `<footer>${markdown(embed.footer.text)}</footer>` : ''}</article>`;
  }).join('');
  const controls = (payload.components || []).map((row: any) => `<div class="controls">${row.components.map((c: any) => c.options ? `<select aria-label="${escape(c.placeholder || '相手を選ぶ')}"><option selected disabled>${escape(c.placeholder || '相手を選ぶ')}</option>${c.options.map((o: any) => `<option>${escape(o.label)} — ${escape(o.description || '')}</option>`).join('')}</select>` : `<button type="button" class="button-${c.style}">${escape(c.emoji?.name || '')} ${escape(c.label || '操作')}</button>`).join('')}</div>`).join('');
  return `<div class="bot-line">⛩ <strong>社務所</strong> <span class="bot-tag">APP</span><small>21:00</small></div>${payload.content ? `<p>${markdown(payload.content)}</p>` : ''}${embeds}${controls}`;
}

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>縁側の操作パネル見本</title><link rel="stylesheet" href="engawa-control-panel.css"></head><body><header><h1>縁側の操作パネル</h1><p>実際のBOT送信データによる表示見本。Discordの描画は近似です。画像装飾なし・本番未反映。左に説明、右に操作ボタン。</p></header><main><section class="snapshot" id="control-preview"><h2 class="label">① インチャの共有入口</h2><div class="chat">${renderMessage(entrance)}</div><h2 class="label">② 押した本人だけに表示（新制度公開後）</h2><div class="chat">${renderMessage(active)}</div></section><section class="snapshot"><h2 class="label">新制度の公開前は3項目</h2><div class="chat">${renderMessage(before)}</div></section></main></body></html>`;
await writeFile(root + 'docs/previews/engawa-control-panel.html', html);
await writeFile(root + 'docs/previews/engawa-control-panel.json', JSON.stringify({ entrance, beforeRelease: before, afterRelease: active }, null, 2) + '\n');
