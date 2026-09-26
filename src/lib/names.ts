/**
 * 飾り（絵文字・記号・区切り線・空白）を除いた名前。
 * 「------📜 掲示 📜------」「📜｜授与所」のように見た目を変えても、同じチャンネルだと分かるように。
 */
export const coreName = (name: string) => name.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
