// Seed puzzle set — a small, correct benchmark that runs in CI. Five validated
// Tier-1 tactics (solutions verified by our own detectors/tests) plus one REAL
// Lichess puzzle (the daily) that is deliberately out of Tier-1 scope, so the
// harness demonstrates honest miss-reporting on genuine data. Run the full
// Lichess DB via:  PUZZLE_CSV=lichess_db_puzzle.csv npx vitest run …benchmark
import type { Puzzle } from './puzzles';

export const SEED_PUZZLES: Puzzle[] = [
  {
    id: 'seed-fork-Nc2',
    fen: 'r2qkbnr/ppp1pppp/8/3p1b2/1n1P1B2/2P1PN2/PP3PPP/RN1QKB1R b KQkq - 0 5',
    solution: ['b4c2', 'e1d2', 'c2a1'], // …Nc2+ Kd2 Nxa1, forking K and rook
    themes: ['fork', 'opening', 'short'],
  },
  {
    id: 'seed-fork-Nf2',
    fen: '6k1/8/8/8/6n1/8/8/3Q3K b - - 0 1',
    solution: ['g4f2', 'h1g2', 'f2d1'], // …Nf2+ wins the queen
    themes: ['fork', 'endgame', 'short'],
  },
  {
    id: 'seed-mate-R1e7',
    fen: '4R3/3N1kpp/p1r3p1/3p4/2p2PrP/8/P1P3P1/4R1K1 w - - 0 31',
    solution: ['e1e7'], // R1e7#
    themes: ['mate', 'mateIn1', 'endgame'],
  },
  {
    id: 'seed-backrank-Re8',
    fen: '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1',
    solution: ['e1e8'], // Re8#
    themes: ['mate', 'mateIn1', 'backRankMate'],
  },
  {
    id: 'seed-hanging-g4',
    fen: 'r3r1k1/ppp2ppp/5q2/3p4/3N2n1/3BP3/PPP2PPP/R2Q1RK1 w - - 4 15',
    solution: ['d1g4'], // Qxg4 wins the loose knight
    themes: ['hangingPiece', 'middlegame'],
  },
  {
    // REAL Lichess puzzle (daily). mateIn4 / sacrifice / deflection — beyond
    // Tier-1; expected to be an HONEST miss, never a false claim.
    id: 'npYRr',
    fen: 'r4r2/1p5k/p3p2b/2ppP1R1/3n4/2N3Q1/PPP2q2/1K4R1 w - - 1 1',
    solution: ['g5g7', 'h7h8', 'g7h7', 'h8h7', 'g3g6', 'h7h8', 'g6h6'],
    themes: ['exposedKing', 'middlegame', 'attraction', 'sacrifice', 'mateIn4', 'deflection'],
    rating: 1837,
  },
];
