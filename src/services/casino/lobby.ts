import { and, desc, eq, inArray } from 'drizzle-orm';
import type { CasinoConfig, CasinoGame, GuildConfig, TableKind } from '../../config.js';
import type { Db } from '../../db/client.js';
import { casinoGames, type CasinoTable } from '../../db/schema.js';
import { ENGINES } from './tables/engines.js';

export const LOBBY_TABLE_GAMES: CasinoGame[] = ['poker', 'bj_table', 'baccarat_table', 'roulette_table', 'chinchiro_table', 'daifugo', 'babanuki', 'versus', 'mahjong', 'keiba'];
export const visibleLobbyGames = (c: CasinoConfig) => c.games.filter((g) => g !== 'atslot' || c.atOpen);
export const lobbyGameHref = (g: CasinoGame) =>
  g === 'versus' ? '/casino/versus' : g === 'mahjong' ? '/casino/jansou' : LOBBY_TABLE_GAMES.includes(g) ? `/casino/tables/${g}` : `/casino/${g}`;
export const prayerHref = (cfg: GuildConfig) => `https://discord.com/channels/${cfg.guildId}/${cfg.casinoGacha.prayerChannelId}`;
export type LobbyTable = { id: number; kind: TableKind; players: number; capacity: number; seated: boolean; canJoin: boolean; yourTurn: boolean; status: string };
/** 手札・山札・名前などをロビーに渡さず、卓の案内に要る分だけ返す */
export function lobbyTable(t: CasinoTable, memberId: string): LobbyTable | undefined {
  if (!Object.hasOwn(ENGINES, t.kind)) return undefined;
  const kind = t.kind as TableKind;
  const engine = ENGINES[kind];
  if (!engine || t.status !== 'open') return undefined;
  const s = t.state as { seats?: ({ id: string } | null)[]; n?: number; phase?: string; turn?: number | string | null };
  const seats = s.seats ?? [];
  const players = seats.filter(Boolean).length;
  const capacity = kind === 'mahjong' && s.n === 3 ? 3 : engine.maxSeats;
  const seated = t.seatIds.includes(memberId);
  const phaseAllowsJoin = !['mahjong', 'daifugo', 'babanuki'].includes(kind) || s.phase === 'lobby';
  const canJoin = !seated && players < capacity && phaseAllowsJoin;
  const turnId = typeof s.turn === 'number' ? seats[s.turn]?.id : s.turn;
  // 麻雀は鳴きの待ちもあるため、ここでは「あなたの番」と決めつけない
  const turnPhase =
    kind === 'poker'
      ? ['preflop', 'flop', 'turn', 'river'].includes(s.phase ?? '')
      : ['bj_table', 'chinchiro_table', 'daifugo', 'babanuki'].includes(kind) && ['playing', 'rolling'].includes(s.phase ?? '');
  const yourTurn = seated && turnId === memberId && turnPhase;
  const status = yourTurn
    ? 'あなたの番'
    : ['lobby', 'waiting', 'betting'].includes(s.phase ?? '')
      ? '受付中'
      : ['done', 'result', 'showdown'].includes(s.phase ?? '')
        ? '結果を確認中'
        : '対戦中';
  return { id: t.id, kind, players, capacity, seated, canJoin, yourTurn, status };
}
export type LobbyResume = { game: CasinoGame; id: number };
/** 進行中のひとり遊びだけ。中身は読まない */
export async function lobbyResumes(db: Db, memberId: string, games: CasinoGame[]): Promise<LobbyResume[]> {
  const solo = games.filter((g) => !LOBBY_TABLE_GAMES.includes(g));
  if (!solo.length) return [];
  const rows = await db
    .select({ game: casinoGames.game, id: casinoGames.id })
    .from(casinoGames)
    .where(and(eq(casinoGames.memberId, memberId), eq(casinoGames.status, 'playing'), inArray(casinoGames.game, solo)))
    .orderBy(desc(casinoGames.createdAt), desc(casinoGames.id));
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      if (seen.has(r.game)) return false;
      seen.add(r.game);
      return true;
    })
    .map((r) => ({ game: r.game as CasinoGame, id: r.id }));
}
