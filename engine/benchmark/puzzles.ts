// Lichess puzzle benchmark — a perfect-information backtest. Each puzzle is
// FEN + solution line + curated themes (fork, pin, skewer, backRankMate,
// hangingPiece, …). We score two things per puzzle:
//   1. DETECTION  — did we surface the solution's key move as a validated tactic?
//   2. LABELLING  — does our motif type match the puzzle's theme?
// Themes outside Tier-1 (deep mates, Tier-2 motifs) are reported as honest
// misses, never silently dropped.
import { Chess } from 'chess.js';
import { detectAvailableMotifs } from '../motif';
import { seeCapture } from '../see';
import type { MotifType } from '../types';

export interface Puzzle {
  id: string;
  fen: string; // the position to SOLVE (side to move plays solution[0])
  solution: string[]; // UCI moves from `fen`
  themes: string[];
  rating?: number;
}

/** Our Tier-1 motif types → the Lichess theme tags they correspond to. */
export const MOTIF_THEME: Record<string, string[]> = {
  fork: ['fork'],
  pin_absolute: ['pin'],
  pin_relative: ['pin'],
  skewer: ['skewer'],
  discovered_check: ['discoveredAttack'],
  discovered_attack: ['discoveredAttack'],
  back_rank: ['backRankMate'],
  mating_net: ['mate', 'mateIn1'],
  removal_of_guard: ['hangingPiece'],
};

/** Themes our Tier-1 engine claims to cover (others → expected misses). */
export const COVERED_THEMES = new Set<string>([
  'fork',
  'mateIn1',
  'backRankMate',
  'hangingPiece',
]);

/** Convert a UCI move to SAN in the given position (for matching motif lines). */
export function uciToSan(fen: string, uci: string): string | null {
  const c = new Chess(fen);
  const m = c.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
  });
  return m ? m.san : null;
}

export interface PuzzleResult {
  id: string;
  themes: string[];
  covered: boolean; // does the puzzle have a theme we claim to cover?
  keyMoveSan: string | null;
  detected: boolean; // did we surface the key move as a validated tactic?
  detectedTypes: MotifType[];
  detectedThemes: string[];
  labelMatch: boolean; // do our labels intersect the puzzle's themes?
}

/** Score a single puzzle against the Tier-1 detectors. */
export function scorePuzzle(p: Puzzle): PuzzleResult {
  const keyUci = p.solution[0];
  const keySan = keyUci ? uciToSan(p.fen, keyUci) : null;

  const motifs = detectAvailableMotifs(p.fen).motifs;
  const moveMotifs = keySan ? motifs.filter((m) => m.line[0] === keySan) : [];
  const detectedTypes = moveMotifs.map((m) => m.type);

  // Hanging-piece puzzles whose key move is a winning capture (SEE > 0).
  let hangingDetected = false;
  if (keyUci) {
    const from = keyUci.slice(0, 2);
    const to = keyUci.slice(2, 4);
    const captured = new Chess(p.fen).get(to as never);
    if (captured && seeCapture(p.fen, from, to) > 0) hangingDetected = true;
  }

  const detectedThemes = new Set<string>();
  for (const t of detectedTypes) for (const th of MOTIF_THEME[t] ?? []) detectedThemes.add(th);
  if (hangingDetected) detectedThemes.add('hangingPiece');

  const detected = moveMotifs.length > 0 || hangingDetected;
  const labelMatch = [...detectedThemes].some((t) => p.themes.includes(t));
  const covered = p.themes.some((t) => COVERED_THEMES.has(t));

  return {
    id: p.id,
    themes: p.themes,
    covered,
    keyMoveSan: keySan,
    detected,
    detectedTypes,
    detectedThemes: [...detectedThemes],
    labelMatch,
  };
}

export interface BenchmarkReport {
  total: number;
  covered: number;
  detectedOnCovered: number;
  labelMatchOnCovered: number;
  perTheme: Record<string, { n: number; detected: number; labelMatch: number }>;
  results: PuzzleResult[];
}

export function runBenchmark(puzzles: Puzzle[]): BenchmarkReport {
  const results = puzzles.map(scorePuzzle);
  const perTheme: BenchmarkReport['perTheme'] = {};
  for (const r of results) {
    for (const t of r.themes) {
      perTheme[t] ??= { n: 0, detected: 0, labelMatch: 0 };
      perTheme[t].n++;
      if (r.detected) perTheme[t].detected++;
      if (r.labelMatch) perTheme[t].labelMatch++;
    }
  }
  const coveredResults = results.filter((r) => r.covered);
  return {
    total: results.length,
    covered: coveredResults.length,
    detectedOnCovered: coveredResults.filter((r) => r.detected).length,
    labelMatchOnCovered: coveredResults.filter((r) => r.labelMatch).length,
    perTheme,
    results,
  };
}

/** Human-readable report for logs / CLI. */
export function formatReport(rep: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`Puzzles: ${rep.total} | covered (Tier-1 themes): ${rep.covered}`);
  if (rep.covered > 0) {
    lines.push(
      `  detection on covered: ${rep.detectedOnCovered}/${rep.covered} ` +
        `(${pct(rep.detectedOnCovered, rep.covered)})`,
    );
    lines.push(
      `  label match on covered: ${rep.labelMatchOnCovered}/${rep.covered} ` +
        `(${pct(rep.labelMatchOnCovered, rep.covered)})`,
    );
  }
  lines.push('  per-theme (n · detected · label):');
  for (const t of Object.keys(rep.perTheme).sort()) {
    const s = rep.perTheme[t];
    const mark = COVERED_THEMES.has(t) ? '✓' : '·';
    lines.push(`    ${mark} ${t.padEnd(18)} n=${s.n}  det=${s.detected}  lbl=${s.labelMatch}`);
  }
  return lines.join('\n');
}

function pct(a: number, b: number): string {
  return b === 0 ? 'n/a' : `${Math.round((100 * a) / b)}%`;
}

// ────────────────────────────────────────────────────────────────────────────
// Official Lichess CSV adapter:
//   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
// In the CSV, FEN is the position BEFORE the opponent's setup move; the player
// solves AFTER applying Moves[0]. So solveFen = apply(Moves[0]); solution = rest.
// ────────────────────────────────────────────────────────────────────────────
export function puzzleFromCsvRow(row: string): Puzzle | null {
  const cols = row.split(',');
  if (cols.length < 8) return null;
  const [id, fen, movesStr, rating] = cols;
  const themes = (cols[7] ?? '').trim().split(/\s+/).filter(Boolean);
  const uci = movesStr.trim().split(/\s+/).filter(Boolean);
  if (uci.length < 2) return null;
  const c = new Chess(fen);
  const setup = c.move({
    from: uci[0].slice(0, 2),
    to: uci[0].slice(2, 4),
    promotion: uci[0].length > 4 ? uci[0].slice(4, 5) : undefined,
  });
  if (!setup) return null;
  return { id, fen: c.fen(), solution: uci.slice(1), themes, rating: Number(rating) || undefined };
}

export function parsePuzzleCsv(text: string, limit = Infinity): Puzzle[] {
  const out: Puzzle[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('PuzzleId')) continue; // skip header
    const p = puzzleFromCsvRow(line);
    if (p) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}
