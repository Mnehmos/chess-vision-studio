// Play one Lichess game to completion. Streams the game, and on our turn asks a
// MovePicker for a UCI move (clock-budgeted) and posts it. On end, reconstructs a
// GameRecord (the exact shape arena/match.ts produces) so finished games flow
// straight into the OODA review -> disagree -> dataset pipeline.
import { Chess } from 'chess.js';
import type { CvsEngine } from '@cvs/engine';
import { uciToMove } from '../players';
import type { PlayedPly, GameRecord } from '../match';
import type { LichessClient, GameStreamEvent, GameState } from './client';
import { bookMove } from './book';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Chooses a move (UCI) for a position, optionally within a wall-clock budget (ms). */
export interface MoveContext {
  initialFen: string;
  moves: string[];
}

export interface MovePicker {
  readonly name: string;
  pick(fen: string, budgetMs?: number, context?: MoveContext): Promise<string | null>;
}

/** A MovePicker backed by CvsEngine (string boundary: FEN in, UCI out). */
export function cvsPicker(engine: CvsEngine, opts: { depth?: number; maxTimeMs?: number } = {}): MovePicker {
  const depth = opts.depth ?? 3;
  return {
    name: `cvs@${depth}`,
    async pick(fen, budgetMs) {
      const best = engine.bestMove(fen, { depth, maxTimeMs: budgetMs ?? opts.maxTimeMs });
      return best?.uci ?? null;
    },
  };
}

export interface SessionOptions {
  /**
   * Fraction of our remaining clock that forms the per-move base budget. Default
   * 1/30. This is the "non-smart" base the engine's --smarttime path expects
   * (ms ≈ clock/30 + 0.8·inc); the ENGINE then owns adaptivity — spending ~clock/25
   * soft and extending toward ~clock/6 hard on unstable positions. We pass the base
   * only; pre-extending here (a forcing multiplier) would double-count with smarttime.
   */
  clockFraction?: number;
  minMoveMs?: number;
  maxMoveMs?: number;
  /**
   * Wall-clock reserved per move for network round-trip + engine IPC + clock lag.
   * Subtracted from the budget so the time we actually burn stays under the clock.
   * Default 100ms.
   */
  moveOverheadMs?: number;
  /**
   * The engine's `--smarttime` path may extend the base budget we pass by up to this
   * multiple on unstable positions (serve `go <ms>` hard cap ≈ 4.8×). Used to bound the
   * base so a single hard-extended move can never flag. Default 4.8; keep in sync with
   * the engine, or raise for extra safety margin.
   */
  smarttimeHardMult?: number;
  /**
   * Hard safety ceiling: the worst-case (hard-extended) single move must not exceed this
   * fraction of the REMAINING clock. The base budget is capped at
   * remaining·safeHardFraction / smarttimeHardMult so the engine cannot over-spend into a
   * time forfeit — deep thinking when the clock is large, automatically conservative as it
   * drains. Default 0.05 (≈20 worst-case moves of headroom before any flag).
   */
  safeHardFraction?: number;
  /**
   * Opening line (UCI moves from the start) assigned to this game. While the played
   * moves still match its prefix, our moves are played INSTANTLY from it (no engine
   * search). Omit to always use the engine.
   */
  bookLine?: string[];
}

export interface SessionResult {
  gameId: string;
  cvsColor: 'white' | 'black';
  record: GameRecord;
}

export async function playSession(
  client: LichessClient,
  gameId: string,
  botId: string,
  picker: MovePicker,
  opts: SessionOptions = {},
): Promise<SessionResult> {
  const clockFraction = opts.clockFraction ?? 1 / 30;
  const minMoveMs = opts.minMoveMs ?? 50;
  const maxMoveMs = opts.maxMoveMs ?? 4000;
  const moveOverheadMs = opts.moveOverheadMs ?? 100;
  const smarttimeHardMult = opts.smarttimeHardMult ?? 4.8;
  const safeHardFraction = opts.safeHardFraction ?? 0.05;
  const bookLine = opts.bookLine;

  let initialFen = START_FEN;
  let cvsColor: 'white' | 'black' = 'white';
  let whiteName = 'white';
  let blackName = 'black';
  let lastMoves: string | null = null; // sentinel: differs from '' so the initial empty state still acts
  let finalMoves = '';
  let finalStatus = 'unknown';
  let finalWinner: 'white' | 'black' | undefined;

  for await (const ev of client.streamGame<GameStreamEvent>(gameId)) {
    let state: GameState | undefined;
    if (ev.type === 'gameFull') {
      initialFen = ev.initialFen && ev.initialFen !== 'startpos' ? ev.initialFen : START_FEN;
      const wId = (ev.white?.id ?? ev.white?.name ?? '').toLowerCase();
      cvsColor = wId === botId.toLowerCase() ? 'white' : 'black';
      whiteName = ev.white?.name ?? ev.white?.id ?? 'white';
      blackName = ev.black?.name ?? ev.black?.id ?? 'black';
      state = ev.state;
    } else if (ev.type === 'gameState') {
      state = ev;
    } else {
      continue; // chatLine, opponentGone, …
    }
    if (!state) continue;

    finalStatus = state.status ?? finalStatus;
    finalWinner = state.winner ?? finalWinner;
    finalMoves = (state.moves ?? '').trim();

    if (state.status && state.status !== 'started' && state.status !== 'created') break; // game over

    if (finalMoves === lastMoves) continue; // duplicate push
    lastMoves = finalMoves;

    const chess = new Chess(initialFen);
    const ucis = finalMoves ? finalMoves.split(/\s+/) : [];
    let replayOk = true;
    for (const u of ucis) {
      try {
        if (!chess.move(uciToMove(u))) {
          replayOk = false;
          break;
        }
      } catch {
        replayOk = false;
        break;
      }
    }
    if (!replayOk || chess.isGameOver()) continue;

    const turn = chess.turn() === 'w' ? 'white' : 'black';
    if (turn !== cvsColor) continue; // opponent to move

    // Opening book: while we're still in our assigned line, play the next book move
    // INSTANTLY — no engine search. Banks clock for the middlegame and keeps
    // --smarttime from spending ~clock/6 on a known opening move. We leave book the
    // moment the move list diverges from the line (opponent off book / line ends).
    let uci: string | null = null;
    if (bookLine) {
      const bm = bookMove(bookLine, ucis);
      if (bm) {
        try {
          if (new Chess(chess.fen()).move(uciToMove(bm))) uci = bm; // trust the book, verify legal
        } catch {
          /* malformed book move: ignore and let the engine decide */
        }
      }
    }

    if (!uci) {
      const myTimeMs = cvsColor === 'white' ? state.wtime : state.btime;
      const incMs = cvsColor === 'white' ? state.winc ?? 0 : state.binc ?? 0;
      // Per-move budget. Base = clock·clockFraction + 0.8·inc (the input --smarttime
      // expects), but CAPPED so the engine's worst-case hard extension (~smarttimeHardMult×)
      // can never exceed safeHardFraction of the REMAINING clock. Without this cap a 12s
      // base became a ~57s hard move and flagged every TC below 30+0; with it, slow games
      // still think deeply while fast games stay automatically flag-safe as the clock
      // drains. A final emergency backstop keeps even the minMove floor from over-running a
      // nearly-exhausted clock. (Pre-extending on forcing moves is still left to smarttime.)
      let budget: number | undefined;
      if (Number.isFinite(myTimeMs)) {
        const remaining = myTimeMs as number;
        const formulaBase = Math.floor(remaining * clockFraction) + Math.floor(incMs * 0.8);
        const hardSafeBase = Math.floor((remaining * safeHardFraction) / smarttimeHardMult);
        const target = Math.min(formulaBase, maxMoveMs, hardSafeBase);
        budget = Math.max(minMoveMs, target - moveOverheadMs);
        const emergency = Math.floor((remaining - moveOverheadMs) / smarttimeHardMult);
        if (emergency < budget) budget = Math.max(20, emergency);
      } else {
        budget = undefined; // correspondence / no clock — picker uses its own fallback
      }

      // Engine failure is usually transient (process hiccup, transport blip) — retry
      // before giving up. Resigning is the LAST resort: it turned every rate-limit
      // storm into an instant loss.
      for (let tryN = 0; tryN < 3 && !uci; tryN++) {
        if (tryN > 0) await sleepMs(1000 * tryN);
        uci = await picker.pick(chess.fen(), budget, { initialFen, moves: ucis });
      }
    }

    if (!uci) {
      // Engine couldn't produce a move (transport blip / cold-start race / overload).
      // Try to ABORT first — Lichess allows it in the opening, so a transient failure
      // costs nothing; only a non-abortable (mid-game) failure falls back to resigning.
      // Either way, never ghost the opponent.
      const aborted = await client.abort(gameId);
      if (!aborted) await client.resign(gameId);
      break;
    }

    let legal = false;
    try {
      legal = !!new Chess(chess.fen()).move(uciToMove(uci));
    } catch {
      legal = false;
    }
    if (!legal) {
      // Correctness crisis (engine produced an illegal move) — resign honestly.
      await client.resign(gameId);
      break;
    }

    // Move POSTs fail under 429/network blips; the clock is the real judge, so
    // keep retrying with backoff instead of resigning a playable position.
    let posted = false;
    for (let tryN = 0; tryN < 6 && !posted; tryN++) {
      if (tryN > 0) await sleepMs(Math.min(15_000, 1000 * 2 ** tryN));
      posted = await client.move(gameId, uci);
    }
    if (!posted) {
      break; // exit the session WITHOUT resigning — a reconnect can resume the game
    }
  }

  return {
    gameId,
    cvsColor,
    record: buildRecord(initialFen, finalMoves, whiteName, blackName, finalStatus, finalWinner, picker.name, cvsColor),
  };
}

/** Replay the final UCI move list into a GameRecord (SAN derived with the app's chess.js). */
function buildRecord(
  initialFen: string,
  movesStr: string,
  white: string,
  black: string,
  status: string,
  winner: 'white' | 'black' | undefined,
  cvsName: string,
  cvsColor: 'white' | 'black',
): GameRecord {
  const chess = new Chess(initialFen);
  const plies: PlayedPly[] = [];
  const ucis = movesStr ? movesStr.split(/\s+/) : [];
  for (const uci of ucis) {
    const by: 'white' | 'black' = chess.turn() === 'w' ? 'white' : 'black';
    const fenBefore = chess.fen();
    let moved;
    try {
      moved = chess.move(uciToMove(uci));
    } catch {
      moved = null;
    }
    if (!moved) break;
    plies.push({
      ply: plies.length + 1,
      by,
      player: by === cvsColor ? cvsName : 'opponent',
      fenBefore,
      san: moved.san,
      uci,
      fenAfter: chess.fen(),
    });
  }

  let result: GameRecord['result'] = '*';
  if (winner === 'white') result = '1-0';
  else if (winner === 'black') result = '0-1';
  else if (chess.isCheckmate()) result = chess.turn() === 'w' ? '0-1' : '1-0';
  else if (status === 'draw' || status === 'stalemate' || chess.isDraw()) result = '1/2-1/2';

  return { white, black, plies, result, termination: status, pgn: chess.pgn() };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
