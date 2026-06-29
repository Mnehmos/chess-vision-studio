// Stress positions for the weakness profiler — "en medias res" starts that drop
// self-play straight into a weakness-prone structure. Two sources:
//   1. The weakness-tagged opening book, replayed to its end (an early middlegame).
//   2. A small set of hand-verified textbook endgames/technique positions for the
//      categories the opening book doesn't reach (CONVERSION / SURVIVAL / pure ENDGAME).
// Every FEN is validated legal at load; an invalid one is dropped (never breaks a run).
import { Chess } from 'chess.js';
import { OPENING_BOOK, type ProbeCategory } from '../lichess/book';

export type WeaknessTag =
  | 'TACTICS'
  | 'KING_DEFENSE'
  | 'QUIET_DEFENSE'
  | 'POSITIONAL'
  | 'ENDGAME'
  | 'CONVERSION'
  | 'SURVIVAL';

export interface StressPosition {
  name: string;
  fen: string;
  tag: WeaknessTag;
  source: 'book' | 'curated' | 'random';
}

const PROBE_TO_TAG: Record<ProbeCategory, WeaknessTag> = {
  general: 'POSITIONAL',
  tactics: 'TACTICS',
  kingsafety: 'KING_DEFENSE',
  endgame: 'ENDGAME',
  positional: 'POSITIONAL',
};

function isLegalFen(fen: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
}

/** Replay an opening-book line to its end position (early middlegame), tagged by probe. */
function bookStressPositions(): StressPosition[] {
  const out: StressPosition[] = [];
  for (const line of OPENING_BOOK) {
    const chess = new Chess();
    let ok = true;
    for (const uci of line.moves) {
      try {
        const m = chess.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
        });
        if (!m) {
          ok = false;
          break;
        }
      } catch {
        ok = false;
        break;
      }
    }
    if (ok) out.push({ name: line.name, fen: chess.fen(), tag: PROBE_TO_TAG[line.probes ?? 'general'], source: 'book' });
  }
  return out;
}

// Textbook positions for categories the opening lines don't reach. Standard, legal.
const CURATED_RAW: Array<Omit<StressPosition, 'source'>> = [
  // Rook endgames — conversion vs holding
  { name: 'Lucena bridge (R+P win)', fen: '1K6/1P1k4/8/8/8/8/r7/2R5 w - - 0 1', tag: 'CONVERSION' },
  { name: 'Philidor (R draw)', fen: '8/8/8/8/4k3/8/R3p3/4K2r w - - 0 1', tag: 'SURVIVAL' },
  { name: 'R+P vs R, Black side', fen: '8/8/8/4k3/8/8/4Pp2/4K2R b K - 0 1', tag: 'SURVIVAL' },
  // King-and-pawn — technique / opposition
  { name: 'K+P opposition', fen: '8/8/8/4k3/8/4P3/4K3/8 w - - 0 1', tag: 'CONVERSION' },
  // Minor-piece — fortress / conversion
  { name: 'Opposite bishops (draw tendency)', fen: '8/5k2/3b4/8/3P4/3B4/5K2/8 w - - 0 1', tag: 'SURVIVAL' },
  { name: 'B+N vs lone K (hard mate)', fen: '8/8/8/4k3/8/3BN3/8/4K3 w - - 0 1', tag: 'CONVERSION' },
  // Quiet-defense middlegame (a calm position needing a precise quiet move)
  { name: 'IQP middlegame (quiet maneuvering)', fen: 'r1bq1rk1/pp2bppp/2n1pn2/8/2BP4/2N1PN2/PP3PPP/R1BQ1RK1 w - - 0 1', tag: 'QUIET_DEFENSE' },
  { name: 'Hedgehog (slow squeeze)', fen: 'r1bq1rk1/1p1nbppp/p2ppn2/8/2P1P3/2N2N2/PPB1QPPP/R1B2RK1 w - - 0 1', tag: 'POSITIONAL' },
];

const curatedStressPositions = (): StressPosition[] =>
  CURATED_RAW.filter((p) => isLegalFen(p.fen)).map((p) => ({ ...p, source: 'curated' as const }));

/** All stress positions: book-derived + validated curated. */
export function getStressPositions(): StressPosition[] {
  return [...bookStressPositions(), ...curatedStressPositions()];
}
