// Play one Lichess game to completion. Streams the game, and on our turn asks a
// MovePicker for a UCI move (clock-budgeted) and posts it. On end, reconstructs a
// GameRecord (the exact shape arena/match.ts produces) so finished games flow
// straight into the OODA review -> disagree -> dataset pipeline.
import { Chess } from 'chess.js';
import type { CvsEngine } from '@cvs/engine';
import { uciToMove } from '../players';
import type { PlayedPly, GameRecord } from '../match';
import type { LichessClient, GameStreamEvent, GameState } from './client';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Chooses a move (UCI) for a position, optionally within a wall-clock budget (ms). */
export interface MovePicker {
  readonly name: string;
  pick(fen: string, budgetMs?: number): Promise<string | null>;
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
  /** Fraction of our remaining clock to spend on a move. Default 1/30. */
  clockFraction?: number;
  minMoveMs?: number;
  maxMoveMs?: number;
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

    const myTimeMs = cvsColor === 'white' ? state.wtime : state.btime;
    const budget = Number.isFinite(myTimeMs)
      ? Math.max(minMoveMs, Math.min(maxMoveMs, Math.floor((myTimeMs as number) * clockFraction)))
      : undefined;

    const uci = await picker.pick(chess.fen(), budget);
    if (!uci) {
      await client.resign(gameId);
      break;
    }

    let legal = false;
    try {
      legal = !!new Chess(chess.fen()).move(uciToMove(uci));
    } catch {
      legal = false;
    }
    if (!legal) {
      await client.resign(gameId);
      break;
    }

    const posted = await client.move(gameId, uci);
    if (!posted) {
      await client.resign(gameId);
      break;
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
