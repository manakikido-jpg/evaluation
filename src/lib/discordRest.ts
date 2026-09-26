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
  /** BAN を解除する（BAN されていなければ 404 の DiscordHttpError） */
  unban(guildId: string, userId: string, reason: string): Promise<void>;
  kick(guildId: string, userId: string, reason: string): Promise<void>;
  /** 投稿済みのメッセージを書き換える（申請カードを「承認済み」にするなど） */
  editMessage(channelId: string, messageId: string, body: MessageBody): Promise<void>;
  /** チャンネルにメッセージを投稿する（掲示など）。メンションで通知は飛ばさない */
  sendMessage(channelId: string, body: MessageBody): Promise<{ id: string }>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  /** ピン留めする（pin = false で外す）。「ピン留めしました」のお知らせは消す */
  pinMessage(channelId: string, messageId: string, pin: boolean): Promise<void>;
  /** サーバーのチャンネル一覧（掲示の投稿先・{#チャンネル名} の差し込み用） */
  guildChannels(guildId: string): Promise<GuildChannel[]>;
  /** チャンネルの説明（トピック）を変える */
  editChannel(channelId: string, body: { topic?: string }): Promise<void>;
  /** チャンネルの権限の上書きを 1 つ書き換える（書き込める・読むだけの切り替え） */
  setChannelOverwrite(channelId: string, overwrite: ChannelOverwrite, reason: string): Promise<void>;
  /** サーバーのロール一覧（ショップのロールの品物を選ぶ用） */
  guildRoles(guildId: string): Promise<GuildRole[]>;
}

export type GuildRole = { id: string; name: string; position: number; managed: boolean; color: number };

export type MessageBody = { content?: string; embeds?: { title?: string; description?: string; color?: number }[]; components?: unknown[] };

export type GuildChannel = {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  position: number;
  topic?: string | null;
  permission_overwrites?: ChannelOverwrite[];
};

/** type: 0 = ロール、1 = メンバー。allow・deny は権限のビット（10 進の文字列） */
export type ChannelOverwrite = { id: string; type: 0 | 1; allow: string; deny: string };

/** Discord が失敗を返したとき（status で「メッセージが消されていた（404）」などを見分ける） */
export class DiscordHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const API = 'https://discord.com/api/v10';

export function createDiscordActions(botToken: string): DiscordActions {
  const call = async (method: string, path: string, opts: { reason?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { authorization: `Bot ${botToken}` };
    // Discord の監査ログに残る理由（日本語はエンコードが必要）
    if (opts.reason) headers['x-audit-log-reason'] = encodeURIComponent(opts.reason.slice(0, 400));
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(`${API}${path}`, {
        method,
        headers,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
      // 続けて投稿すると（掲示をまとめて反映するときなど）「少し待って」と言われるので、言われた秒数だけ待つ
      if (res.status !== 429 || attempt >= 3) break;
      const j = (await res.json().catch(() => ({}))) as { retry_after?: number };
      const wait = Math.ceil((j.retry_after ?? 1) * 1000) + 100;
      // 長く待つように言われたら、待たずに失敗にする（管理画面が何分も固まらないように）
      if (wait > 10_000) break;
      await new Promise((r) => setTimeout(r, wait));
    }
    if (!res.ok) throw new DiscordHttpError(`${method} ${path} failed: ${res.status} ${await res.text().catch(() => '')}`, res.status);
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
    unban: async (g, u, reason) => void (await call('DELETE', `/guilds/${g}/bans/${u}`, { reason })),
    kick: async (g, u, reason) => void (await call('DELETE', `/guilds/${g}/members/${u}`, { reason })),
    editMessage: async (c, m, body) =>
      void (await call('PATCH', `/channels/${c}/messages/${m}`, { body: { ...body, allowed_mentions: { parse: [] } } })),
    sendMessage: async (c, body) =>
      (await call('POST', `/channels/${c}/messages`, { body: { ...body, allowed_mentions: { parse: [] } } })) as { id: string },
    deleteMessage: async (c, m) => void (await call('DELETE', `/channels/${c}/messages/${m}`)),
    async pinMessage(c, m, pin) {
      await call(pin ? 'PUT' : 'DELETE', `/channels/${c}/messages/pins/${m}`, { reason: pin ? '掲示のピン留め' : '掲示のピン留めを外した' });
      if (!pin) return;
      // Discord が出す「○○がメッセージをピン留めしました」は、チャンネルが散らからないよう消す（できなくても構わない）
      try {
        const recent = (await call('GET', `/channels/${c}/messages?limit=10`)) as { id: string; type: number; message_reference?: { message_id?: string } }[];
        const notice = recent.find((x) => x.type === 6 && x.message_reference?.message_id === m);
        if (notice) await call('DELETE', `/channels/${c}/messages/${notice.id}`);
      } catch {
        // そのまま
      }
    },
    guildChannels: async (g) => (await call('GET', `/guilds/${g}/channels`)) as GuildChannel[],
    guildRoles: async (g) => (await call('GET', `/guilds/${g}/roles`)) as GuildRole[],
    editChannel: async (c, body) => void (await call('PATCH', `/channels/${c}`, { body })),
    setChannelOverwrite: async (c, o, reason) =>
      void (await call('PUT', `/channels/${c}/permissions/${o.id}`, { reason, body: { type: o.type, allow: o.allow, deny: o.deny } })),
  };
}
