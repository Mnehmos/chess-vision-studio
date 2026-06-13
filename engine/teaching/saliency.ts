import type { Classification } from '../types';

// Severity weight from the Stockfish classification band. Classification is
// already loss-vs-best, so we lean on it rather than re-deriving thresholds.
const CLASSIFICATION_WEIGHT: Record<Classification, number> = {
  blunder: 1.0,
  mistake: 0.75,
  inaccuracy: 0.5,
  good: 0.2,
  excellent: 0.15,
  best: 0.1,
  unclassified: 0.1,
};

// Deterministic saliency in [0, 1] for a pawn-structure-damage event.
// Causally-supported events outrank descriptive ones; deeper cp loss and more
// weaknesses raise the score. Same inputs → same output (no randomness).
export function scorePawnStructureDamage(params: {
  classification: Classification;
  cpLoss: number;
  weaknessCount: number;
  counterfactualSupported: boolean;
}): number {
  const base = CLASSIFICATION_WEIGHT[params.classification] ?? 0.1;
  const cpComponent = Math.min(Math.max(params.cpLoss, 0) / 5, 1) * 0.3; // +0.3 at ≥5 pawns
  const countComponent = Math.min(params.weaknessCount, 4) * 0.05; // up to +0.2
  const causal = params.counterfactualSupported ? 0.15 : 0;
  return round3(Math.min(base * 0.6 + cpComponent + countComponent + causal, 1));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
