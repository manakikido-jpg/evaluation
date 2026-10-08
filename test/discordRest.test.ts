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

  it('写真を送るときは multipart（本文は payload_json、ファイルは files[0]）。待ってやり直すときも送り直す', async () => {
    const replies = [
      new Response(JSON.stringify({ retry_after: 0.01 }), { status: 429 }),
      new Response(JSON.stringify({ id: '9' }), { status: 200 }),
    ];
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => (calls.push(init), replies.shift()!)),
    );
    const data = new Uint8Array([1, 2, 3]);
    const r = await createDiscordActions('t').sendMessage('1', {
      content: '',
      embeds: [{ description: 'x', image: { url: 'attachment://a.png' } }],
      files: [{ name: 'a.png', contentType: 'image/png', data }],
    });
    expect(r).toEqual({ id: '9' });
    expect(calls).toHaveLength(2);
    const form = calls[1]!.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect((calls[1]!.headers as Record<string, string>)['content-type']).toBeUndefined();
    const payload = JSON.parse(form.get('payload_json') as string);
    expect(payload).toEqual({
      content: '',
      embeds: [{ description: 'x', image: { url: 'attachment://a.png' } }],
      attachments: [{ id: 0, filename: 'a.png' }],
      allowed_mentions: { parse: [] },
    });
    const file = form.get('files[0]') as File;
    expect(file.name).toBe('a.png');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(data);
  });
});

it('上下2枚の写真とボタンの旗を、multipartでも保持する', async () => {
  const { panelMessage } = await import('../src/discord/panels.js');
  const panel = panelMessage('gacha');
  const calls: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { calls.push(init); return new Response('{"id":"sample"}', {status: 200}); }));
  await createDiscordActions('test-only').sendMessage('sample', { ...panel, files: panel.files.map(f => ({name: f.name, contentType: 'image/png', data: new Uint8Array([1,2,3])})) });
  const form = calls[0]!.body as FormData;
  const body = JSON.parse(form.get('payload_json') as string);
  expect(body.flags).toBe(panel.flags);
  expect(body.components.map((c: {type: number}) => c.type)).toEqual([12,1,12,1]);
  expect(body).not.toHaveProperty('embeds');
  expect(body.attachments.map((a: {filename: string}) => a.filename)).toEqual(['gacha-prayer.png', 'casino-gacha-banner.png']);
  expect(form.get('files[1]')).toBeInstanceOf(File);
});
