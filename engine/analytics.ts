// Game analytics — aggregate the per-ply MoveAnalysis parameters into a review
// summary (accuracy, mistake counts, what to work on). Pure & testable.
import type { Classification, MoveAnalysis } from './types';

const CLASSES: Classification[] = [
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'blunder',
];

export interface SideStats {
  moves: number;
  byClass: Record<Classification, number>;
  avgCpLoss: number; // pawns
  accuracy: number; // 0..100
}

export interface WorstMove {
  ply: number;
  color: 'w' | 'b';
  move: string;
  cpLoss: number;
  classification: Classification;
}

export interface GameAnalytics {
  white: SideStats;
  black: SideStats;
  /** Headline insight category counts across the game (forks, hangs, mate threats…). */
  headlineCounts: Record<string, number>;
  /** The biggest cpLoss moves (teaching moments), worst first — both sides merged. */
  worstMoves: WorstMove[];
  /** Biggest mistakes separated by ownership (worst first), so each player owns theirs. */
  worstByColor: { w: WorstMove[]; b: WorstMove[] };
  /** Forced mates that appeared. */
  matesFound: number;
}

/** Per-move accuracy from centipawn loss (pawns): 0 loss → 100, decaying. */
export function moveAccuracy(cpLossPawns: number): number {
  return Math.max(0, Math.min(100, 100 * Math.exp(-cpLossPawns / 2.5)));
}

export interface AnalyzedEntry {
  ply: number;
  color: 'w' | 'b';
  analysis: MoveAnalysis;
}

function emptySide(): SideStats {
  const byClass = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<Classification, number>;
  return { moves: 0, byClass, avgCpLoss: 0, accuracy: 0 };
}

export function computeAnalytics(entries: AnalyzedEntry[]): GameAnalytics {
  const white = emptySide();
  const black = emptySide();
  const headlineCounts: Record<string, number> = {};
  const sumCp = { w: 0, b: 0 };
  const sumAcc = { w: 0, b: 0 };
  let matesFound = 0;

  for (const e of entries) {
    const side = e.color === 'w' ? white : black;
    side.moves += 1;
    side.byClass[e.analysis.classification] += 1;
    const cp = e.analysis.cpLoss;
    if (e.color === 'w') {
      sumCp.w += cp;
      sumAcc.w += moveAccuracy(cp);
    } else {
      sumCp.b += cp;
      sumAcc.b += moveAccuracy(cp);
    }
    const top = e.analysis.rankedInsights[0];
    if (top) headlineCounts[top.type] = (headlineCounts[top.type] ?? 0) + 1;
    if (e.analysis.mateProof) matesFound += 1;
  }

  white.avgCpLoss = white.moves ? sumCp.w / white.moves : 0;
  black.avgCpLoss = black.moves ? sumCp.b / black.moves : 0;
  white.accuracy = white.moves ? sumAcc.w / white.moves : 0;
  black.accuracy = black.moves ? sumAcc.b / black.moves : 0;

  const ranked: WorstMove[] = entries
    .map((e) => ({
      ply: e.ply,
      color: e.color,
      move: e.analysis.move,
      cpLoss: e.analysis.cpLoss,
      classification: e.analysis.classification,
    }))
    .filter((m) => m.cpLoss >= 1) // only real mistakes
    .sort((a, b) => b.cpLoss - a.cpLoss);

  const worstMoves = ranked.slice(0, 5);
  const worstByColor = {
    w: ranked.filter((m) => m.color === 'w').slice(0, 5),
    b: ranked.filter((m) => m.color === 'b').slice(0, 5),
  };

  return { white, black, headlineCounts, worstMoves, worstByColor, matesFound };
}
