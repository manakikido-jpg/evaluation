/** 管理画面が使う Discord API（テストでは偽物に差し替える） */
export interface DiscordApi {
  /** Discord のログイン画面の URL */
  authorizeUrl(state: string, redirectUri: string): string;
  /** 認可コードをアクセストークンに交換 */
  exchangeCode(code: string, redirectUri: string): Promise<string>;
  /** ログインした本人 */
  me(accessToken: string): Promise<DiscordUser>;
  /** サーバーでのロール（サーバーにいなければ null）。BOT のトークンで調べる */
  memberRoles(guildId: string, userId: string): Promise<string[] | null>;
}

export type DiscordUser = { id: string; username: string; displayName: string; avatarUrl: string | null };

const API = 'https://discord.com/api/v10';

export function createDiscordApi(opts: { clientId: string; clientSecret: string; botToken: string }): DiscordApi {
  return {
    authorizeUrl(state, redirectUri) {
      const q = new URLSearchParams({
        client_id: opts.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        // メールなどは取らない
        scope: 'identify',
        state,
        prompt: 'none',
      });
      return `https://discord.com/oauth2/authorize?${q}`;
    },

    async exchangeCode(code, redirectUri) {
      const res = await fetch(`${API}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
      const json = (await res.json()) as { access_token: string };
      return json.access_token;
    },

    async me(accessToken) {
      const res = await fetch(`${API}/users/@me`, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error(`users/@me failed: ${res.status}`);
      const u = (await res.json()) as { id: string; username: string; global_name: string | null; avatar: string | null };
      return {
        id: u.id,
        username: u.username,
        displayName: u.global_name ?? u.username,
        avatarUrl: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null,
      };
    },

    async memberRoles(guildId, userId) {
      const res = await fetch(`${API}/guilds/${guildId}/members/${userId}`, {
        headers: { authorization: `Bot ${opts.botToken}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`guild member lookup failed: ${res.status}`);
      const m = (await res.json()) as { roles: string[] };
      return m.roles;
    },
  };
}
