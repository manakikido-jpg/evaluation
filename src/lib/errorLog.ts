import pino from 'pino';

const secretKey = /^(?:authorization|cookie|set-cookie|password|passphrase|secret|token|access_token|refresh_token|client_secret|clientSecret|discord_token|web_entry_key|backup_webhook_url|backup_passphrase|database_url)$/i;
const hidden = '[REDACTED]';

function clean(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === 'function') return '[Function]';
  if (typeof value === 'string') return value
    .replace(/(\/(?:webhooks|interactions)\/\d+\/)[A-Za-z0-9._-]+/g, `$1${hidden}`)
    .replace(/(\/link\/)[A-Za-z0-9_-]{20,}/g, `$1${hidden}`)
    .replace(/([?&](?:access_token|refresh_token|token|code|client_secret|key)=)[^&#\s"']+/gi, `$1${hidden}`);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 16) return '[Truncated]';
  if (seen.has(value)) return '[Circular]';
  if (ArrayBuffer.isView(value)) return `[${value.byteLength} bytes]`;
  if (value instanceof Date) return value.toJSON();
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(entry => clean(entry, seen, depth + 1));
    const source = value instanceof Error ? pino.stdSerializers.err(value) : value;
    return Object.fromEntries(Object.entries(source).map(([key, entry]) =>
      [key, secretKey.test(key) ? hidden : clean(entry, seen, depth + 1)]));
  } finally { seen.delete(value); }
}

/** エラーの種類・コード・場所は残し、URLや認証情報をログへ出さない。 */
export function serializeErrorForLog(error: unknown): unknown {
  return clean(error, new WeakSet(), 0);
}
