/**
 * 🧵 呼び名の切り替え（新制度④c：御朱印 → 結び）。
 *
 * ④ご縁のリセット（新制度のご縁の時代）が始まると、メンバーに見える言葉を「結び」に切り替える。
 * それまでは今までどおり「朱印・御朱印帳」。BOT が起動時と毎分、settings の new_system_started を見て
 * setMusubiMode で切り替える（切り替わったらコマンドの表示名も登録し直す）。
 *
 * 既定は OFF（今までの言葉）。言葉は呼ぶたびに決まるので、表示を作る関数の中で使うこと
 * （モジュールの読みこみ時に一度だけ作る定数に入れない）。
 */
let musubiMode = false;

/** 結びの言葉に切り替える（BOT が新制度の開始の印を見て呼ぶ） */
export function setMusubiMode(on: boolean): void {
  musubiMode = on;
}

/** いま結びの言葉か */
export function isMusubiMode(): boolean {
  return musubiMode;
}

/** 新制度（結び）なら newText、それまでは oldText（今までの言葉） */
export function w(oldText: string, newText: string): string {
  return musubiMode ? newText : oldText;
}
