/** 絵馬の招待者欄だけを読む。自己紹介のほかの項目から名前を推測しない。 */
export const INTRO_INVITER_MAX = 200;

export function introInviterText(content: string): string {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const field = /^(?:【\s*(?:招待者|招待主|紹介者)\s*】|\[\s*(?:招待者|招待主|紹介者)\s*\]|(?:招待者|招待主|紹介者)\s*[:：])\s*[:：]?\s*(.*)$/u;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!.trim().replace(/^(?:>\s*|[-*]\s+|#{1,6}\s+)/u, '').replace(/\*\*/g, '');
    const match = field.exec(line);
    if (!match) continue;
    let value = match[1]!.trim();
    if (!value) {
      // 次の項目やテンプレートの説明まで読まない。
      for (let next = n + 1; next < lines.length; next++) {
        const candidate = lines[next]!.trim().replace(/^>\s*/u, '');
        if (!candidate) continue;
        if (/^(?:【|\[|```|~~~|#|-#)/u.test(candidate) || /^[^:：]{1,20}[:：]/u.test(candidate)) break;
        value = candidate.replace(/\*\*/g, '');
        break;
      }
    }
    // 同じ行に次の項目が続いていても、その本文を取り込まない。
    return value.split(/【|\[[^\]]{1,20}\]/u)[0]!.trim().slice(0, INTRO_INVITER_MAX);
  }
  return '';
}

export type IntroInviterMember = { id: string; name: string; username: string };
export type IntroInviterCandidate = { id: string; name: string; reason: 'メンション・ID一致' | '名前一致' };
const normalize = (v: string) => v.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/^@/, '').replace(/\s+/gu, '');

/** 名前は完全一致（さん等を外した形も含む）。同名はすべて候補に残し、1人に決めない。 */
export function matchIntroInviters(text: string, memberId: string, members: IntroInviterMember[]): IntroInviterCandidate[] {
  const ids = [...text.matchAll(/<@!?(\d{17,20})>|(?<!\d)(\d{17,20})(?!\d)/g)].map(m => m[1] ?? m[2]!);
  const names = text.split(/[,、/／\n]/u).flatMap(v => {
    const name = normalize(v.trim());
    return [name, name.replace(/(?:さん|さま|様|くん|君|ちゃん)$/u, '')];
  }).filter(v => v && !/^(?:なし|無し|いない|いません|不明|未記入|自分|自分自身|none|unknown|ー|-|—)$/u.test(v));
  return members.filter(m => m.id !== memberId && (ids.length ? ids.includes(m.id) : names.some(n => n === normalize(m.name) || n === normalize(m.username))))
    .map(m => ({ id: m.id, name: m.name, reason: ids.length ? 'メンション・ID一致' : '名前一致' }));
}
