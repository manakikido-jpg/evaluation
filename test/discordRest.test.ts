import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiscordActions, DiscordHttpError } from '../src/lib/discordRest.js';

afterEach(() => vi.unstubAllGlobals());

describe('Discord REST', () => {
  it('「少し待って（429）」と言われたら、待ってからやり直す', async () => {
    const replies = [
      new Response(JSON.stringify({ retry_after: 0.01 }), { status: 429 }),
      new Response(JSON.stringify({ id: '123' }), { status: 200 }),
    ];
    const fetch = vi.fn(async () => replies.shift()!);
    vi.stubGlobal('fetch', fetch);
    expect(await createDiscordActions('t').sendMessage('1', { content: 'x' })).toEqual({ id: '123' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('失敗したときは status 付きのエラー（メッセージが消されていた 404 を見分ける）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"Unknown Message"}', { status: 404 })));
    const err = await createDiscordActions('t').editMessage('1', '2', { content: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DiscordHttpError);
    expect((err as DiscordHttpError).status).toBe(404);
  });
});
