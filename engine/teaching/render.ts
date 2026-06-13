import type { ExplanationPlan, StructureDelta } from './types';
import { filesOf } from './evidence';

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
