// Derived per-ply features for learning over time. Raw maps are for display;
// these named facts are stable counters that can be aggregated across games.
import { Chess } from 'chess.js';
import { allPieces, fileOf, parseFen, pieceAt, rankOf, toSquare, type Color, type PieceType } from './board';
import { buildRelationMap } from './relations';
import { detectAvailableMotifs } from './motif';
import { findPoisonedCaptures, PIECE_VALUE, seeCapture, seeOnSquare } from './see';
import type { MoveAnalysis, MotifType, Square } from './types';

export type Phase = 'opening' | 'middlegame' | 'endgame';

export type PatternType =
  | 'loose_piece_habit'
  | 'only_defender_moved'
  | 'missed_forcing_move'
  | 'king_safety_collapse'
  | 'bad_capture'
  | 'walked_into_motif'
  | 'missed_free_material'
  | 'pawn_structure_damage';

export interface CountBySide {
  w: number;
  b: number;
}

export interface LegalFeatureSummary {
  total: number;
  safe: number;
  captures: number;
  checks: number;
  forcing: number;
  tacticalCandidates: number;
  byPiece: Record<PieceType, number>;
  kingEscapes: number;
}

export interface ThreatFeatureSummary {
  whiteControl: number;
  blackControl: number;
  contested: number;
  centerWhite: number;
  centerBlack: number;
  whiteKingPressure: number;
  blackKingPressure: number;
  checksAvailable: CountBySide;
  initiative: CountBySide;
}

export interface DefenseFeatureSummary {
  loosePieces: CountBySide;
  undefendedHighValue: CountBySide;
  hangingPieces: CountBySide;
  hangingValue: CountBySide;
  overDefended: CountBySide;
}

export interface SeeFeatureSummary {
  bestWin: CountBySide;
  poisonedCaptures: CountBySide;
  playedCaptureSee: number | null;
  missedFreeMaterial: boolean;
}

export interface PawnFeatureSummary {
  isolated: CountBySide;
  doubled: CountBySide;
  passed: CountBySide;
  islands: CountBySide;
  openFiles: number;
  semiOpenFiles: CountBySide;
  kingShieldMissing: CountBySide;
}

export interface MotifFeatureSummary {
  availableBefore: Partial<Record<MotifType, number>>;
  createdAfter: Partial<Record<MotifType, number>>;
  missedByMover: Partial<Record<MotifType, number>>;
  refutation: Partial<Record<MotifType, number>>;
}

export interface PatternEvent {
  type: PatternType;
  side: Color;
  severity: number;
  label: string;
  squares: Square[];
}

export interface PlyFeatures {
  phase: Phase;
  mover: Color;
  move: string;
  legalBefore: LegalFeatureSummary;
  opponentLegalAfter: LegalFeatureSummary;
  mobilityDelta: number;
  safeMoveDelta: number;
  threatBefore: ThreatFeatureSummary;
  threatAfter: ThreatFeatureSummary;
  threatVolatility: number;
  defenseBefore: DefenseFeatureSummary;
  defenseAfter: DefenseFeatureSummary;
  see: SeeFeatureSummary;
  pawnBefore: PawnFeatureSummary;
  pawnAfter: PawnFeatureSummary;
  motifs: MotifFeatureSummary;
  patterns: PatternEvent[];
  badges: string[];
}

// Board-control analytics — what share of the 64 squares each side's pieces attack
// (a "territory" read from the threat map). Contested squares are attacked by both.
export interface ControlShare {
  whitePct: number; // squares White attacks, as % of 64 (incl. contested)
  blackPct: number;
  contestedPct: number;
  exclusiveWhitePct: number; // White-only territory
  exclusiveBlackPct: number;
  neutralPct: number; // attacked by neither side
  centerWhite: number; // of the 4 center squares (d4/e4/d5/e5)
  centerBlack: number;
}

export function controlShare(t: ThreatFeatureSummary): ControlShare {
  const pct = (n: number) => Math.round((Math.max(0, n) / 64) * 100);
  // The board partitions into FOUR disjoint buckets that sum to 100%:
  //   White-only + contested + Black-only + neutral.
  // (whitePct/blackPct are each side's TOTAL reach and DO overlap on contested, so
  //  they must not be added together — they're for the tooltip/narration only.)
  const exclusiveWhitePct = pct(t.whiteControl - t.contested);
  const exclusiveBlackPct = pct(t.blackControl - t.contested);
  const contestedPct = pct(t.contested);
  const neutralPct = Math.max(0, 100 - exclusiveWhitePct - contestedPct - exclusiveBlackPct);
  return {
    whitePct: pct(t.whiteControl), // total reach (incl. contested)
    blackPct: pct(t.blackControl), // total reach (incl. contested)
    contestedPct,
    exclusiveWhitePct,
    exclusiveBlackPct,
    neutralPct,
    centerWhite: t.centerWhite,
    centerBlack: t.centerBlack,
  };
}

const CENTER = new Set(['d4', 'e4', 'd5', 'e5']);

const emptyPieceCounts = (): Record<PieceType, number> => ({ p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 });
const emptySide = (): CountBySide => ({ w: 0, b: 0 });

export function extractPlyFeatures(fenBefore: string, fenAfter: string, san: string, analysis: MoveAnalysis): PlyFeatures {
  const mover = parseFen(fenBefore).turn;
  const legalBefore = legalSummary(fenBefore);
  const opponentLegalAfter = legalSummary(fenAfter);
  const threatBefore = threatSummary(fenBefore);
  const threatAfter = threatSummary(fenAfter);
  const defenseBefore = defenseSummary(fenBefore);
  const defenseAfter = defenseSummary(fenAfter);
  const pawnBefore = pawnSummary(fenBefore);
  const pawnAfter = pawnSummary(fenAfter);
  const motifs = motifSummary(fenBefore, fenAfter, san, analysis);
  const see = seeSummary(fenBefore, san, mover);
  const phase = phaseOf(fenBefore);
  const patterns = patternEvents({
    fenBefore,
    fenAfter,
    san,
    analysis,
    mover,
    legalBefore,
    opponentLegalAfter,
    threatBefore,
    threatAfter,
    defenseBefore,
    defenseAfter,
    pawnBefore,
    pawnAfter,
    motifs,
    see,
  });

  return {
    phase,
    mover,
    move: analysis.move,
    legalBefore,
    opponentLegalAfter,
    mobilityDelta: opponentLegalAfter.total - legalBefore.total,
    safeMoveDelta: opponentLegalAfter.safe - legalBefore.safe,
    threatBefore,
    threatAfter,
    threatVolatility: controlVolatility(fenBefore, fenAfter),
    defenseBefore,
    defenseAfter,
    see,
    pawnBefore,
    pawnAfter,
    motifs,
    patterns,
    badges: badgesFor(mover, legalBefore, opponentLegalAfter, defenseAfter, see, motifs),
  };
}

export interface FeatureEntry {
  gameIndex?: number;
  ply: number;
  color: Color;
  analysis: MoveAnalysis;
  features: PlyFeatures;
}

export interface PatternProfile {
  totalPlies: number;
  patternCounts: Record<PatternType, number>;
  phase: Record<Phase, { moves: number; avgCpLoss: number }>;
  motifCreated: Partial<Record<MotifType, number>>;
  motifSuffered: Partial<Record<MotifType, number>>;
  looseByPiece: Record<string, number>;
  topPatterns: { type: PatternType; count: number; title: string; detail: string }[];
}

export function computePatternProfile(entries: FeatureEntry[]): PatternProfile {
  const patternCounts = {} as Record<PatternType, number>;
  const phase: Record<Phase, { moves: number; cp: number; avgCpLoss: number }> = {
    opening: { moves: 0, cp: 0, avgCpLoss: 0 },
    middlegame: { moves: 0, cp: 0, avgCpLoss: 0 },
    endgame: { moves: 0, cp: 0, avgCpLoss: 0 },
  };
  const motifCreated: Partial<Record<MotifType, number>> = {};
  const motifSuffered: Partial<Record<MotifType, number>> = {};
  const looseByPiece: Record<string, number> = {};

  for (const e of entries) {
    const p = phase[e.features.phase];
    p.moves += 1;
    p.cp += e.analysis.cpLoss;
    for (const event of e.features.patterns) patternCounts[event.type] = (patternCounts[event.type] ?? 0) + 1;
    addCounts(motifCreated, e.features.motifs.availableBefore);
    addCounts(motifSuffered, e.features.motifs.refutation);
    collectLoosePieces(e.analysis.positionAfter, e.features.mover, looseByPiece);
  }

  for (const p of Object.values(phase)) p.avgCpLoss = p.moves ? p.cp / p.moves : 0;
  const topPatterns = (Object.entries(patternCounts) as [PatternType, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([type, count]) => ({ type, count, ...patternCopy(type, count) }));

  return { totalPlies: entries.length, patternCounts, phase, motifCreated, motifSuffered, looseByPiece, topPatterns };
}

function legalSummary(fen: string, withMotifs = true): LegalFeatureSummary {
  const chess = new Chess(fen);
  const board = parseFen(fen);
  // Tactical-candidate detection makes hypothetical moves; only run it on the real
  // side-to-move position. For a flipped/other-side count (legalSummaryForSide), the
  // position can be illegal (opponent left in check), which would let chess.js
  // generate a king capture and throw downstream — so skip motifs there, and fail
  // soft if detection ever hits a malformed FEN so one bad ply can't crash the load.
  // Inlined (not a helper) so a partial HMR can never leave it "not defined".
  let motifs: Set<string>;
  if (withMotifs) {
    try {
      motifs = new Set(detectAvailableMotifs(fen).motifs.map((m) => m.line[0]));
    } catch {
      motifs = new Set<string>();
    }
  } else {
    motifs = new Set<string>();
  }
  const byPiece = emptyPieceCounts();
  let safe = 0;
  let captures = 0;
  let checks = 0;
  let forcing = 0;
  let tacticalCandidates = 0;
  let kingEscapes = 0;

  const moves = chess.moves({ verbose: true }) as Array<{ san: string; from: Square; to: Square; flags: string }>;
  for (const m of moves) {
    const piece = pieceAt(board, m.from);
    if (piece) byPiece[piece.type] += 1;
    const isCapture = m.flags.includes('c') || m.flags.includes('e');
    const isCheck = m.san.includes('+') || m.san.includes('#');
    if (isCapture) captures += 1;
    if (isCheck) checks += 1;
    if (isCapture || isCheck) forcing += 1;
    if (motifs.has(m.san)) tacticalCandidates += 1;
    if (piece?.type === 'k') kingEscapes += 1;
    if (isSafeDestination(fen, m)) safe += 1;
  }

  return { total: moves.length, safe, captures, checks, forcing, tacticalCandidates, byPiece, kingEscapes };
}

function threatSummary(fen: string): ThreatFeatureSummary {
  const rel = buildRelationMap(fen);
  const white = new Set(rel.controlledByWhite);
  const black = new Set(rel.controlledByBlack);
  const contested = [...white].filter((sq) => black.has(sq)).length;
  const legalW = legalSummaryForSide(fen, 'w');
  const legalB = legalSummaryForSide(fen, 'b');
  const whiteKingPressure = kingPressure(fen, 'w', black);
  const blackKingPressure = kingPressure(fen, 'b', white);
  return {
    whiteControl: white.size,
    blackControl: black.size,
    contested,
    centerWhite: [...CENTER].filter((sq) => white.has(sq)).length,
    centerBlack: [...CENTER].filter((sq) => black.has(sq)).length,
    whiteKingPressure,
    blackKingPressure,
    checksAvailable: { w: legalW.checks, b: legalB.checks },
    initiative: {
      w: legalW.forcing + blackKingPressure * 2,
      b: legalB.forcing + whiteKingPressure * 2,
    },
  };
}

function defenseSummary(fen: string): DefenseFeatureSummary {
  const board = parseFen(fen);
  const rel = buildRelationMap(fen);
  const loosePieces = emptySide();
  const undefendedHighValue = emptySide();
  const hangingPieces = emptySide();
  const hangingValue = emptySide();
  const overDefended = emptySide();

  for (const p of allPieces(board)) {
    const r = rel.bySquare[p.square];
    const defenders = r?.defendedBy.length ?? 0;
    const attackers = r?.attackedBy.length ?? 0;
    const value = PIECE_VALUE[p.type] >= 1000 ? 0 : PIECE_VALUE[p.type];
    const see = seeOnSquare(fen, p.square).swing;
    if (defenders === 0) loosePieces[p.color] += 1;
    if (defenders === 0 && value >= 3) undefendedHighValue[p.color] += 1;
    if (see > 0) {
      hangingPieces[p.color] += 1;
      hangingValue[p.color] += see;
    }
    if (attackers > 0 && defenders >= attackers + 2) overDefended[p.color] += 1;
  }

  return { loosePieces, undefendedHighValue, hangingPieces, hangingValue, overDefended };
}

function seeSummary(fen: string, san: string, mover: Color): SeeFeatureSummary {
  const playedCaptureSee = playedCaptureValue(fen, san);
  const bestWin = { w: bestSeeWinForSide(fen, 'w'), b: bestSeeWinForSide(fen, 'b') };
  const poisonedCaptures = {
    w: poisonedForSide(fen, 'w'),
    b: poisonedForSide(fen, 'b'),
  };
  return {
    bestWin,
    poisonedCaptures,
    playedCaptureSee,
    missedFreeMaterial: bestWin[mover] >= 3 && (playedCaptureSee ?? 0) < bestWin[mover],
  };
}

function pawnSummary(fen: string): PawnFeatureSummary {
  const board = parseFen(fen);
  const pawns = allPieces(board).filter((p) => p.type === 'p');
  const isolated = emptySide();
  const doubled = emptySide();
  const passed = emptySide();
  const islands = emptySide();
  const semiOpenFiles = emptySide();
  const filesBySide: Record<Color, Set<number>> = { w: new Set(), b: new Set() };
  const kingShieldMissing = emptySide();

  for (const p of pawns) filesBySide[p.color].add(fileOf(p.square));
  for (const color of ['w', 'b'] as Color[]) {
    let last = -2;
    for (const f of [...filesBySide[color]].sort((a, b) => a - b)) {
      if (f !== last + 1) islands[color] += 1;
      last = f;
    }
    const enemy = other(color);
    for (let f = 0; f < 8; f++) {
      if (!filesBySide[color].has(f) && filesBySide[enemy].has(f)) semiOpenFiles[color] += 1;
    }
  }

  for (const p of pawns) {
    const f = fileOf(p.square);
    const ownFiles = filesBySide[p.color];
    const enemyFiles = filesBySide[other(p.color)];
    if (!ownFiles.has(f - 1) && !ownFiles.has(f + 1)) isolated[p.color] += 1;
    if (pawns.filter((q) => q.color === p.color && fileOf(q.square) === f).length > 1) doubled[p.color] += 1;
    if (!enemyFiles.has(f) && !enemyFiles.has(f - 1) && !enemyFiles.has(f + 1)) passed[p.color] += 1;
  }

  for (const king of allPieces(board).filter((p) => p.type === 'k')) {
    const kf = fileOf(king.square);
    const homeRank = king.color === 'w' ? 1 : 6;
    for (const f of [kf - 1, kf, kf + 1]) {
      if (f < 0 || f > 7) continue;
      const shield = pieceAt(board, toSquare(f, homeRank));
      if (!shield || shield.color !== king.color || shield.type !== 'p') kingShieldMissing[king.color] += 1;
    }
  }

  const openFiles = Array.from({ length: 8 }, (_, f) => f).filter(
    (f) => !filesBySide.w.has(f) && !filesBySide.b.has(f),
  ).length;
  return { isolated, doubled, passed, islands, openFiles, semiOpenFiles, kingShieldMissing };
}

function motifSummary(fenBefore: string, fenAfter: string, san: string, analysis: MoveAnalysis): MotifFeatureSummary {
  const before = detectAvailableMotifs(fenBefore).motifs;
  const after = detectAvailableMotifs(fenAfter).motifs;
  const playedMotif = before.some((m) => m.line[0] === san);
  const availableBefore = countMotifs(before.map((m) => m.type));
  const createdAfter = countMotifs(after.map((m) => m.type));
  const missedByMover = playedMotif ? {} : availableBefore;
  const refutation = countMotifs(
    analysis.rankedInsights.flatMap((i) => (i.kind === 'motif' && i.source === 'refutation' ? [i.type] : [])),
  );
  return { availableBefore, createdAfter, missedByMover, refutation };
}

function patternEvents(ctx: {
  fenBefore: string;
  fenAfter: string;
  san: string;
  analysis: MoveAnalysis;
  mover: Color;
  legalBefore: LegalFeatureSummary;
  opponentLegalAfter: LegalFeatureSummary;
  threatBefore: ThreatFeatureSummary;
  threatAfter: ThreatFeatureSummary;
  defenseBefore: DefenseFeatureSummary;
  defenseAfter: DefenseFeatureSummary;
  pawnBefore: PawnFeatureSummary;
  pawnAfter: PawnFeatureSummary;
  motifs: MotifFeatureSummary;
  see: SeeFeatureSummary;
}): PatternEvent[] {
  const out: PatternEvent[] = [];
  const mover = ctx.mover;
  const afterKingPressure = mover === 'w' ? ctx.threatAfter.whiteKingPressure : ctx.threatAfter.blackKingPressure;
  const beforeKingPressure = mover === 'w' ? ctx.threatBefore.whiteKingPressure : ctx.threatBefore.blackKingPressure;
  const afterKingEscapes = ctx.opponentLegalAfter.kingEscapes;

  if ((ctx.see.playedCaptureSee ?? 0) < 0) {
    out.push({
      type: 'bad_capture',
      side: mover,
      severity: Math.abs(ctx.see.playedCaptureSee ?? 0),
      label: 'Played a SEE-losing capture',
      squares: [],
    });
  }
  if (ctx.see.missedFreeMaterial) {
    out.push({
      type: 'missed_free_material',
      side: mover,
      severity: ctx.see.bestWin[mover],
      label: `Missed a clean SEE win of ${ctx.see.bestWin[mover]}`,
      squares: [],
    });
  }
  if (sumCounts(ctx.motifs.missedByMover) > 0 || (ctx.legalBefore.checks > 0 && !isForcing(ctx.san) && ctx.analysis.cpLoss >= 0.5)) {
    out.push({
      type: 'missed_forcing_move',
      side: mover,
      severity: Math.max(1, ctx.legalBefore.checks + sumCounts(ctx.motifs.missedByMover)),
      label: 'Missed a forcing move or validated tactic',
      squares: [],
    });
  }
  if (ctx.defenseAfter.hangingValue[mover] >= 3 || ctx.defenseAfter.undefendedHighValue[mover] > ctx.defenseBefore.undefendedHighValue[mover]) {
    out.push({
      type: 'loose_piece_habit',
      side: mover,
      severity: ctx.defenseAfter.hangingValue[mover] || ctx.defenseAfter.undefendedHighValue[mover],
      label: 'Left valuable material loose',
      squares: hangingSquares(ctx.fenAfter, mover),
    });
  }
  if (onlyDefenderMoved(ctx.fenBefore, ctx.fenAfter, ctx.san, mover)) {
    out.push({
      type: 'only_defender_moved',
      side: mover,
      severity: 2,
      label: 'Moved the only defender away',
      squares: [],
    });
  }
  if (afterKingPressure - beforeKingPressure >= 2 || afterKingEscapes <= 1) {
    out.push({
      type: 'king_safety_collapse',
      side: mover,
      severity: Math.max(1, afterKingPressure - beforeKingPressure),
      label: 'King safety got cramped',
      squares: [],
    });
  }
  if (sumCounts(ctx.motifs.createdAfter) > 0 && ctx.analysis.cpLoss >= 1) {
    out.push({
      type: 'walked_into_motif',
      side: mover,
      severity: ctx.analysis.cpLoss,
      label: 'Walked into a validated motif',
      squares: [],
    });
  }
  if (
    ctx.pawnAfter.kingShieldMissing[mover] > ctx.pawnBefore.kingShieldMissing[mover] ||
    ctx.pawnAfter.isolated[mover] > ctx.pawnBefore.isolated[mover] ||
    ctx.pawnAfter.doubled[mover] > ctx.pawnBefore.doubled[mover]
  ) {
    out.push({
      type: 'pawn_structure_damage',
      side: mover,
      severity: 1,
      label: 'Pawn structure weakened',
      squares: [],
    });
  }
  return out;
}

function isSafeDestination(fen: string, move: { san: string; to: Square; from: Square }): boolean {
  const before = parseFen(fen);
  const piece = pieceAt(before, move.from);
  if (piece?.type === 'k') return true;
  const chess = new Chess(fen);
  const played = chess.move(move.san);
  if (!played) return false;
  return seeOnSquare(chess.fen(), move.to).swing <= 0;
}

function legalSummaryForSide(fen: string, color: Color): LegalFeatureSummary {
  return legalSummary(turnFen(fen, color), false);
}

function turnFen(fen: string, color: Color): string {
  const parts = fen.trim().split(/\s+/);
  parts[1] = color;
  parts[3] = '-';
  return parts.join(' ');
}

function kingPressure(fen: string, color: Color, enemyControl: Set<string>): number {
  const king = allPieces(parseFen(fen)).find((p) => p.color === color && p.type === 'k');
  if (!king) return 0;
  return kingZone(king.square).filter((sq) => enemyControl.has(sq)).length;
}

function kingZone(square: Square): Square[] {
  const out = [square];
  const f0 = fileOf(square);
  const r0 = rankOf(square);
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const f = f0 + df;
      const r = r0 + dr;
      if (f >= 0 && f < 8 && r >= 0 && r < 8) out.push(toSquare(f, r));
    }
  }
  return out;
}

function controlVolatility(beforeFen: string, afterFen: string): number {
  const before = buildRelationMap(beforeFen);
  const after = buildRelationMap(afterFen);
  return (
    symmetricDiff(new Set(before.controlledByWhite), new Set(after.controlledByWhite)) +
    symmetricDiff(new Set(before.controlledByBlack), new Set(after.controlledByBlack))
  );
}

function symmetricDiff(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (!b.has(x)) n++;
  for (const x of b) if (!a.has(x)) n++;
  return n;
}

function bestSeeWinForSide(fen: string, color: Color): number {
  const chess = new Chess(turnFen(fen, color));
  let best = 0;
  for (const m of chess.moves({ verbose: true }) as Array<{ from: Square; to: Square; flags: string }>) {
    if (!(m.flags.includes('c') || m.flags.includes('e'))) continue;
    best = Math.max(best, seeCapture(turnFen(fen, color), m.from, m.to));
  }
  return best;
}

function poisonedForSide(fen: string, color: Color): number {
  return findPoisonedCaptures(turnFen(fen, color)).length;
}

function playedCaptureValue(fen: string, san: string): number | null {
  const chess = new Chess(fen);
  const moved = chess.move(san);
  if (!moved || !(moved.flags.includes('c') || moved.flags.includes('e'))) return null;
  return seeCapture(fen, moved.from, moved.to);
}

function phaseOf(fen: string): Phase {
  const board = parseFen(fen);
  const moveNo = Number(fen.trim().split(/\s+/)[5] ?? 1);
  const material = allPieces(board)
    .filter((p) => p.type !== 'k')
    .reduce((sum, p) => sum + PIECE_VALUE[p.type], 0);
  if (moveNo <= 10) return 'opening';
  if (material <= 24) return 'endgame';
  return 'middlegame';
}

function countMotifs(types: MotifType[]): Partial<Record<MotifType, number>> {
  const out: Partial<Record<MotifType, number>> = {};
  for (const t of types) out[t] = (out[t] ?? 0) + 1;
  return out;
}

function addCounts<T extends string>(target: Partial<Record<T, number>>, src: Partial<Record<T, number>>) {
  for (const [k, v] of Object.entries(src) as [T, number][]) target[k] = (target[k] ?? 0) + v;
}

function sumCounts(counts: Partial<Record<string, number>>): number {
  return Object.values(counts).reduce<number>((s, n) => s + (n ?? 0), 0);
}

function isForcing(san: string): boolean {
  return san.includes('x') || san.includes('+') || san.includes('#');
}

function onlyDefenderMoved(fenBefore: string, fenAfter: string, san: string, mover: Color): boolean {
  const chess = new Chess(fenBefore);
  const moved = chess.move(san);
  if (!moved) return false;
  const movedIdPrefix = `${mover}${(pieceAt(parseFen(fenBefore), moved.from)?.type ?? '').toUpperCase()}${moved.from}`;
  const before = buildRelationMap(fenBefore);
  const after = buildRelationMap(fenAfter);
  for (const [sq, b] of Object.entries(before.bySquare)) {
    if (b.piece[0] !== mover || b.defendedBy.length !== 1 || b.defendedBy[0] !== movedIdPrefix) continue;
    const a = after.bySquare[sq];
    if (a && a.piece[0] === mover && a.defendedBy.length === 0 && a.attackedBy.length > 0) return true;
  }
  return false;
}

function hangingSquares(fen: string, color: Color): Square[] {
  return allPieces(parseFen(fen))
    .filter((p) => p.color === color && seeOnSquare(fen, p.square).swing > 0)
    .map((p) => p.square);
}

function badgesFor(
  mover: Color,
  before: LegalFeatureSummary,
  after: LegalFeatureSummary,
  defenseAfter: DefenseFeatureSummary,
  see: SeeFeatureSummary,
  motifs: MotifFeatureSummary,
): string[] {
  const motif = Object.entries(motifs.availableBefore)[0];
  return [
    `Mobility ${signed(after.total - before.total)}`,
    `Safe moves ${signed(after.safe - before.safe)}`,
    `King escapes ${after.kingEscapes}`,
    `Loose pieces ${defenseAfter.loosePieces[mover]}`,
    `Best SEE +${see.bestWin[mover]}`,
    motif ? `Motif ${motif[0].replace(/_/g, ' ')}` : 'Motif none',
  ];
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function collectLoosePieces(fen: string, mover: Color, out: Record<string, number>) {
  for (const p of allPieces(parseFen(fen))) {
    if (p.color !== mover) continue;
    if (seeOnSquare(fen, p.square).swing <= 0) continue;
    const key = `${mover}${p.type.toUpperCase()}`;
    out[key] = (out[key] ?? 0) + 1;
  }
}

function patternCopy(type: PatternType, count: number): { title: string; detail: string } {
  switch (type) {
    case 'loose_piece_habit':
      return { title: 'Loose material', detail: `${count} moves left valuable pieces exposed.` };
    case 'only_defender_moved':
      return { title: 'Only defender moved', detail: `${count} moves abandoned the last defender.` };
    case 'missed_forcing_move':
      return { title: 'Missed forcing moves', detail: `${count} moves passed over checks, captures, or motifs.` };
    case 'king_safety_collapse':
      return { title: 'King safety pressure', detail: `${count} moves left the king short on space.` };
    case 'bad_capture':
      return { title: 'Bad captures', detail: `${count} captures were SEE-losing.` };
    case 'walked_into_motif':
      return { title: 'Walked into tactics', detail: `${count} moves allowed a validated motif.` };
    case 'missed_free_material':
      return { title: 'Missed free material', detail: `${count} moves skipped a clean SEE win.` };
    case 'pawn_structure_damage':
      return { title: 'Pawn structure damage', detail: `${count} moves worsened pawn or shelter facts.` };
  }
}

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
