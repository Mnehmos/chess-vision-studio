// Deterministic opening detection. This is BOOK knowledge — a curated table of
// named openings keyed by their SAN move prefix — not engine-derived analysis, so
// it lives outside the hazard compiler and is labeled as opening guidance. The
// teaching discipline holds: we never invent a tactic; an opening name is a fact
// matched against a known move sequence, and its plan is established book theory.

export interface OpeningInfo {
  /** Canonical name, e.g. "London System". */
  name: string;
  /** Rough ECO code (informational; not used for matching). */
  eco: string;
  /** The defining SAN move sequence. A game matches when this is a prefix of it. */
  moves: string[];
  /** One-sentence description of the setup/idea. */
  summary: string;
  /** A few concrete plans, in plain language. */
  ideas: string[];
}

export interface DetectedOpening {
  info: OpeningInfo;
  /** How many half-moves of the game matched (== info.moves.length). */
  matchedPlies: number;
  /** True when the game has played exactly the book line so far (still "in book"). */
  inBook: boolean;
}

// Curated, deliberately small. Ordered loosely by popularity; matching picks the
// LONGEST prefix that fits, so a generic "Queen's Pawn" yields to "London System"
// once Bf4 appears. Multiple entries cover the common move orders of a system.
const OPENINGS: OpeningInfo[] = [
  // ── Generic first moves (fallbacks so any game gets a name) ──────────────
  {
    name: 'King’s Pawn Opening',
    eco: 'B00',
    moves: ['e4'],
    summary: 'Classical 1.e4 — fight for the centre and open lines for the bishop and queen.',
    ideas: ['Develop knights and bishops quickly', 'Castle early', 'Contest the centre with d4 or piece pressure'],
  },
  {
    name: 'Queen’s Pawn Opening',
    eco: 'A40',
    moves: ['d4'],
    summary: 'Solid 1.d4 — stake a central pawn and develop behind it.',
    ideas: ['Develop the dark-squared bishop before locking it in with e3', 'Fight for e4/c4 breaks', 'Castle and connect rooks'],
  },
  {
    name: 'English Opening',
    eco: 'A10',
    moves: ['c4'],
    summary: 'Flank opening — pressure d5 from the side and often fianchetto the king’s bishop.',
    ideas: ['Fianchetto with g3/Bg2', 'Control d5 with c4 + knights', 'Delay committing central pawns'],
  },
  {
    name: 'Réti Opening',
    eco: 'A09',
    moves: ['Nf3', 'd5', 'c4'],
    summary: 'Hypermodern — attack d5 from the flank and develop before claiming the centre.',
    ideas: ['Fianchetto and pressure the long diagonal', 'Undermine d5 with c4', 'Strike the centre later with d4 or e4'],
  },
  {
    name: 'Bird’s Opening',
    eco: 'A02',
    moves: ['f4'],
    summary: '1.f4 — grip e5 and aim for a kingside setup (often a Stonewall).',
    ideas: ['Develop Nf3 and a kingside fianchetto or Bd3', 'Control e5', 'Mind the weakened e1–h4 diagonal'],
  },

  // ── 1.d4 systems ─────────────────────────────────────────────────────────
  {
    name: 'London System',
    eco: 'D02',
    moves: ['d4', 'd5', 'Bf4'],
    summary: 'A solid system: d4 with an early Bf4, heading for the c3–e3–Bd3–Nbd2 setup.',
    ideas: [
      'Develop Bf4 BEFORE e3 so the bishop isn’t blocked in',
      'Build the c3–e3 pawn triangle with Bd3 and Nbd2',
      'Eye the b1–h7 diagonal; Ne5 and a kingside push are the attacking plan',
      'Break with e4 once developed',
    ],
  },
  {
    name: 'London System',
    eco: 'D02',
    moves: ['d4', 'Nf6', 'Bf4'],
    summary: 'A solid system: d4 with an early Bf4, heading for the c3–e3–Bd3–Nbd2 setup.',
    ideas: [
      'Develop Bf4 BEFORE e3 so the bishop isn’t blocked in',
      'Build the c3–e3 pawn triangle with Bd3 and Nbd2',
      'Eye the b1–h7 diagonal; Ne5 and a kingside push are the attacking plan',
      'Break with e4 once developed',
    ],
  },
  {
    name: 'London System',
    eco: 'D02',
    moves: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4'],
    summary: 'A solid system: d4 with an early Bf4, heading for the c3–e3–Bd3–Nbd2 setup.',
    ideas: [
      'Complete the c3–e3 triangle with Bd3 and Nbd2',
      'Trade off Black’s good bishop or plant a knight on e5',
      'Attack on the kingside with the bishop pair pointing at h7',
    ],
  },
  {
    name: 'Queen’s Gambit',
    eco: 'D06',
    moves: ['d4', 'd5', 'c4'],
    summary: 'Offer the c4 pawn to deflect Black’s d5 and build a strong centre.',
    ideas: ['If Black takes on c4, regain it and seize the centre', 'Develop Nc3/Nf3 and pressure d5', 'Aim for the e4 break'],
  },
  {
    name: 'Queen’s Gambit Declined',
    eco: 'D30',
    moves: ['d4', 'd5', 'c4', 'e6'],
    summary: 'Black holds the centre with e6 — a solid but slightly passive structure.',
    ideas: ['White: pressure d5, develop Bg5 and e3', 'Black: free the light bishop, break with c5 or dxc4 + c5'],
  },
  {
    name: 'Slav Defense',
    eco: 'D10',
    moves: ['d4', 'd5', 'c4', 'c6'],
    summary: 'Support d5 with c6, keeping the light-squared bishop’s diagonal open.',
    ideas: ['Black develops Bf5 or Bg4 before e6', 'White fights for e4', 'Watch the c4/dxc4 tension'],
  },
  {
    name: 'King’s Indian Defense',
    eco: 'E60',
    moves: ['d4', 'Nf6', 'c4', 'g6'],
    summary: 'Black cedes the centre, fianchettoes, and counterattacks it later with e5 or c5.',
    ideas: ['Black: castle, then strike with e5 (kingside play) or c5', 'White: claim space and play on the queenside'],
  },
  {
    name: 'Nimzo-Indian Defense',
    eco: 'E20',
    moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'],
    summary: 'Pin the c3 knight to fight for e4 and inflict doubled pawns.',
    ideas: ['Black: trade on c3 to damage structure, blockade the centre', 'White: use the bishop pair and central pawns'],
  },
  {
    name: 'Grünfeld Defense',
    eco: 'D80',
    moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5'],
    summary: 'Let White build a big centre, then hit it with pieces and c5/e5 breaks.',
    ideas: ['Black: pressure d4 with Bg7, c5 and Nc6', 'White: build and defend the broad pawn centre'],
  },
  {
    name: 'Catalan Opening',
    eco: 'E00',
    moves: ['d4', 'Nf6', 'c4', 'e6', 'g3'],
    summary: 'A Queen’s-Gambit setup with g3 — the Catalan bishop bears down the long diagonal.',
    ideas: ['White: pressure d5/c6 along g2–a8, recover the c4 pawn patiently', 'Black: hold c4 or free with dxc4 + b5/c5'],
  },
  {
    name: 'Dutch Defense',
    eco: 'A80',
    moves: ['d4', 'f5'],
    summary: 'Grab kingside space and central control of e4 at the cost of king safety.',
    ideas: ['Black: choose a Stonewall, Leningrad, or Classical setup', 'White: probe the e6/king weaknesses, consider Qc2 + e4'],
  },

  // ── 1.e4 e5 (Open Games) ────────────────────────────────────────────────
  {
    name: 'Italian Game',
    eco: 'C50',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
    summary: 'Develop the bishop to c4, targeting f7, and prepare c3–d4 or a slow build-up.',
    ideas: ['Castle, play c3 and d4 for a centre', 'Watch f7 and the d5 square', 'In the Giuoco Piano, manoeuvre Nbd2–f1–g3'],
  },
  {
    name: 'Ruy Lopez',
    eco: 'C60',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
    summary: 'Pressure the e5 knight’s defender; a deep, strategic mainline.',
    ideas: ['White: c3 + d4 build-up, manoeuvre Nb1–d2–f1–g3', 'Black: solidify with a6/b5 and ...d6, fight for d4'],
  },
  {
    name: 'Scotch Game',
    eco: 'C45',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'],
    summary: 'Open the centre immediately with d4 for fast, free development.',
    ideas: ['Recapture on d4 and develop actively', 'Trade in the centre, target weak squares', 'Castle and use open lines'],
  },
  {
    name: 'Vienna Game',
    eco: 'C25',
    moves: ['e4', 'e5', 'Nc3'],
    summary: 'Develop the knight first, often preparing f4 for a kingside storm.',
    ideas: ['Consider f4 (a delayed King’s Gambit)', 'Fianchetto with g3/Bg2 in quieter lines', 'Castle before opening the centre'],
  },

  // ── 1.e4 (Semi-Open Games) ──────────────────────────────────────────────
  {
    name: 'Sicilian Defense',
    eco: 'B20',
    moves: ['e4', 'c5'],
    summary: 'Black’s most combative reply — fight for the centre asymmetrically with c5.',
    ideas: ['Black: counterattack on the queenside, trade the c-pawn for a d-pawn', 'White: Open Sicilian with Nf3 + d4, or a quieter Anti-Sicilian'],
  },
  {
    name: 'Sicilian Najdorf',
    eco: 'B90',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
    summary: 'The flexible ...a6 mainline — control b5 and prepare ...e5/...e6 with active play.',
    ideas: ['Black: ...e5 or ...e6 setups, queenside expansion with b5', 'White: English Attack with Be3/f3/g4 or 6.Bg5'],
  },
  {
    name: 'French Defense',
    eco: 'C00',
    moves: ['e4', 'e6'],
    summary: 'Solid but with a problem bishop on c8; counter the centre with ...d5 and ...c5.',
    ideas: ['Black: break with c5 (and f6), solve the light bishop', 'White: gain space with e5, attack the kingside'],
  },
  {
    name: 'Caro-Kann Defense',
    eco: 'B10',
    moves: ['e4', 'c6'],
    summary: 'Challenge e4 with ...d5 while keeping a sound structure and a free light bishop.',
    ideas: ['Black: develop Bf5/Bg4 before e6', 'White: Advance, Exchange, or main lines with d4 + Nc3'],
  },
  {
    name: 'Scandinavian Defense',
    eco: 'B01',
    moves: ['e4', 'd5'],
    summary: 'Immediately challenge e4; after exd5 Black regains the pawn with the queen or a gambit.',
    ideas: ['Black: ...Qxd5 then tuck the queen to a5/d6/d8, develop smoothly', 'White: gain tempo on the queen, seize the centre'],
  },
  {
    name: 'Pirc Defense',
    eco: 'B07',
    moves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6'],
    summary: 'Hypermodern — fianchetto and invite a big centre to attack it with ...e5/...c5.',
    ideas: ['Black: castle, pressure the centre with c5/e5', 'White: Austrian Attack with f4, or a classical Be2 setup'],
  },
];

// How many half-moves past the known book line we still call a game "in book". Book
// lines here are short (a few moves), but a real game follows the system longer —
// so a small grace keeps the name relevant early without claiming opening theory
// deep into a tactical middlegame.
export const OPENING_GRACE_PLIES = 3;

// Normalize a SAN token for comparison: drop check/mate marks and annotations.
function normalizeSan(san: string): string {
  return san.replace(/[+#!?]/g, '');
}

function isPrefix(book: string[], played: string[]): boolean {
  if (book.length > played.length) return false;
  for (let i = 0; i < book.length; i += 1) {
    if (normalizeSan(book[i]) !== normalizeSan(played[i] ?? '')) return false;
  }
  return true;
}

// Detect the most specific named opening for a game's SAN move list. Returns the
// LONGEST book line that is a prefix of the played moves, so generic names defer
// to specific systems. Returns null only for an empty game.
export function detectOpening(sanMoves: string[]): DetectedOpening | null {
  if (sanMoves.length === 0) return null;
  let best: OpeningInfo | null = null;
  for (const info of OPENINGS) {
    if (!isPrefix(info.moves, sanMoves)) continue;
    if (!best || info.moves.length > best.moves.length) best = info;
  }
  if (!best) return null;
  return {
    info: best,
    matchedPlies: best.moves.length,
    // In book only while we're at most a few plies past the known line — past that
    // the game has left book even though the prefix still technically matches.
    inBook: sanMoves.length <= best.moves.length + OPENING_GRACE_PLIES,
  };
}

// The named opening only while still in book (else null) — for the opening card,
// which should fade once the game leaves theory rather than claim the name forever.
export function bookOpening(sanMoves: string[]): DetectedOpening | null {
  const found = detectOpening(sanMoves);
  return found?.inBook ? found : null;
}
