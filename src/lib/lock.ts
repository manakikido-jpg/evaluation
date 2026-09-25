/**
 * キーごとに処理を 1 つずつ順番に実行する（同じ相手への朱印が同時に来ても、昇格の判定と発表が二重にならないように）。
 * BOT は 1 プロセスで動かす前提。
 */
export class KeyedLock {
  private tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
