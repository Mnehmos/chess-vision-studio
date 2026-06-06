// [1] Position layer — chess.js wrapper → PositionState.
// Pure: legality, FEN/PGN, history, legal move generation.
import { Chess } from 'chess.js';
import type { PositionState } from './types';

export function positionFromFen(fen: string): PositionState {
  const chess = new Chess(fen);
  return {
    fen: chess.fen(),
    sideToMove: chess.turn(),
    moveNumber: chess.moveNumber(),
    legalMoves: chess.moves(),
  };
}

/** Parse a PGN into the sequence of half-moves (SAN) and the FEN before each. */
export interface PlyRecord {
  ply: number; // 1-based half-move index
  moveNumber: number; // full-move number
  san: string;
  color: 'w' | 'b';
  from: string; // origin square of the move
  to: string; // destination square (the piece that just moved lands here)
  fenBefore: string;
  fenAfter: string;
}

export function pliesFromPgn(pgn: string): PlyRecord[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return pliesFromHistory(chess.history({ verbose: true }));
}

function pliesFromHistory(
  history: { san: string; color: 'w' | 'b'; from: string; to: string }[],
): PlyRecord[] {
  const replay = new Chess();
  const records: PlyRecord[] = [];
  history.forEach((move, i) => {
    const fenBefore = replay.fen();
    replay.move(move.san);
    records.push({
      ply: i + 1,
      moveNumber: Math.floor(i / 2) + 1,
      san: move.san,
      color: move.color,
      from: move.from,
      to: move.to,
      fenBefore,
      fenAfter: replay.fen(),
    });
  });
  return records;
}

// ── Multi-game PGN (full exports — hundreds of games) ────────────────────────
export interface ParsedGame {
  index: number;
  headers: Record<string, string>;
  plies: PlyRecord[];
  label: string; // 'White vs Black · 1-0 · 2026.06.06'
}

/** Split a multi-game PGN into individual game chunks (a new game begins at an
 *  [Event …] tag that follows movetext). */
export function splitPgnGames(pgn: string): string[] {
  const games: string[] = [];
  let current: string[] = [];
  let sawMoves = false;
  for (const line of pgn.split(/\r?\n/)) {
    if (/^\[Event\b/.test(line) && sawMoves) {
      games.push(current.join('\n'));
      current = [line];
      sawMoves = false;
    } else {
      current.push(line);
      if (line.trim() && !line.startsWith('[')) sawMoves = true;
    }
  }
  if (current.length) games.push(current.join('\n'));
  return games.filter((g) => g.trim());
}

function headersFromPgn(chunk: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const m of chunk.matchAll(/^\[(\w+)\s+"([^"]*)"\]/gm)) headers[m[1]] = m[2];
  return headers;
}

function gameLabel(headers: Record<string, string>, index: number): string {
  const w = headers.White ?? '?';
  const b = headers.Black ?? '?';
  const res = headers.Result ?? '*';
  const date = headers.Date && headers.Date !== '????.??.??' ? ` · ${headers.Date}` : '';
  return `#${index + 1}  ${w} vs ${b} · ${res}${date}`;
}

/** Parse every game in a (possibly multi-game) PGN export. Malformed games skipped. */
export function gamesFromPgn(pgn: string): ParsedGame[] {
  const chunks = splitPgnGames(pgn);
  const out: ParsedGame[] = [];
  chunks.forEach((chunk) => {
    try {
      const chess = new Chess();
      chess.loadPgn(chunk);
      const plies = pliesFromHistory(chess.history({ verbose: true }));
      if (plies.length === 0) return;
      const headers = headersFromPgn(chunk);
      out.push({ index: out.length, headers, plies, label: gameLabel(headers, out.length) });
    } catch {
      // skip malformed game, keep parsing the rest
    }
  });
  return out;
}
