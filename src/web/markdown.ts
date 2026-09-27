/**
 * 掲示のプレビュー: Discord の書き方（**太字** や # 見出しなど）を、だいたい Discord と同じ見た目の HTML にする。
 * 先に文字をすべてエスケープしてから決まったタグだけを足すので、本文に HTML を書いてもそのまま文字として出る。
 */

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** コードの中身をしまっておく目印（私用領域の文字。本文に入っていたら消す） */
const MARK_OPEN = '';
const MARK_CLOSE = '';
const MARK_RE = /(\d+)/g;

/** 1 行の中の飾り（エスケープ済みの文字に使う） */
function inline(escaped: string): string {
  return escaped
    .replace(/\*\*\*(?=\S)(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)(.+?)__/g, '<u>$1</u>')
    .replace(/\*(?=\S)(.+?)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_(?=\S)(.+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)(.+?)~~/g, '<s>$1</s>')
    .replace(/\|\|(.+?)\|\|/g, '<span class="md-spoiler">$1</span>')
    .replace(/\[([^\]\n]+)\]\((?:https?:\/\/|&lt;https?:\/\/)[^\s)]+\)/g, '<span class="md-link">$1</span>')
    .replace(/(^|\s)(@everyone|@here)(?!\w)/g, '$1<span class="md-mention">$2</span>');
}

/** 1 行を HTML の 1 ブロックにする */
function line(raw: string): string {
  let m: RegExpMatchArray | null;
  if ((m = raw.match(/^(#{1,3}) (.*)$/))) return `<div class="md-h${m[1]!.length}">${inline(escapeHtml(m[2]!))}</div>`;
  if ((m = raw.match(/^-# (.*)$/))) return `<div class="md-sub">${inline(escapeHtml(m[1]!))}</div>`;
  if ((m = raw.match(/^( *)[-*] (.*)$/))) return `<div class="md-li${m[1]!.length >= 2 ? ' md-in' : ''}">${inline(escapeHtml(m[2]!))}</div>`;
  if ((m = raw.match(/^( *)(\d{1,3})\. (.*)$/)))
    return `<div class="md-ol${m[1]!.length >= 2 ? ' md-in' : ''}">${m[2]}. ${inline(escapeHtml(m[3]!))}</div>`;
  if (!raw.trim()) return '<div class="md-gap"></div>';
  return `<div>${inline(escapeHtml(raw))}</div>`;
}

export function discordMarkdownToHtml(text: string): string {
  const codes: string[] = [];
  const keep = (html: string) => `${MARK_OPEN}${codes.push(html) - 1}${MARK_CLOSE}`;
  const src = text
    .replace(/[]/g, '')
    .replace(/\r\n/g, '\n')
    // ```言語\n中身``` のコードブロック
    .replace(/```(?:[\w+-]*\n)?([\s\S]*?)```/g, (_w, body: string) => keep(`<pre class="md-code">${escapeHtml(body.replace(/\n$/, ''))}</pre>`))
    // `コード`
    .replace(/(`{1,2})([^`\n]+?)\1/g, (_w, _q, body: string) => keep(`<code>${escapeHtml(body)}</code>`));

  const out: string[] = [];
  let quoteRest = false;
  for (const raw of src.split('\n')) {
    let m: RegExpMatchArray | null;
    if (!quoteRest && (m = raw.match(/^>>> (.*)$/))) {
      quoteRest = true;
      out.push(`<div class="md-quote">${line(m[1]!)}</div>`);
    } else if (quoteRest) {
      out.push(`<div class="md-quote">${line(raw)}</div>`);
    } else if ((m = raw.match(/^> (.*)$/))) {
      out.push(`<div class="md-quote">${line(m[1]!)}</div>`);
    } else {
      out.push(line(raw));
    }
  }
  return out.join('').replace(MARK_RE, (_w, i: string) => codes[Number(i)] ?? '');
}
