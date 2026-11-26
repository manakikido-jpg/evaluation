import pino from 'pino';
import { expect, it } from 'vitest';
import { serializeErrorForLog } from '../src/lib/errorLog.js';

it('Discordの失敗を実際にログへ書くときも、秘密URLと認証情報を伏せてコードは残す', () => {
  const output: string[] = [];
  const logger = pino({ serializers: { err: serializeErrorForLog } }, { write: line => { output.push(line); } });
  const url = 'https://discord.com/api/v10/webhooks/123456789012345678/test-webhook-token/messages/@original';
  const error = Object.assign(new Error(`Request failed ${url}`), {
    status: 400, code: 50035, url,
    requestBody: { json: { content: 'テスト', components: [{ url: 'https://example.test/casino/link/abcdefghijklmnopqrstuvwxyz01234567890123456' }] } },
    headers: { authorization: 'Bot test-authorization', cookie: 'test-cookie' },
  });
  logger.warn({ err: error, feature: 'rooms' }, 'request failed');
  const text = output.join('');
  for (const secret of ['test-webhook-token', 'test-authorization', 'test-cookie', 'abcdefghijklmnopqrstuvwxyz01234567890123456']) expect(text).not.toContain(secret);
  const logged = JSON.parse(output[0]!);
  expect(logged.err.code).toBe(50035);
  expect(logged.err.status).toBe(400);
  expect(logged.err.url).toContain('/webhooks/123456789012345678/[REDACTED]/messages/@original');
  expect(logged.err.stack).toContain('Error: Request failed');
  // 元のエラーや、再送に使うリクエストは書きかえない。
  expect(error.url).toBe(url);
  expect(error.headers.authorization).toBe('Bot test-authorization');
});

it('InteractionのURL・認証クエリ・入れ子の秘密を伏せ、循環する原因も扱える', () => {
  const details: Record<string, unknown> = {
    url: 'https://discord.com/api/v10/interactions/123456789012345678/test-interaction-token/callback',
    oauth: 'https://example.test/callback?code=test-code&state=public-state&access_token=test-access',
    nested: { clientSecret: 'test-client-secret', refresh_token: 'test-refresh', code: 10062 },
    toJSON: () => ({ token: 'test-function-secret' }),
  };
  details.self = details;
  const error = Object.assign(new Error('failed'), { details });
  const result = serializeErrorForLog(error) as { details: Record<string, unknown> };
  const text = JSON.stringify(result);
  for (const secret of ['test-interaction-token', 'test-code', 'test-access', 'test-client-secret', 'test-refresh', 'test-function-secret']) expect(text).not.toContain(secret);
  expect(text).toContain('public-state');
  expect(text).toContain('10062');
  expect(result.details.self).toBe('[Circular]');
});
