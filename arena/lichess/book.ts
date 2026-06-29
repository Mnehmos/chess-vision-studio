// Opening book for the Lichess bot — a curated set of sound, diverse mainlines.
//
// Why: (1) DIVERSITY — without it every game is "1.e4 → King's Pawn"; rotating
// lines varies our games and the harvested training data. (2) SNAP MOVES — in-book
// moves are played INSTANTLY (no engine search), which banks clock for the
// middlegame (big in bullet) and stops --smarttime from burning ~clock/6 thinking
// about a known opening move. (3) QUALITY — keeps our opening principled instead of
// drifting into early inaccuracies.
//
// A "line" is a full UCI move sequence from the start position. The bot plays its
// own in-book moves snap-instant and follows the line only while the ACTUAL game
// still matches its prefix — the moment the opponent deviates (or the line ends) we
// hand off to the engine. Lines are mainline and end in balanced, playable
// middlegames for either colour. Every line is validated legal-from-startpos by tests.
export interface OpeningLine {
  name: string;
  moves: string[];
}

export const OPENING_BOOK: OpeningLine[] = [
  { name: 'Italian Game', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'd2d3', 'f8c5', 'c2c3', 'd7d6'] },
  { name: 'Ruy Lopez', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7'] },
  { name: 'Scotch Game', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4', 'e5d4', 'f3d4', 'g8f6'] },
  { name: 'Sicilian Najdorf', moves: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6'] },
  { name: 'Sicilian Classical', moves: ['e2e4', 'c7c5', 'g1f3', 'b8c6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'd7d6'] },
  { name: 'French Defense', moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3', 'g8f6', 'c1g5', 'f8e7'] },
  { name: 'Caro-Kann', moves: ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'b1c3', 'd5e4', 'c3e4', 'c8f5'] },
  { name: 'Scandinavian', moves: ['e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3', 'd5a5', 'd2d4', 'g8f6'] },
  { name: "Queen's Gambit Declined", moves: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6', 'c1g5', 'f8e7'] },
  { name: 'Slav Defense', moves: ['d2d4', 'd7d5', 'c2c4', 'c7c6', 'g1f3', 'g8f6', 'b1c3', 'd5c4'] },
  { name: "King's Indian", moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7', 'e2e4', 'd7d6'] },
  { name: 'Nimzo-Indian', moves: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4', 'e2e3', 'e8g8'] },
  { name: 'English Opening', moves: ['c2c4', 'e7e5', 'b1c3', 'g8f6', 'g1f3', 'b8c6', 'g2g3', 'd7d5'] },
  { name: 'Reti Opening', moves: ['g1f3', 'd7d5', 'c2c4', 'e7e6', 'g2g3', 'g8f6', 'f1g2', 'f8e7'] },
  { name: 'London System', moves: ['d2d4', 'd7d5', 'c1f4', 'g8f6', 'e2e3', 'e7e6', 'g1f3', 'f8d6'] },
  { name: 'Catalan', moves: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'g1f3', 'd7d5', 'g2g3', 'f8e7'] },
];

let rotation = 0;

/** Next opening line, round-robin — rotated once per game so we cycle the book. */
export function nextBookLine(book: OpeningLine[] = OPENING_BOOK): OpeningLine {
  const line = book[rotation % book.length]!;
  rotation += 1;
  return line;
}

/**
 * The book move to play from a position reached by `movesPlayed` (UCI), following
 * `lineMoves`, or null if we have left the line — the opponent deviated from the
 * line's prefix, or the line is exhausted. Stateless: depends only on the moves so
 * far, so it works for either colour and survives reconnects mid-opening.
 */
export function bookMove(lineMoves: string[], movesPlayed: string[]): string | null {
  if (movesPlayed.length >= lineMoves.length) return null; // line exhausted
  for (let i = 0; i < movesPlayed.length; i++) {
    if (movesPlayed[i] !== lineMoves[i]) return null; // off book
  }
  return lineMoves[movesPlayed.length] ?? null;
}
