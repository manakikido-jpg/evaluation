/**
 * BOT のトークンで Discord を操作する（ロール・DM・BAN・キック）。
 * BOT 本体と管理画面の両方から同じ処理で使う。テストでは偽物に差し替える。
 */
export interface DiscordActions {
  addRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void>;
  removeRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void>;
  /** DM を送る。DM を受け取らない設定の人などには届かないので false */
  sendDm(userId: string, content: string): Promise<boolean>;
  ban(guildId: string, userId: string, reason: string): Promise<void>;
  kick(guildId: string, userId: string, reason: string): Promise<void>;
}

const API = 'https://discord.com/api/v10';

export function createDiscordActions(botToken: string): DiscordActions {
  const call = async (method: string, path: string, opts: { reason?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { authorization: `Bot ${botToken}` };
    // Discord の監査ログに残る理由（日本語はエンコードが必要）
    if (opts.reason) headers['x-audit-log-reason'] = encodeURIComponent(opts.reason.slice(0, 400));
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text().catch(() => '')}`);
    return res.status === 204 ? undefined : res.json();
  };

  return {
    addRole: async (g, u, r, reason) => void (await call('PUT', `/guilds/${g}/members/${u}/roles/${r}`, { reason })),
    removeRole: async (g, u, r, reason) => void (await call('DELETE', `/guilds/${g}/members/${u}/roles/${r}`, { reason })),
    async sendDm(userId, content) {
      try {
        const ch = (await call('POST', '/users/@me/channels', { body: { recipient_id: userId } })) as { id: string };
        await call('POST', `/channels/${ch.id}/messages`, { body: { content, allowed_mentions: { parse: [] } } });
        return true;
      } catch {
        return false;
      }
    },
    ban: async (g, u, reason) => void (await call('PUT', `/guilds/${g}/bans/${u}`, { reason, body: { delete_message_seconds: 0 } })),
    kick: async (g, u, reason) => void (await call('DELETE', `/guilds/${g}/members/${u}`, { reason })),
  };
}
