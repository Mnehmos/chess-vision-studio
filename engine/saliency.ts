// [6] Saliency ranker (CROWN JEWEL). §5 Steps B–D.
//
// The eval swing is the ORACLE for "did this move matter and by how much"
// (Invariant 4). It is NOT weight #3 of 7 — it sets the BUDGET (the gate), and
// the other channels only ATTRIBUTE that swing. We never sum differently-scaled
// raw quantities into a magic score. Saliency ranks among VALIDATED candidates;
// it is never a substitute for validation (Invariant 7).
import { Chess } from 'chess.js';
import { parseFen } from './board';
import { computeCpLoss, classify } from './classify';
import { diffPlayedMove, diffRefutation, pvRefutation } from './diff';
import {
  detectAvailableMotifs,
  findRemovalOfGuard,
  findDiscoveredCheck,
} from './motif';
import { renderInsight } from './explain';
import { buildMateProof } from './mateproof';
import type { Eval, InsightCandidate, MateProof, Motif, MoveAnalysis } from './types';

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
  defender_left: 35,
  now_defended: 20,
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

/** Hard board events that must never be summarized as "nothing changed", even at a
 *  zero eval swing: a promotion, a check, or a mate. Returns the event names found. */
function hardEvents(san: string, fenAfter: string): string[] {
  const ev: string[] = [];
  if (san.includes('=')) ev.push('promotion');
  if (san.includes('#')) ev.push('checkmate');
  else if (san.includes('+') || inCheckSafe(fenAfter)) ev.push('check');
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

  // Terminal position: if the played move DELIVERS checkmate it is the best
  // possible move — never a blunder, and you did not "miss" any other mate.
  // (Stockfish returns no eval for a mated position, which would otherwise make
  // cpLoss look like the whole mate was thrown away.)
  const deliveredMate = isCheckmate(fenAfter);
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
    };
  }

  // §5 Step B — the gate. Small swing → nothing salient → say nothing... UNLESS the
  // move is a hard board event (promotion / check / mate): those are never "nothing",
  // even when the evaluation is flat (e.g. promoting-with-check while already winning).
  if (cpLoss < GATE) {
    const events = hardEvents(san, fenAfter);
    if (events.length === 0) {
      return {
        ...base,
        rankedInsights: [],
        topExplanation: 'Solid move — nothing important changed.',
      };
    }
    return {
      ...base,
      rankedInsights: [],
      topExplanation: `${move} — ${events.join(' + ')}; the evaluation is unchanged.`,
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

  return { ...base, rankedInsights: ranked, topExplanation };
}

// Below this, an insight is treated as not explaining the move (saliency-0 trivia).
const SALIENT_MIN = 0.05;
