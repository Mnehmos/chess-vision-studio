import type { ExplanationPlan, MotifOpportunity, PieceRef, StructureDelta } from './types';
import { filesOf } from './evidence';

const PIECE_VALUE_CP: Record<string, number> = {
  pawn: 100,
  knight: 300,
  bishop: 300,
  rook: 500,
  queen: 900,
  king: 0,
};

function pieceLabel(ref: PieceRef): string {
  return `the ${ref.pieceType} on ${ref.square}`;
}

function targetList(targets: PieceRef[]): string {
  const labels = targets.map(pieceLabel);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

// The most valuable non-king target — the piece a king-fork actually wins.
function bestWinnableTarget(fork: MotifOpportunity): PieceRef | undefined {
  const nonKing = fork.targets.filter((t) => t.pieceType !== 'king');
  if (nonKing.length === 0) return undefined;
  return nonKing.reduce((best, t) =>
    (PIECE_VALUE_CP[t.pieceType] ?? 0) > (PIECE_VALUE_CP[best.pieceType] ?? 0) ? t : best,
  );
}

function capitalize(s: string): string {
  return s.length ? (s[0]?.toUpperCase() ?? '') + s.slice(1) : s;
}

// Render the Allowed Fork plan (plan §11 example). Every clause is evidence-gated:
// targets are named from the validated fork's PieceRefs; the consequence only names
// the won piece when one exists; the correction only appears when best avoids it.
export function renderAllowedFork(params: {
  playedLabel: string;
  bestLabel?: string;
  fork: MotifOpportunity;
  opponentName: string;
}): ExplanationPlan {
  const { fork, opponentName } = params;
  const plan: ExplanationPlan = {
    topic: 'Allowed Fork',
    headline: `${params.playedLabel} allowed a ${fork.forkingPiece.pieceType} fork.`,
    cause: `${capitalize(fork.forkingPiece.pieceType)} to ${fork.forkingPiece.square} attacks ${targetList(
      fork.targets,
    )}.`,
  };
  const won = bestWinnableTarget(fork);
  if (fork.kingTarget && won) {
    plan.consequence = `${opponentName} gives check, so ${pieceLabel(won)} cannot be saved.`;
  } else if (won) {
    plan.consequence = `${opponentName} wins ${pieceLabel(won)}.`;
  }
  if (params.bestLabel) {
    plan.correction = `${params.bestLabel} prevents the fork.`;
  }
  return plan;
}

// Render the Missed Hanging Piece plan: what was missed, why it was free, and the
// winning capture. Cause names "undefended" only when the piece truly has no
// defender; the correction names the capture only when a best move is known.
export function renderMissedHangingPiece(params: {
  playedLabel: string;
  bestLabel?: string;
  pieceType: string;
  square: string;
  undefended: boolean;
}): ExplanationPlan {
  const plan: ExplanationPlan = {
    topic: 'Missed Hanging Piece',
    headline: `${params.playedLabel} missed a free ${params.pieceType}.`,
    cause: params.undefended
      ? `The ${params.pieceType} on ${params.square} is undefended.`
      : `The ${params.pieceType} on ${params.square} can be won for material.`,
  };
  if (params.bestLabel) {
    plan.correction = `${params.bestLabel} wins the ${params.pieceType}.`;
  }
  return plan;
}

// Render the Failed Defense plan: a pre-existing threat the move left unanswered,
// the punishing reply, and the defense that was available.
export function renderFailedDefense(params: {
  playedLabel: string;
  bestLabel?: string;
  refutationLabel: string;
  pieceType: string;
  square: string;
  opponentName: string;
}): ExplanationPlan {
  const plan: ExplanationPlan = {
    topic: 'Failed Defense',
    headline: `${params.playedLabel} left the ${params.pieceType} on ${params.square} hanging.`,
    cause: `${params.opponentName} answers with ${params.refutationLabel}, winning the ${params.pieceType}.`,
  };
  if (params.bestLabel) {
    plan.correction = `${params.bestLabel} saves the ${params.pieceType}.`;
  }
  return plan;
}

export type PawnDamageMode = 'causally_supported' | 'accepted_tradeoff' | 'descriptive';

function listSquares(sqs: string[]): string {
  if (sqs.length === 0) return '';
  if (sqs.length === 1) return sqs[0] ?? '';
  if (sqs.length === 2) return `${sqs[0]} and ${sqs[1]}`;
  return `${sqs.slice(0, -1).join(', ')}, and ${sqs[sqs.length - 1]}`;
}

// Build the cause clause from the ACTUAL damaging deltas — names exact pawns and
// files, never a generic "structure damage" unless the deltas are empty.
function damagePhrase(damage: StructureDelta[]): string {
  const phrases: string[] = [];
  const doubled = damage.filter((d) => d.kind === 'doubled_pawns');
  const isolated = damage.filter((d) => d.kind === 'isolated_pawn');
  for (const d of doubled) {
    const file = filesOf(d.squares)[0] ?? '?';
    phrases.push(`doubles the ${file}-pawns (${d.squares.join(', ')})`);
  }
  if (isolated.length) {
    const sqs = [...new Set(isolated.flatMap((d) => d.squares))].sort();
    phrases.push(`leaves ${listSquares(sqs)} isolated`);
  }
  if (phrases.length === 0) return 'damages the pawn structure';
  if (phrases.length === 1) return phrases[0] ?? 'damages the pawn structure';
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
}

function pawnHeadline(damage: StructureDelta[]): string {
  const hasDoubled = damage.some((d) => d.kind === 'doubled_pawns');
  const hasIsolated = damage.some((d) => d.kind === 'isolated_pawn');
  if (hasDoubled && hasIsolated) return 'Doubled and isolated pawns';
  if (hasDoubled) return 'Doubled pawns';
  if (hasIsolated) return 'Isolated pawn';
  return 'Pawn structure change';
}

// Render the deterministic ExplanationPlan. Clauses are gated by evidence
// (plan §11): correction only when a best counterfactual avoids the weakness;
// caveat only on accepted tradeoff. No clause claims material causation — the
// only causal backing is the engine's grade, surfaced honestly.
export function renderPawnStructureDamage(params: {
  mode: PawnDamageMode;
  playedLabel: string;
  bestLabel?: string;
  damage: StructureDelta[];
  classification: string;
  winsMaterial: boolean;
}): ExplanationPlan {
  const plan: ExplanationPlan = {
    topic: 'Pawn Structure Damage',
    headline: pawnHeadline(params.damage),
    cause: `${params.playedLabel} ${damagePhrase(params.damage)}.`,
  };

  if (params.mode === 'causally_supported' && params.bestLabel) {
    plan.consequence = `The engine grades this a ${params.classification}; ${params.bestLabel} is preferred.`;
    plan.correction = `${params.bestLabel} keeps the pawns healthy and avoids the weakness.`;
  } else if (params.mode === 'accepted_tradeoff') {
    plan.caveat = params.winsMaterial
      ? 'The evaluation holds — the move wins material, so the structural cost is an accepted tradeoff.'
      : `The evaluation holds (${params.classification}); the structural cost is an accepted tradeoff.`;
  }
  // descriptive: cause only — no correction, no causal claim.
  return plan;
}
