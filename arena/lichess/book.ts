// Opening book for the Lichess bot — curated, weakness-PROBING mainlines.
//
// Why: (1) DIVERSITY — without it every game is "1.e4 → King's Pawn"; rotating
// lines varies our games and the harvested training data. (2) SNAP MOVES — in-book
// moves are played INSTANTLY (no engine search), banking clock and keeping
// --smarttime off known openings. (3) QUALITY — keeps the opening principled.
// (4) DIRECTED PLAY — each line is tagged with the WEAKNESS it tends to expose
// (tactics / kingsafety / endgame / positional), so the Stockfish-d24 review can
// correlate where CVS bleeds eval with the structure that produced it.
//
// A "line" is a full UCI move sequence from the start position. The bot plays its
// own in-book moves snap-instant and follows the line only while the ACTUAL game
// still matches its prefix — the moment the opponent deviates (or the line ends) we
// hand off to the engine. Lines are mainline and end in balanced, playable
// middlegames for either colour. Every line is validated legal-from-startpos by tests.
export type ProbeCategory = 'general' | 'tactics' | 'kingsafety' | 'endgame' | 'positional';

export interface OpeningLine {
  name: string;
  moves: string[];
  /** The weakness this structure tends to probe (for review bucketing). */
  probes?: ProbeCategory;
}

export const OPENING_BOOK: OpeningLine[] = [
  // --- General mainlines (broad, sound diversity) ---
  { name: 'Italian Game', probes: 'general', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'd2d3', 'f8c5', 'c2c3', 'd7d6'] },
  { name: 'Ruy Lopez', probes: 'general', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7'] },
  { name: 'Scotch Game', probes: 'general', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4', 'e5d4', 'f3d4', 'g8f6'] },
  { name: 'Sicilian Classical', probes: 'general', moves: ['e2e4', 'c7c5', 'g1f3', 'b8c6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'd7d6'] },
  { name: 'Caro-Kann', probes: 'general', moves: ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'b1c3', 'd5e4', 'c3e4', 'c8f5'] },
  { name: 'Scandinavian', probes: 'general', moves: ['e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3', 'd5a5', 'd2d4', 'g8f6'] },
  { name: "Queen's Gambit Declined", probes: 'general', moves: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6', 'c1g5', 'f8e7'] },
  { name: 'Slav Defense', probes: 'general', moves: ['d2d4', 'd7d5', 'c2c4', 'c7c6', 'g1f3', 'g8f6', 'b1c3', 'd5c4'] },
  { name: 'Nimzo-Indian', probes: 'general', moves: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4', 'e2e3', 'e8g8'] },
  { name: 'English Opening', probes: 'general', moves: ['c2c4', 'e7e5', 'b1c3', 'g8f6', 'g1f3', 'b8c6', 'g2g3', 'd7d5'] },
  { name: 'Reti Opening', probes: 'general', moves: ['g1f3', 'd7d5', 'c2c4', 'e7e6', 'g2g3', 'g8f6', 'f1g2', 'f8e7'] },
  { name: 'London System', probes: 'general', moves: ['d2d4', 'd7d5', 'c1f4', 'g8f6', 'e2e3', 'e7e6', 'g1f3', 'f8d6'] },
  { name: 'Catalan', probes: 'general', moves: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'g1f3', 'd7d5', 'g2g3', 'f8e7'] },

  // --- Sharp tactics / calculation past the horizon ---
  { name: 'King\'s Gambit', probes: 'tactics', moves: ['e2e4', 'e7e5', 'f2f4', 'e5f4', 'g1f3', 'g7g5', 'f1c4', 'f8g7'] },
  { name: 'Evans Gambit', probes: 'tactics', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'b2b4', 'c5b4', 'c2c3', 'b4a5', 'd2d4', 'e5d4'] },
  { name: 'Botvinnik Semi-Slav', probes: 'tactics', moves: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'c7c6', 'g1f3', 'g8f6', 'c1g5', 'd5c4', 'e2e4', 'b7b5'] },
  { name: 'Marshall Attack', probes: 'tactics', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1', 'b7b5', 'a4b3', 'e8g8', 'c2c3', 'd7d5'] },

  // --- King safety: opposite-side castling, attack & defense ---
  { name: 'Najdorf English Attack', probes: 'kingsafety', moves: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6', 'c1e3', 'e7e5', 'd4b3', 'c8e6', 'f2f3', 'f8e7'] },
  { name: 'Sicilian Dragon Yugoslav', probes: 'kingsafety', moves: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'g7g6', 'c1e3', 'f8g7', 'f2f3', 'e8g8', 'd1d2', 'b8c6'] },
  { name: 'French Winawer', probes: 'kingsafety', moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3', 'f8b4', 'e4e5', 'c7c5', 'a2a3', 'b4c3', 'b2c3', 'g8e7'] },
  { name: 'Pirc Austrian Attack', probes: 'kingsafety', moves: ['e2e4', 'd7d6', 'd2d4', 'g8f6', 'b1c3', 'g7g6', 'f2f4', 'f8g7', 'g1f3', 'e8g8', 'f1d3', 'b8c6'] },

  // --- Endgame technique: simplifying / theoretical structures ---
  { name: 'Berlin Defense (endgame)', probes: 'endgame', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'g8f6', 'e1g1', 'f6e4', 'd2d4', 'e4d6', 'b5c6', 'd7c6', 'd4e5', 'd6f5', 'd1d8', 'e8d8'] },
  { name: 'QGD Exchange (Carlsbad)', probes: 'endgame', moves: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6', 'c4d5', 'e6d5', 'c1g5', 'c7c6', 'e2e3', 'f8e7'] },
  { name: 'Ruy Lopez Exchange', probes: 'endgame', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5c6', 'd7c6', 'e1g1', 'f7f6'] },
  { name: 'Petroff Defense', probes: 'endgame', moves: ['e2e4', 'e7e5', 'g1f3', 'g8f6', 'f3e5', 'd7d6', 'e5f3', 'f6e4', 'd2d4', 'd6d5', 'f1d3', 'b8c6'] },
  { name: 'Slav Exchange', probes: 'endgame', moves: ['d2d4', 'd7d5', 'c2c4', 'c7c6', 'c4d5', 'c6d5', 'b1c3', 'g8f6', 'g1f3', 'b8c6', 'c1f4', 'a7a6'] },

  // --- Positional: closed / strategic maneuvering, no tactic to latch onto ---
  { name: "King's Indian (Mar del Plata)", probes: 'positional', moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7', 'e2e4', 'd7d6', 'g1f3', 'e8g8', 'f1e2', 'e7e5', 'e1g1', 'b8c6', 'd4d5', 'c6e7'] },
  { name: 'Benoni Defense', probes: 'positional', moves: ['d2d4', 'g8f6', 'c2c4', 'c7c5', 'd4d5', 'e7e6', 'b1c3', 'e6d5', 'c4d5', 'd7d6', 'e2e4', 'g7g6', 'g1f3', 'f8g7'] },
  { name: 'Grünfeld Defense', probes: 'positional', moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'd7d5', 'c4d5', 'f6d5', 'e2e4', 'd5c3', 'b2c3', 'f8g7'] },
  { name: 'Dutch Leningrad', probes: 'positional', moves: ['d2d4', 'f7f5', 'g2g3', 'g8f6', 'f1g2', 'g7g6', 'g1f3', 'f8g7', 'e1g1', 'e8g8', 'c2c4', 'd7d6'] },
  { name: 'Closed Sicilian', probes: 'positional', moves: ['e2e4', 'c7c5', 'b1c3', 'b8c6', 'g2g3', 'g7g6', 'f1g2', 'f8g7', 'd2d3', 'd7d6', 'f2f4', 'e7e6'] },
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
