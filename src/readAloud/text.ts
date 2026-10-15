/** 読み上げ専用。元の投稿や音声を保存しない。 */
export function spokenText(content: string, dictionary: Record<string, string>, maxChars: number): string {
  let text = content.slice(0, 8000)
    .replace(/```[\s\S]*?(?:```|$)/g, ' コード省略 ')
    .replace(/`[^`\n]*`/g, ' コード省略 ')
    .replace(/\|\|[\s\S]*?(?:\|\||$)/g, ' ネタバレ省略 ')
    .replace(/https?:\/\/\S+/gi, ' リンク省略 ')
    .replace(/<@!?\d+>|<@&\d+>|<#\d+>/g, ' メンション ')
    .replace(/<a?:([a-zA-Z0-9_]+):\d+>/g, ' $1 ')
    .replace(/@everyone|@here/g, ' 全体メンション ')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/[*_~>#]/g, ' ')
    .replace(/(.)\1{9,}/gu, '$1$1$1');
  for (const [word, reading] of Object.entries(dictionary).sort((a, b) => b[0].length - a[0].length)) text = text.split(word).join(reading);
  text = text.replace(/\s+/g, ' ').trim();
  const chars = [...text];
  return chars.length > maxChars ? chars.slice(0, maxChars).join('') + '、以下省略' : text;
}
