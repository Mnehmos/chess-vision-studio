// Dataset analytics — aggregate the per-ply analysis cache ACROSS ALL GAMES and
// answer the meta question the player actually cares about: "do I play better in
// the morning than at night?" We bucket each game by the hero's local clock hour
// (parsed from chess.com UTCDate/UTCTime headers) and roll up score, accuracy and
// cpLoss per time-of-day. Pure & structural — feed it the cache the UI already has.
import type { MoveAnalysis, Classification } from './types';
import type { ParsedGame } from './position';
import {
  computeAnalytics,
  moveAccuracy,
  type AnalyzedEntry,
  type GameAnalytics,
  type WorstMove,
} from './analytics';

// Re-export so views can render dataset stats without importing analytics too.
export type { GameAnalytics, SideStats, WorstMove } from './analytics';

export type AnalysisCache = Map<string, Map<number, MoveAnalysis>>;

export type TimeBucketKey = 'night' | 'morning' | 'afternoon' | 'evening';

export interface DatasetCoverage {
  gamesTotal: number;
  gamesAnalyzed: number;
  gamesFull: number;
  pliesTotal: number;
  pliesAnalyzed: number;
}

export interface DatasetWorstMove extends WorstMove {
  gameIndex: number;
  gameLabel: string;
}

export interface TimeBucket {
  key: TimeBucketKey;
  label: string; // label like 'Morning' (06–12)
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score: number; // hero points: win=1, draw=0.5, loss=0 (only counted when hero color known)
  scorePct: number | null; // score/games*100, null if games===0
  analyzedPlies: number;
  avgCpLoss: number | null; // hero's avg cpLoss over analyzed hero plies in bucket, null if none
  accuracy: number | null; // hero accuracy 0..100 (mean of moveAccuracy), null if none
}

export interface DatasetAnalysis {
  hero: string | null;
  coverage: DatasetCoverage;
  overall: GameAnalytics; // computeAnalytics over EVERY analyzed ply across all games
  worst: DatasetWorstMove[]; // biggest cpLoss teaching moments across dataset, worst first, top ~12
  timeOfDay: TimeBucket[]; // ALWAYS length 4, order: morning, afternoon, evening, night
}

const TEACHING_CLASSES: ReadonlySet<Classification> = new Set<Classification>([
  'inaccuracy',
  'mistake',
  'blunder',
]);

// Fixed display order of the four buckets.
const BUCKET_ORDER: TimeBucketKey[] = ['morning', 'afternoon', 'evening', 'night'];

/** Map a 0–23 clock hour to its time-of-day bucket. */
export function bucketForHour(hour: number): { key: TimeBucketKey; label: string } {
  if (hour >= 6 && hour <= 11) return { key: 'morning', label: 'Morning' };
  if (hour >= 12 && hour <= 17) return { key: 'afternoon', label: 'Afternoon' };
  if (hour >= 18 && hour <= 23) return { key: 'evening', label: 'Evening' };
  return { key: 'night', label: 'Night' }; // 0–5 (and any out-of-range fallback)
}

/** Build a Date for the game start from chess.com headers (UTCDate '2026.06.02'
 *  + UTCTime 'HH:MM:SS'; falls back to Date + StartTime). Returns null if the
 *  pair is missing or unparseable. The Date is constructed via Date.UTC so the
 *  caller's getHours() reflects the local clock. */
export function gameStartDate(headers: Record<string, string>): Date | null {
  const date = headers.UTCDate ?? headers.Date;
  const time = headers.UTCTime ?? headers.StartTime;
  if (!date || !time) return null;
  const dm = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(date.trim());
  const tm = /^(\d{2}):(\d{2}):(\d{2})$/.exec(time.trim());
  if (!dm || !tm) return null;
  const [, y, mo, d] = dm;
  const [, h, mi, s] = tm;
  const ms = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  );
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function normResult(r: string | undefined): '1-0' | '0-1' | '1/2-1/2' | '*' {
  return r === '1-0' || r === '0-1' || r === '1/2-1/2' ? r : '*';
}

function heroColorFor(headers: Record<string, string>, hero: string | null): 'w' | 'b' | null {
  if (!hero) return null;
  return headers.White === hero ? 'w' : headers.Black === hero ? 'b' : null;
}

/** Hero points for a finished game (win 1, draw 0.5, loss 0); null if unfinished. */
function heroScoreFor(color: 'w' | 'b', result: '1-0' | '0-1' | '1/2-1/2' | '*'): number | null {
  if (result === '1/2-1/2') return 0.5;
  if (result === '1-0') return color === 'w' ? 1 : 0;
  if (result === '0-1') return color === 'b' ? 1 : 0;
  return null;
}

interface BucketAcc {
  key: TimeBucketKey;
  label: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score: number;
  analyzedPlies: number;
  cpLossSum: number;
  accSum: number;
  heroPlies: number; // count of hero analyzed plies (denominator for cpLoss/accuracy)
}

function emptyBucket(key: TimeBucketKey, label: string): BucketAcc {
  return {
    key,
    label,
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    score: 0,
    analyzedPlies: 0,
    cpLossSum: 0,
    accSum: 0,
    heroPlies: 0,
  };
}

function labelForKey(key: TimeBucketKey): string {
  const probe = key === 'morning' ? 6 : key === 'afternoon' ? 12 : key === 'evening' ? 18 : 0;
  return bucketForHour(probe).label;
}

export function computeDatasetAnalysis(
  games: ParsedGame[],
  cache: AnalysisCache,
  keyOf: (g: ParsedGame) => string,
  hero: string | null,
): DatasetAnalysis {
  const coverage: DatasetCoverage = {
    gamesTotal: games.length,
    gamesAnalyzed: 0,
    gamesFull: 0,
    pliesTotal: 0,
    pliesAnalyzed: 0,
  };

  const allEntries: AnalyzedEntry[] = [];
  const worstAll: DatasetWorstMove[] = [];

  const buckets = new Map<TimeBucketKey, BucketAcc>();
  for (const key of BUCKET_ORDER) buckets.set(key, emptyBucket(key, labelForKey(key)));

  for (const g of games) {
    coverage.pliesTotal += g.plies.length;
    const moves = cache.get(keyOf(g));
    const analyzedCount = moves?.size ?? 0;
    if (analyzedCount > 0) coverage.gamesAnalyzed += 1;
    if (g.plies.length > 0 && analyzedCount >= g.plies.length) coverage.gamesFull += 1;
    coverage.pliesAnalyzed += analyzedCount;

    const heroColor = heroColorFor(g.headers, hero);

    // Time-of-day bucket for this game (skip game entirely if start time unknown).
    const start = gameStartDate(g.headers);
    const bucket = start ? buckets.get(bucketForHour(start.getHours()).key) ?? null : null;
    if (bucket) {
      bucket.games += 1;
      const result = normResult(g.headers.Result);
      const score = heroColor ? heroScoreFor(heroColor, result) : null;
      if (score !== null) {
        bucket.score += score;
        if (score === 1) bucket.wins += 1;
        else if (score === 0.5) bucket.draws += 1;
        else bucket.losses += 1;
      }
    }

    if (!moves) continue;

    for (const [plyIndex, analysis] of moves) {
      const rec = g.plies[plyIndex];
      if (!rec) continue; // cache key outside this game's plies — ignore
      allEntries.push({ ply: plyIndex, color: rec.color, analysis });

      if (TEACHING_CLASSES.has(analysis.classification) || analysis.cpLoss >= 1) {
        worstAll.push({
          ply: plyIndex,
          color: rec.color,
          move: analysis.move,
          cpLoss: analysis.cpLoss,
          classification: analysis.classification,
          gameIndex: g.index,
          gameLabel: g.label,
        });
      }

      // Hero-only contributions to the time-of-day cpLoss/accuracy.
      if (bucket && heroColor && rec.color === heroColor) {
        bucket.analyzedPlies += 1;
        bucket.heroPlies += 1;
        bucket.cpLossSum += analysis.cpLoss;
        bucket.accSum += moveAccuracy(analysis.cpLoss);
      }
    }
  }

  const overall = computeAnalytics(allEntries);

  const worst = worstAll.sort((a, b) => b.cpLoss - a.cpLoss).slice(0, 12);

  const timeOfDay: TimeBucket[] = BUCKET_ORDER.map((key) => {
    const b = buckets.get(key)!;
    return {
      key: b.key,
      label: b.label,
      games: b.games,
      wins: b.wins,
      draws: b.draws,
      losses: b.losses,
      score: b.score,
      scorePct: b.games ? (b.score / b.games) * 100 : null,
      analyzedPlies: b.analyzedPlies,
      avgCpLoss: b.heroPlies ? b.cpLossSum / b.heroPlies : null,
      accuracy: b.heroPlies ? b.accSum / b.heroPlies : null,
    };
  });

  return { hero, coverage, overall, worst, timeOfDay };
}
