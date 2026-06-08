// Thin, mockable client for the Lichess Bot API. The transport is an injectable
// `fetchLike` (defaults to global fetch) so the whole bot is unit-testable with
// canned ndjson and zero network. The token is sent only as a Bearer header.
//
// Endpoints (all under https://lichess.org):
//   GET  /api/stream/event                      ndjson: challenge / gameStart / gameFinish …
//   GET  /api/bot/game/stream/{id}              ndjson: gameFull then gameState …
//   POST /api/bot/game/{id}/move/{uci}          play a move (UCI)
//   POST /api/challenge/{id}/accept | /decline  respond to a challenge
//   POST /api/challenge/ai                      seed a game vs Lichess Stockfish (level 1–8)
//   POST /api/bot/game/{id}/{abort|resign}      end a game
//   GET  /api/account                           who am I (id/username/title)
//   POST /api/bot/account/upgrade               IRREVERSIBLE — never called automatically
import { parseNdjson } from './ndjson';

interface FetchResponse {
  ok: boolean;
  status: number;
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
export type FetchLike = (url: string, init?: RequestInit) => Promise<FetchResponse>;

export interface LichessClientOptions {
  token: string;
  baseUrl?: string;
  fetchLike?: FetchLike;
}

export interface ChallengeAiOptions {
  level: number; // 1–8
  color?: 'white' | 'black' | 'random';
  clockLimitSec?: number; // real-time game if set …
  clockIncrementSec?: number;
  days?: number; // … else correspondence (days per turn)
}

export interface LichessAccount {
  id: string;
  username: string;
  title?: string;
}

export class LichessClient {
  private readonly token: string;
  readonly baseUrl: string;
  private readonly f: FetchLike;

  constructor(opts: LichessClientOptions) {
    this.token = opts.token;
    this.baseUrl = opts.baseUrl ?? 'https://lichess.org';
    this.f = opts.fetchLike ?? (globalThis.fetch as unknown as FetchLike);
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, ...extra };
  }

  /** Incoming events: challenges, game starts/finishes. ndjson, long-lived. */
  async *streamEvents<T = LichessEvent>(): AsyncGenerator<T> {
    yield* this.streamPath<T>('/api/stream/event');
  }

  /** One game's state stream: a `gameFull` then `gameState` updates. ndjson. */
  async *streamGame<T = GameStreamEvent>(gameId: string): AsyncGenerator<T> {
    yield* this.streamPath<T>(`/api/bot/game/stream/${gameId}`);
  }

  private async *streamPath<T>(path: string): AsyncGenerator<T> {
    const res = await this.f(this.baseUrl + path, { headers: this.authHeaders() });
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
    yield* parseNdjson<T>(res.body);
  }

  /** Play a UCI move (e2e4 / e7e8q). */
  move(gameId: string, uci: string, offeringDraw = false): Promise<boolean> {
    return this.postOk(`/api/bot/game/${gameId}/move/${uci}${offeringDraw ? '?offeringDraw=true' : ''}`);
  }

  acceptChallenge(challengeId: string): Promise<boolean> {
    return this.postOk(`/api/challenge/${challengeId}/accept`);
  }

  declineChallenge(challengeId: string, reason?: string): Promise<boolean> {
    return this.postOk(`/api/challenge/${challengeId}/decline`, reason ? new URLSearchParams({ reason }) : undefined);
  }

  chat(gameId: string, text: string, room: 'player' | 'spectator' = 'player'): Promise<boolean> {
    return this.postOk(`/api/bot/game/${gameId}/chat`, new URLSearchParams({ room, text }));
  }

  abort(gameId: string): Promise<boolean> {
    return this.postOk(`/api/bot/game/${gameId}/abort`);
  }

  resign(gameId: string): Promise<boolean> {
    return this.postOk(`/api/bot/game/${gameId}/resign`);
  }

  async account(): Promise<LichessAccount> {
    const res = await this.f(this.baseUrl + '/api/account', { headers: this.authHeaders() });
    if (!res.ok) throw new Error(`GET /api/account -> ${res.status}`);
    return (await res.json()) as LichessAccount;
  }

  /** Seed a game by challenging Lichess's Stockfish. Returns the created game JSON. */
  async challengeAi(opts: ChallengeAiOptions): Promise<{ id?: string } & Record<string, unknown>> {
    const body: Record<string, string> = { level: String(opts.level) };
    if (opts.clockLimitSec != null) {
      body['clock.limit'] = String(opts.clockLimitSec);
      body['clock.increment'] = String(opts.clockIncrementSec ?? 0);
    } else {
      body['days'] = String(opts.days ?? 1);
    }
    if (opts.color) body['color'] = opts.color;
    const res = await this.f(this.baseUrl + '/api/challenge/ai', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams(body).toString(),
    });
    if (!res.ok) throw new Error(`POST /api/challenge/ai -> ${res.status}`);
    return (await res.json()) as { id?: string } & Record<string, unknown>;
  }

  /**
   * IRREVERSIBLE: upgrade the (gameless) account to a BOT account. Exposed for a
   * deliberate, user-initiated one-off ONLY — the runner never calls this. Flip
   * the account manually via the documented curl before going live.
   */
  upgradeToBot(): Promise<boolean> {
    return this.postOk('/api/bot/account/upgrade');
  }

  private async postOk(path: string, body?: URLSearchParams): Promise<boolean> {
    const headers = body
      ? this.authHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' })
      : this.authHeaders();
    const res = await this.f(this.baseUrl + path, {
      method: 'POST',
      headers,
      body: body ? body.toString() : undefined,
    });
    return res.ok;
  }
}

// ---- Event shapes (the subset we read) ----

export interface LichessEvent {
  type: 'challenge' | 'gameStart' | 'gameFinish' | 'challengeCanceled' | 'challengeDeclined' | string;
  challenge?: ChallengeEvent;
  game?: { id?: string; gameId?: string; fullId?: string };
}

export interface ChallengeEvent {
  id: string;
  rated?: boolean;
  variant?: { key: string; name?: string };
  speed?: string; // ultraBullet | bullet | blitz | rapid | classical | correspondence
  timeControl?: { type: string; limit?: number; increment?: number; daysPerTurn?: number };
  challenger?: { id?: string; name?: string; title?: string | null };
  destUser?: { id?: string };
  color?: string;
}

export interface GameStreamEvent {
  type: 'gameFull' | 'gameState' | 'chatLine' | 'opponentGone' | string;
  // gameFull:
  id?: string;
  initialFen?: string; // 'startpos' or a FEN
  white?: { id?: string; name?: string };
  black?: { id?: string; name?: string };
  state?: GameState;
  // gameState (also nested in gameFull.state):
  moves?: string; // space-separated UCI
  wtime?: number;
  btime?: number;
  winc?: number;
  binc?: number;
  status?: string; // started | mate | resign | outoftime | draw | stalemate | aborted …
  winner?: 'white' | 'black';
}

export type GameState = GameStreamEvent;
