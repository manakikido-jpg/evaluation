import type {Context} from 'hono';
import {getCookie} from 'hono/cookie';
export const CASINO_PRESENTATION_COOKIE='sakura_casino_presentation';
/**
 * 🎴 カジノの新しい表示（見た目だけ）。みんな新しい表示で、「元の表示へ」を押した人（クッキー '0'）だけ元の表示。
 * スロット（通常・AT 機）は、画面の側でいつも元の見た目にする。会員認証・ゲームの操作権限は別で維持する。
 */
export function casinoPresentation(c:Context):'immersive'|undefined{
 return getCookie(c,CASINO_PRESENTATION_COOKIE)==='0'?undefined:'immersive';
}
