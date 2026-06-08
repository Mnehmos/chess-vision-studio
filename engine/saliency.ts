// [6] Saliency ranker (CROWN JEWEL). §5 Steps B–D.
//
// The eval swing is the ORACLE for "did this move matter and by how much"
// (Invariant 4). It is NOT weight #3 of 7 — it sets the BUDGET (the gate), and
// the other channels only ATTRIBUTE that swing. We never sum differently-scaled
// raw quantities into a magic score. Saliency ranks among VALIDATED candidates;
// it is never a substitute for validation (Invariant 7).
import { Chess } from 'chess.js';
import { allPieces, parseFen, type Color } from './board';
import { computeCpLoss, classify } from './classify';
import { diffPlayedMove, diffRefutation, pvRefutation } from './diff';
import { seeCapture } from './see';
import {
  detectAvailableMotifs,
  findRemovalOfGuard,
  findDiscoveredCheck,
} from './motif';
import { renderInsight } from './explain';
import { buildMateProof } from './mateproof';
import {
  defenseSummary,
  legalSummaryForSide,
  pawnSummary,
  phaseOf,
  threatSummary,
} from './features';
import type {
  ChangedRelation,
  ChangeType,
  Eval,
  ExplanationConfidence,
  InsightCandidate,
  MateProof,
  Motif,
  MoveAnalysis,
  Square,
} from './types';

export interface AnalyzeInput {
  fenBefore: string;
  fenAfter: string;
  san: string; // the move played, e.g. 'Qxg4'
  evalBefore: Eval; // best-move eval at positionBefore (mover's POV)
  evalAfter: Eval; // eval at positionAfter (opponent's POV)
}

// §5 Step D weights. Tunable against the fixtures; sum to 1 so saliency ∈ [0,1].
const W = { material: 0.4, king: 0.25, forcing: 0.2, motif: 0.15 } as const;

const GATE = 0.3; // §5 Step B — below this, say nothing.

/**
 * Type-priority prior (§5 Step D) — orders by what wins games at 300–1400.
 * ONLY a tiebreaker among already-validated candidates; never an additive term.
 */
const TYPE_PRIORITY: Record<string, number> = {
  mate_threat: 100,
  check_created: 80,
  now_see_losing: 70,
  now_undefended: 50,
  piece_captured: 40,
  defender_left: 23,
  king_safety_weakened: 34,
  defense_improved: 29,
  now_attacked: 30, // a NEW threat outranks a consolidation — never let "now defended" win a tie
  mobility_improved: 28,
  center_control_gained: 26,
  development_improved: 24,
  king_safety_improved: 22,
  now_defended: 20,
  pawn_structure_weakened: 19,
  line_opened: 18,
  line_closed: 16,
  escape_squares_changed: 15,
};

function isForcingInsight(c: InsightCandidate): boolean {
  if (c.kind === 'motif') return true;
  return c.type === 'check_created' || c.type === 'mate_threat' || c.materialSwing > 0;
}

/** Derive saliency for one candidate by ATTRIBUTING the eval-measured cpLoss. */
function scoreCandidate(c: InsightCandidate, cpLoss: number): number {
  const materialScore = cpLoss > 0 ? clamp(Math.abs(c.materialSwing) / cpLoss, 0, 1) : 0;
  const kingScore = clamp(c.kingSafetyDelta, 0, 1);
  const forcingScore = c.inPV ? (isForcingInsight(c) ? 1.0 : 0.5) : 0;
  const motifScore = c.kind === 'motif' ? 1.0 : 0; // a PROVEN tactic is the headline
  return (
    W.material * materialScore +
    W.king * kingScore +
    W.forcing * forcingScore +
    W.motif * motifScore
  );
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Forks + mates only — the tactics that directly explain a loss or a miss. */
function actionableMotifs(fen: string): Motif[] {
  return detectAvailableMotifs(fen).motifs.filter(
    (m) => m.type === 'fork' || m.type === 'mating_net' || m.type === 'back_rank',
  );
}

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const sideName = (c: Color): 'white' | 'black' => (c === 'w' ? 'white' : 'black');

let ladderCounter = 0;
function ladderId(type: ChangeType): string {
  ladderCounter += 1;
  return `ladder-${type}-${ladderCounter}`;
}

function ladderRelation(over: {
  type: ChangeType;
  side: 'white' | 'black';
  squares: Square[];
  arrows?: [Square, Square][];
  kingSafetyDelta?: number;
  evidence: string[];
}): ChangedRelation {
  return {
    id: ladderId(over.type),
    kind: 'changed_relation',
    type: over.type,
    side: over.side,
    squares: over.squares,
    arrows: over.arrows ?? [],
    source: 'played_move',
    materialSwing: 0,
    kingSafetyDelta: over.kingSafetyDelta ?? 0,
    inPV: false,
    saliency: 0,
    templateId: over.type,
    evidence: over.evidence,
  };
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function centerCount(t: ReturnType<typeof threatSummary>, side: Color): number {
  return side === 'w' ? t.centerWhite : t.centerBlack;
}

function kingPressure(t: ReturnType<typeof threatSummary>, side: Color): number {
  return side === 'w' ? t.whiteKingPressure : t.blackKingPressure;
}

function defenseLoad(d: ReturnType<typeof defenseSummary>, side: Color): number {
  return d.loosePieces[side] + d.undefendedHighValue[side] + d.hangingPieces[side] + d.hangingValue[side];
}

function pawnWeakness(p: ReturnType<typeof pawnSummary>, side: Color): number {
  return p.isolated[side] + p.doubled[side] + p.kingShieldMissing[side];
}

function kingSquare(fen: string, side: Color): Square | null {
  const board = safe(() => parseFen(fen));
  return board ? (allPieces(board).find((p) => p.color === side && p.type === 'k')?.square ?? null) : null;
}

function playedMoveInfo(fenBefore: string, san: string): {
  from: Square;
  to: Square;
  piece: string;
  flags: string;
  san: string;
} | null {
  return safe(() => {
    const moved = new Chess(fenBefore).move(san);
    return moved
      ? {
          from: moved.from,
          to: moved.to,
          piece: moved.piece,
          flags: moved.flags,
          san: moved.san,
        }
      : null;
  });
}

function isDevelopmentMove(fenBefore: string, side: Color, move: ReturnType<typeof playedMoveInfo>): boolean {
  if (!move) return false;
  if (move.san === 'O-O' || move.san === 'O-O-O') return true;
  if (move.piece !== 'n' && move.piece !== 'b') return false;
  if (phaseOf(fenBefore) !== 'opening') return false;
  const homeRank = side === 'w' ? '1' : '8';
  return move.from[1] === homeRank && move.to[1] !== homeRank;
}

function insightLadderCandidates(fenBefore: string, fenAfter: string, san: string): ChangedRelation[] {
  const before = safe(() => parseFen(fenBefore));
  if (!before) return [];
  const mover = before.turn;
  const opponent = other(mover);
  const side = sideName(mover);
  const out: ChangedRelation[] = [];
  const moved = playedMoveInfo(fenBefore, san);

  if (moved && isDevelopmentMove(fenBefore, mover, moved)) {
    out.push(
      ladderRelation({
        type: 'development_improved',
        side,
        squares: [moved.to],
        arrows: [[moved.from, moved.to]],
        evidence: [`${mover}${moved.piece.toUpperCase()} from ${moved.from} to ${moved.to}`],
      }),
    );
  }

  const threatsBefore = safe(() => threatSummary(fenBefore));
  const threatsAfter = safe(() => threatSummary(fenAfter));
  if (threatsBefore && threatsAfter) {
    const centerDelta = centerCount(threatsAfter, mover) - centerCount(threatsBefore, mover);
    const opponentCenterDelta = centerCount(threatsAfter, opponent) - centerCount(threatsBefore, opponent);
    if (centerDelta > 0 && centerDelta >= opponentCenterDelta) {
      out.push(
        ladderRelation({
          type: 'center_control_gained',
          side,
          squares: moved ? [moved.to] : [],
          evidence: [`center control ${centerCount(threatsBefore, mover)}->${centerCount(threatsAfter, mover)}`],
        }),
      );
    }

    const beforePressure = kingPressure(threatsBefore, mover);
    const afterPressure = kingPressure(threatsAfter, mover);
    const pressureDelta = afterPressure - beforePressure;
    const ksq = kingSquare(fenAfter, mover);
    if (pressureDelta >= 2 && ksq) {
      out.push(
        ladderRelation({
          type: 'king_safety_weakened',
          side,
          squares: [ksq],
          kingSafetyDelta: clamp(pressureDelta / 4, 0.25, 1),
          evidence: [`king pressure ${beforePressure}->${afterPressure}`],
        }),
      );
    } else if (pressureDelta <= -2 && ksq) {
      out.push(
        ladderRelation({
          type: 'king_safety_improved',
          side,
          squares: [ksq],
          kingSafetyDelta: clamp(Math.abs(pressureDelta) / 6, 0.1, 0.5),
          evidence: [`king pressure ${beforePressure}->${afterPressure}`],
        }),
      );
    }
  }

  const moverLegalBefore = safe(() => legalSummaryForSide(fenBefore, mover));
  const moverLegalAfter = safe(() => legalSummaryForSide(fenAfter, mover));
  if (moverLegalBefore && moverLegalAfter) {
    const safeDelta = moverLegalAfter.safe - moverLegalBefore.safe;
    if (safeDelta >= 3) {
      out.push(
        ladderRelation({
          type: 'mobility_improved',
          side,
          squares: moved ? [moved.to] : [],
          evidence: [`safe moves ${moverLegalBefore.safe}->${moverLegalAfter.safe}`],
        }),
      );
    }
  }

  const defenseBefore = safe(() => defenseSummary(fenBefore));
  const defenseAfter = safe(() => defenseSummary(fenAfter));
  if (defenseBefore && defenseAfter) {
    const beforeLoad = defenseLoad(defenseBefore, mover);
    const afterLoad = defenseLoad(defenseAfter, mover);
    if (beforeLoad - afterLoad >= 2) {
      out.push(
        ladderRelation({
          type: 'defense_improved',
          side,
          squares: moved ? [moved.to] : [],
          evidence: [`piece-safety load ${beforeLoad}->${afterLoad}`],
        }),
      );
    }
  }

  const pawnsBefore = safe(() => pawnSummary(fenBefore));
  const pawnsAfter = safe(() => pawnSummary(fenAfter));
  if (pawnsBefore && pawnsAfter) {
    const beforeWeakness = pawnWeakness(pawnsBefore, mover);
    const afterWeakness = pawnWeakness(pawnsAfter, mover);
    if (afterWeakness - beforeWeakness >= 2) {
      out.push(
        ladderRelation({
          type: 'pawn_structure_weakened',
          side,
          squares: moved ? [moved.to] : [],
          evidence: [`pawn weakness ${beforeWeakness}->${afterWeakness}`],
        }),
      );
    }
  }

  return out;
}

function priorityOf(c: InsightCandidate): number {
  return TYPE_PRIORITY[c.type] ?? 0;
}

function isCheckmate(fen: string): boolean {
  try {
    return new Chess(fen).isCheckmate();
  } catch {
    return false;
  }
}

function inCheckSafe(fen: string): boolean {
  try {
    return new Chess(fen).inCheck();
  } catch {
    return false;
  }
}

/** True when the side to move has exactly one legal move (a forced reply). */
function onlyLegalMove(fen: string): boolean {
  try {
    return new Chess(fen).moves().length === 1;
  } catch {
    return false;
  }
}

/** Hard board events that must never be summarized as "nothing changed", even at a
 *  zero eval swing: a promotion, a check, or a mate. Returns the event names found. */
function hardEvents(fenBefore: string, fenAfter: string, san: string): string[] {
  const ev: string[] = [];
  if (san.includes('=')) ev.push('promotion');
  if (san.includes('#')) ev.push('checkmate');
  else if (san.includes('+') || inCheckSafe(fenAfter)) ev.push('check');
  // A capture is a hard event UNLESS it's an even trade (SEE swing 0): a routine
  // recapture stays quiet, but a material-changing capture is never "nothing changed".
  // (We deliberately do NOT add board heuristics like king-zone pressure here — the
  // eval is the oracle; only objective board events override its silence.)
  if (san.includes('x')) {
    try {
      const m = new Chess(fenBefore).move(san);
      if (m && (m.flags.includes('c') || m.flags.includes('e')) && seeCapture(fenBefore, m.from, m.to) !== 0) {
        ev.push('capture');
      }
    } catch {
      /* malformed FEN/SAN — skip */
    }
  }
  return ev;
}

/** A capture claim ("reply X wins material on Y") is only kept if X is a LEGAL
 *  capture landing on Y in the ACTUAL after-position — never a future-PV square
 *  (Invariant 7: validated facts only; never assert a capture on an empty square). */
function legalCaptureClaim(fenAfter: string, c: InsightCandidate): boolean {
  if (c.kind !== 'changed_relation' || c.templateId !== 'refutation_wins_material') return true;
  const to = c.squares[0];
  const from = c.arrows[0]?.[0];
  if (!to || !from) return false;
  try {
    const moves = new Chess(fenAfter).moves({ verbose: true }) as Array<{
      from: string;
      to: string;
      flags: string;
    }>;
    return moves.some((m) => m.from === from && m.to === to && (m.flags.includes('c') || m.flags.includes('e')));
  } catch {
    return false;
  }
}

function formatMove(fenBefore: string, san: string): string {
  const pos = parseFen(fenBefore);
  const moveNumber = parseInt(fenBefore.trim().split(/\s+/)[5] ?? '1', 10);
  return pos.turn === 'w' ? `${moveNumber}. ${san}` : `${moveNumber}... ${san}`;
}

/** Phase-aware neutral copy for a quiet, sub-gate move (replaces the old, too-absolute
 *  "nothing important changed"). It names the KIND of move and that no tactic fired —
 *  honest and still a steer for a 300–1400 player. */
function neutralFallback(fenBefore: string): string {
  switch (phaseOf(fenBefore)) {
    case 'opening':
      return 'Opening move: improves development or central control. No immediate tactic detected.';
    case 'endgame':
      return 'Endgame move: no immediate tactic detected. Check pawn races, king activity, and rook activity.';
    default:
      return 'No forcing tactic found. The move changes piece activity and defensive relationships.';
  }
}

/**
 * The central seam producer. PURE: evals are injected (the engine is called by
 * a higher-level orchestrator), so the discriminating saliency tests are
 * deterministic, not engine-noise-dependent (Invariant 9 / testing strategy).
 *
 * `extraCandidates` lets M5 feed in VALIDATED motifs without rebuilding the
 * ranker (§ milestone note: "extend the ranker with motifScore, don't rebuild").
 */
export function analyzeMove(
  input: AnalyzeInput,
  extraCandidates: InsightCandidate[] = [],
): MoveAnalysis {
  const { fenBefore, fenAfter, san, evalBefore, evalAfter } = input;
  const move = formatMove(fenBefore, san);
  const positionId = `${fenAfter}|${san}`; // artifact identity — consumers gate on it

  // Terminal position: if the played move DELIVERS checkmate it is the best
  // possible move — never a blunder, and you did not "miss" any other mate.
  // (Stockfish returns no eval for a mated position, which would otherwise make
  // cpLoss look like the whole mate was thrown away.)
  const deliveredMate = isCheckmate(fenAfter);

  // The engine genuinely failed to evaluate (timeout / no usable line). A missing eval
  // must NEVER collapse to cpLoss 0 → 'best' → "Solid move" (fake confidence). Report
  // it honestly as 'unclassified' so the UI can distinguish "unknown" from "equal".
  if (!deliveredMate && (evalBefore.status === 'unavailable' || evalAfter.status === 'unavailable')) {
    return {
      positionId,
      positionBefore: fenBefore,
      positionAfter: fenAfter,
      move,
      classification: 'unclassified',
      evalBefore,
      evalAfter,
      cpLoss: 0,
      rankedInsights: [],
      topExplanation: `${move} — analysis unavailable (the engine did not return an evaluation).`,
      confidence: 'low_salience_fallback',
    };
  }

  const cpLoss = deliveredMate ? 0 : computeCpLoss(evalBefore, evalAfter);
  const classification = deliveredMate ? 'best' : classify(cpLoss);

  // Mate proof: when the side to move at positionAfter forces mate, the oracle
  // (Stockfish mate score) gives the line; the evaluator explains it in
  // obligation terms (mating piece, checking line, collapsing king escapes).
  let mateProof: MateProof | undefined;
  if (evalAfter.mate !== undefined && evalAfter.mate > 0 && (evalAfter.pv?.length ?? 0) > 0) {
    mateProof = buildMateProof(fenAfter, evalAfter.pv, evalAfter.mate) ?? undefined;
  }

  const base: Omit<MoveAnalysis, 'rankedInsights' | 'topExplanation'> = {
    positionId,
    positionBefore: fenBefore,
    positionAfter: fenAfter,
    move,
    classification,
    evalBefore,
    evalAfter,
    cpLoss,
    mateProof,
  };

  if (deliveredMate) {
    return {
      ...base,
      rankedInsights: [],
      topExplanation: `Checkmate — ${san} ends the game.`,
      confidence: 'certain_tactical',
    };
  }

  // §5 Step B — the gate. Small swing → nothing salient → say nothing... UNLESS the
  // move is a hard board event (promotion / check / mate / capture), the position has a
  // forced mate on it, or the move is forced (the only legal reply). A flat eval does
  // NOT mean "nothing changed" when mate is unavoidable or the move was forced.
  if (cpLoss < GATE) {
    const mover = (() => {
      try {
        return parseFen(fenBefore).turn;
      } catch {
        return 'w' as const;
      }
    })();
    const moverName = mover === 'w' ? 'White' : 'Black';
    const opponentName = mover === 'w' ? 'Black' : 'White';
    const forced = onlyLegalMove(fenBefore);
    const events = hardEvents(fenBefore, fenAfter, san);

    // The opponent has a forced mate after this move → the move is losing by force,
    // however "best" it scores. Never call this uneventful (the 17.Re1 case).
    if (evalAfter.mate !== undefined && evalAfter.mate > 0) {
      return {
        ...base,
        rankedInsights: [],
        topExplanation: `${move}${forced ? ' is forced' : ''} — but ${opponentName} still has a forced mate (mate in ${evalAfter.mate}).`,
        confidence: 'certain_tactical',
      };
    }
    // The mover is the one delivering a forced mate — keep that front and centre.
    if (evalBefore.mate !== undefined && evalBefore.mate > 0) {
      return {
        ...base,
        rankedInsights: [],
        topExplanation: `${move}${events.length ? ` — ${events.join(' + ')}` : ''}; ${moverName} has a forced mate (mate in ${evalBefore.mate}).`,
        confidence: 'certain_tactical',
      };
    }
    if (events.length === 0 && !forced) {
      // A quiet, low-stakes move. Don't claim "nothing changed" (too absolute, and a
      // 300–1400 player still wants a steer): give a phase-aware neutral frame that
      // says what KIND of move it is and that no tactic was detected.
      return {
        ...base,
        rankedInsights: [],
        topExplanation: neutralFallback(fenBefore),
        confidence: 'low_salience_fallback',
      };
    }
    const parts = [...events, ...(forced ? ['only legal move'] : [])];
    return {
      ...base,
      rankedInsights: [],
      topExplanation: `${move} — ${parts.join(' + ')}; the evaluation is unchanged.`,
      confidence: 'semantic_overlay',
    };
  }

  // §5 Step C — candidate generation (VALIDATED facts only, Invariant 7).
  const refutation = diffRefutation(fenAfter, evalAfter);

  // Validated motifs (§4a) — the motif layer extends the ranker via motifScore;
  // these are PROVEN (geometry / SEE / checkmate), never raw proposals. Only
  // ACTIONABLE tactics (forks, mates) are injected as loss/miss insights; static
  // pins & skewers belong to the Tactics MODE (M7), not the cpLoss attribution.
  const pvFirst = evalAfter.pv?.[0];
  const refutationMotifs: Motif[] = actionableMotifs(fenAfter).map((m) => ({
    ...m,
    source: 'refutation',
    inPV: pvFirst !== undefined && m.line[0] === pvFirst,
  }));
  const playedMotifs: Motif[] = [
    ...findRemovalOfGuard(fenBefore, fenAfter).motifs,
    ...findDiscoveredCheck(fenBefore, fenAfter).motifs,
  ].map((m) => ({ ...m, source: 'played_move', inPV: false }));
  // Missed tactics the mover passed up (anything but the move actually played).
  const missedMotifs: Motif[] = actionableMotifs(fenBefore)
    .filter((m) => m.line[0] !== san)
    .map((m) => ({ ...m, source: 'available', inPV: false }));

  const motifs = [...refutationMotifs, ...playedMotifs, ...missedMotifs];
  const ladder = insightLadderCandidates(fenBefore, fenAfter, san);
  const motifSquares = new Set(motifs.flatMap((m) => m.squares));
  const refutedSquares = new Set(refutation.flatMap((r) => r.squares));

  const played = diffPlayedMove(fenBefore, fenAfter).filter(
    // A refutation or a proven motif subsumes a bare diff on the same square —
    // don't double-count the same fact in two forms.
    (c) => !c.squares.some((s) => refutedSquares.has(s) || motifSquares.has(s)),
  );

  const rawCandidates: InsightCandidate[] = [
    ...refutation,
    ...motifs,
    ...ladder,
    ...played,
    ...extraCandidates,
  ];

  // Invariant 4 — the eval swing is the BUDGET/oracle. No insight may claim more
  // material than the eval supports. This rejects isolated-SEE over-claims (a
  // "wins a rook" refutation when cpLoss is only ~1: the eval already accounts for
  // the recapture/compensation downstream). Forced mates carry it via king-safety,
  // not materialSwing, so they pass.
  const materialBudget = cpLoss + 1.5;
  const candidates = rawCandidates
    .filter((c) => Math.abs(c.materialSwing) <= materialBudget)
    // Drop any capture claim that isn't a legal capture on the displayed board.
    .filter((c) => legalCaptureClaim(fenAfter, c));

  // §5 Step D — attribute & rank.
  for (const c of candidates) c.saliency = scoreCandidate(c, cpLoss);
  candidates.sort((a, b) => {
    if (Math.abs(b.saliency - a.saliency) > 1e-6) return b.saliency - a.saliency;
    return priorityOf(b) - priorityOf(a); // type-priority prior as tiebreaker
  });

  // Refutation hierarchy (Invariant 5):
  //   1. forced mate proof  2. clean tactical refutation  3. PV refutation fallback
  //   4. highest-saliency relationship diff   5. nothing important changed.
  // A move that is a real mistake by eval but whose top validated insight is
  // saliency-0 means no named detector explains the loss — its punishment is quiet
  // (interference, overload, king-safety proof failure). Headline the ORACLE's line
  // honestly instead of letting saliency-0 trivia ("A6 is now defended") headline a
  // blunder. The literal facts STAY in the list; only the headline changes.
  const realMistake =
    classification === 'inaccuracy' || classification === 'mistake' || classification === 'blunder';
  const topSaliency = candidates[0]?.saliency ?? 0;
  let ranked: InsightCandidate[] = candidates;
  if (realMistake && topSaliency < SALIENT_MIN) {
    const pvref = pvRefutation(fenAfter, evalAfter, cpLoss);
    if (pvref) {
      pvref.saliency = 0.9; // oracle-derived; injected AFTER the material-budget filter
      ranked = [pvref, ...candidates];
    }
  }

  const headlinesSomething = (ranked[0]?.saliency ?? 0) >= SALIENT_MIN;
  const topExplanation = headlinesSomething
    ? renderInsight(ranked[0])
    : realMistake
      ? `${move} — ${classification} (−${cpLoss.toFixed(1)}); no named tactic found, oracle line unavailable.`
      : ranked.length
        ? renderInsight(ranked[0])
        : `${move} — ${classification}.`;

  return {
    ...base,
    rankedInsights: ranked,
    topExplanation,
    confidence: explanationConfidence(ranked[0], headlinesSomething),
  };
}

// Below this, an insight is treated as not explaining the move (saliency-0 trivia).
const SALIENT_MIN = 0.05;

/**
 * How strongly the headline is backed (the salience-honesty signal). A generic
 * relation delta that only headlines because nothing better existed is
 * 'low_salience_fallback'; a proven tactic is 'certain_tactical'. Consumers use
 * this to avoid sounding decisive when they are merely describing a board fact.
 */
function explanationConfidence(
  top: InsightCandidate | undefined,
  headlinesSomething: boolean,
): ExplanationConfidence {
  if (!top || !headlinesSomething) return 'low_salience_fallback';
  if (top.kind === 'motif') return 'certain_tactical'; // geometry/SEE/mate-proven
  if (top.type === 'mate_threat') return 'certain_tactical';
  if (
    top.type === 'pv_refutation' ||
    top.type === 'forcing_check_resource' ||
    top.type === 'perpetual_check' ||
    top.templateId === 'refutation_wins_material'
  ) {
    return 'engine_pv'; // the oracle's line, not a named/geometry tactic
  }
  if (top.materialSwing > 0 || top.kingSafetyDelta > 0) return 'semantic_overlay';
  return 'low_salience_fallback';
}
