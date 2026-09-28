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
  /** チャンネルの名前・説明（トピック）を変える */
  editChannel(channelId: string, body: { topic?: string; name?: string; nsfw?: boolean; user_limit?: number }): Promise<void>;
  /** チャンネルの権限の上書きを 1 つ書き換える（書き込める・読むだけの切り替え） */
  setChannelOverwrite(channelId: string, overwrite: ChannelOverwrite, reason: string): Promise<void>;
  /** チャンネル・カテゴリを作る（管理画面のチャンネル） */
  createChannel(guildId: string, body: CreateChannelInput, reason: string): Promise<GuildChannel>;
  /** 並び順・カテゴリを変える（lock_permissions: 移した先のカテゴリの権限に合わせる） */
  reorderChannels(guildId: string, list: ChannelPosition[], reason: string): Promise<void>;
  /** チャンネル・カテゴリを消す（中の書き込みも消える） */
  deleteChannel(channelId: string, reason: string): Promise<void>;
  /** サーバーのロール一覧（ショップのロールの品物を選ぶ用） */
  guildRoles(guildId: string): Promise<GuildRole[]>;
  /** メンバーのニックネームを変える（空で元の名前に戻す） */
  setNickname(guildId: string, userId: string, nick: string, reason: string): Promise<void>;
  /** ロールを作る（いちばん下、@everyone のすぐ上にできる） */
  createRole(guildId: string, body: RolePatch, reason: string): Promise<GuildRole>;
  /** ロールを消す（持っている人からも外れる） */
  deleteRole(guildId: string, roleId: string, reason: string): Promise<void>;
  /** ロールの名前・色・権限などを変える */
  editRole(guildId: string, roleId: string, body: RolePatch, reason: string): Promise<void>;
}

export type GuildRole = {
  id: string;
  name: string;
  position: number;
  managed: boolean;
  color: number;
  /** 権限のビット（10 進の文字列） */
  permissions?: string;
  /** メンバー一覧で分けて表示する */
  hoist?: boolean;
  /** 誰でも @ で呼べる */
  mentionable?: boolean;
  /** BOT のロールなら bot_id が入る */
  tags?: { bot_id?: string };
};

export type RolePatch = { name?: string; color?: number; hoist?: boolean; mentionable?: boolean; permissions?: string };

export type MessageBody = {
  content?: string;
  /** image.url に attachment://ファイル名 と書くと、いっしょに送った写真をカードの中に出す */
  embeds?: {
    title?: string;
    description?: string;
    color?: number;
    image?: { url: string };
    /** カードのいちばん上の小さい文字 */
    author?: { name: string };
    /** カードのいちばん下の小さい文字 */
    footer?: { text: string };
  }[];
  components?: unknown[];
  /** 通知を飛ばす相手（なければだれにも飛ばさない） */
  allowed_mentions?: { parse?: ('everyone' | 'roles' | 'users')[]; roles?: string[] };
  /** 書き換えのとき: 残す添付（[] で全部外す。書かなければそのまま） */
  attachments?: { id: string | number; filename?: string }[];
  /** いっしょに送るファイル（写真など） */
  files?: MessageFile[];
};

export type MessageFile = { name: string; contentType: string; data: Uint8Array };

export type GuildChannel = {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  position: number;
  topic?: string | null;
  /** Discord の年齢制限チャンネル */
  nsfw?: boolean;
  /** 通話の人数の上限（0 = なし） */
  user_limit?: number;
  permission_overwrites?: ChannelOverwrite[];
};

/** type: 0 = ロール、1 = メンバー。allow・deny は権限のビット（10 進の文字列） */
export type ChannelOverwrite = { id: string; type: 0 | 1; allow: string; deny: string };

export type ChannelPosition = { id: string; position: number; parent_id?: string | null; lock_permissions?: boolean };

/** 0: テキスト / 2: 通話 / 4: カテゴリ */
export type CreateChannelInput = { name: string; type: 0 | 2 | 4; parent_id?: string; topic?: string; user_limit?: number; permission_overwrites: ChannelOverwrite[] };

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
  const call = async (method: string, path: string, opts: { reason?: string; body?: unknown; files?: MessageFile[] } = {}) => {
    const headers: Record<string, string> = { authorization: `Bot ${botToken}` };
    // Discord の監査ログに残る理由（日本語はエンコードが必要）
    if (opts.reason) headers['x-audit-log-reason'] = encodeURIComponent(opts.reason.slice(0, 400));
    const multipart = Boolean(opts.files?.length);
    if (opts.body !== undefined && !multipart) headers['content-type'] = 'application/json';
    /** ファイルを送るときは multipart（本文は payload_json に）。待ってからもう一度送れるよう、毎回作る */
    const payload = () => {
      if (!multipart) return opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
      const form = new FormData();
      form.append('payload_json', JSON.stringify(opts.body ?? {}));
      opts.files!.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.data], { type: f.contentType }), f.name));
      return form;
    };
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      const body = payload();
      res = await fetch(`${API}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
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
    editMessage: async (c, m, { files, ...body }) =>
      void (await call('PATCH', `/channels/${c}/messages/${m}`, { body: { ...withAttachments(body, files), allowed_mentions: { parse: [] } }, files })),
    sendMessage: async (c, { files, ...body }) =>
      (await call('POST', `/channels/${c}/messages`, {
        body: { ...withAttachments(body, files), allowed_mentions: body.allowed_mentions ?? { parse: [] } },
        files,
      })) as { id: string },
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
    editRole: async (g, r, body, reason) => void (await call('PATCH', `/guilds/${g}/roles/${r}`, { reason, body })),
    setNickname: async (g, u, nick, reason) => void (await call('PATCH', `/guilds/${g}/members/${u}`, { reason, body: { nick: nick || null } })),
    createRole: async (g, body, reason) => (await call('POST', `/guilds/${g}/roles`, { reason, body })) as GuildRole,
    deleteRole: async (g, r, reason) => void (await call('DELETE', `/guilds/${g}/roles/${r}`, { reason })),
    editChannel: async (c, body) => void (await call('PATCH', `/channels/${c}`, { body })),
    createChannel: async (g, body, reason) => (await call('POST', `/guilds/${g}/channels`, { reason, body })) as GuildChannel,
    deleteChannel: async (c, reason) => void (await call('DELETE', `/channels/${c}`, { reason })),
    reorderChannels: async (g, list, reason) => void (await call('PATCH', `/guilds/${g}/channels`, { reason, body: list })),
    setChannelOverwrite: async (c, o, reason) =>
      void (await call('PUT', `/channels/${c}/permissions/${o.id}`, { reason, body: { type: o.type, allow: o.allow, deny: o.deny } })),
  };
}

/** 送るファイルを attachments に並べる（書き換えのとき、前の添付と入れ替わる） */
function withAttachments(body: Omit<MessageBody, 'files'>, files: MessageFile[] | undefined): Omit<MessageBody, 'files'> {
  if (!files?.length) return body;
  return { ...body, attachments: files.map((f, i) => ({ id: i, filename: f.name })) };
}
