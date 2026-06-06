// Opening tree / move explorer — position-keyed aggregation over a full game list
// (the OpeningTree "Moves" view). For every position reached across all games,
// tally which moves were played and how those games turned out. Pure & testable.
import type { ParsedGame } from './position';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface MoveStat {
  san: string;
  games: number;
  whiteWins: number;
  draws: number;
  blackWins: number;
  fenAfter: string; // a representative resulting position (lets the UI drill deeper)
}

export interface OpeningTree {
  /** normalized-FEN → moves played from that position, sorted by frequency. */
  byPosition: Map<string, MoveStat[]>;
  rootFen: string;
}

/** Position key: placement + side + castling + en-passant (drop move clocks so
 *  transpositions merge into the same node). */
export function normFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

function resultCode(result: string | undefined): 'w' | 'b' | 'd' | null {
  if (result === '1-0') return 'w';
  if (result === '0-1') return 'b';
  if (result === '1/2-1/2') return 'd';
  return null;
}

export function buildOpeningTree(games: ParsedGame[], opts: { maxPlies?: number } = {}): OpeningTree {
  const maxPlies = opts.maxPlies ?? Infinity;
  const raw = new Map<string, Map<string, MoveStat>>();

  for (const g of games) {
    const r = resultCode(g.headers.Result);
    const lim = Math.min(g.plies.length, maxPlies);
    for (let i = 0; i < lim; i++) {
      const ply = g.plies[i];
      const key = normFen(ply.fenBefore);
      let moves = raw.get(key);
      if (!moves) {
        moves = new Map();
        raw.set(key, moves);
      }
      let stat = moves.get(ply.san);
      if (!stat) {
        stat = { san: ply.san, games: 0, whiteWins: 0, draws: 0, blackWins: 0, fenAfter: ply.fenAfter };
        moves.set(ply.san, stat);
      }
      stat.games += 1;
      if (r === 'w') stat.whiteWins += 1;
      else if (r === 'b') stat.blackWins += 1;
      else if (r === 'd') stat.draws += 1;
    }
  }

  const byPosition = new Map<string, MoveStat[]>();
  for (const [key, moves] of raw) {
    byPosition.set(key, [...moves.values()].sort((a, b) => b.games - a.games));
  }
  return { byPosition, rootFen: START_FEN };
}

/** Moves played from a given position across the dataset (desc by game count). */
export function movesFrom(tree: OpeningTree, fen: string): MoveStat[] {
  return tree.byPosition.get(normFen(fen)) ?? [];
}
