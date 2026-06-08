// Match harness — play one game between two Players (Stockfish vs CVS, or any
// pairing). Records every ply (fenBefore/san/uci/fenAfter) and the result. The
// board is the app's chess.js; players only ever hand back UCI strings.
import { Chess } from 'chess.js';
import { uciToMove, type Player } from './players';

export interface PlayedPly {
  ply: number; // 1-based
  by: 'white' | 'black';
  player: string; // player name (e.g. "cvs@3")
  fenBefore: string;
  san: string;
  uci: string;
  fenAfter: string;
}

export interface GameRecord {
  white: string;
  black: string;
  plies: PlayedPly[];
  result: '1-0' | '0-1' | '1/2-1/2' | '*';
  termination: string;
  pgn: string;
}

export interface MatchOptions {
  maxPlies?: number;
  startFen?: string;
}

/** Play `white` vs `black` until game over, no move, or the ply cap. */
export async function playGame(white: Player, black: Player, opts: MatchOptions = {}): Promise<GameRecord> {
  const maxPlies = opts.maxPlies ?? 80;
  const chess = opts.startFen ? new Chess(opts.startFen) : new Chess();
  const plies: PlayedPly[] = [];
  let termination = `ply cap (${maxPlies})`;

  while (!chess.isGameOver() && plies.length < maxPlies) {
    const turn = chess.turn(); // 'w' | 'b'
    const by = turn === 'w' ? 'white' : 'black';
    const player = turn === 'w' ? white : black;
    const fenBefore = chess.fen();

    const picked = await player.pick(fenBefore);
    if (!picked) {
      termination = `${player.name} returned no move`;
      break;
    }
    let moved;
    try {
      moved = chess.move(uciToMove(picked.uci)); // beta.8 throws on an illegal move
    } catch {
      moved = null;
    }
    if (!moved) {
      termination = `illegal move ${picked.uci} by ${player.name}`;
      break;
    }
    plies.push({
      ply: plies.length + 1,
      by,
      player: player.name,
      fenBefore,
      san: moved.san,
      uci: picked.uci,
      fenAfter: chess.fen(),
    });
  }

  let result: GameRecord['result'] = '*';
  if (chess.isCheckmate()) {
    result = chess.turn() === 'w' ? '0-1' : '1-0'; // side to move is the one mated
    termination = 'checkmate';
  } else if (chess.isStalemate()) {
    result = '1/2-1/2';
    termination = 'stalemate';
  } else if (chess.isInsufficientMaterial()) {
    result = '1/2-1/2';
    termination = 'insufficient material';
  } else if (chess.isThreefoldRepetition()) {
    result = '1/2-1/2';
    termination = 'threefold repetition';
  } else if (chess.isDraw()) {
    result = '1/2-1/2';
    termination = 'draw (50-move rule)';
  }

  return { white: white.name, black: black.name, plies, result, termination, pgn: chess.pgn() };
}
