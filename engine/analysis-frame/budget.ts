/**
 * SearchBudget — one explicit resource contract for engine search (plan §4.4).
 * Lets a direct engine-vs-engine comparison request the SAME budget from both
 * engines (plan §6 PR-02). Ordinary review and engine-opponent play keep their
 * own settings; this does not replace them.
 */
export type SearchBudget =
  | { kind: 'movetime'; milliseconds: number }
  | { kind: 'depth'; depth: number }
  | { kind: 'nodes'; nodes: number };

/**
 * The shared budget for DIRECT engine-disagreement analysis only (plan §6 PR-02).
 * Equal movetime makes the comparison apples-to-apples; it is NOT a benchmark and
 * must not be read as Elo/strength (plan risk §5).
 */
export const DEFAULT_ENGINE_COMPARISON_BUDGET: SearchBudget = {
  kind: 'movetime',
  milliseconds: 1000,
};

/**
 * Map a SearchBudget (with a legacy depth fallback) to the dev-proxy request
 * fields. `movetime` → `movetimeMs`, `depth` → `depth`. `nodes` is not supported
 * by the dev proxies, so it falls back to the legacy depth. Returns `{}` when
 * nothing is specified (the proxy then applies its own default depth).
 */
export function searchBudgetToRequestFields(
  budget?: SearchBudget,
  depthFallback?: number,
): { depth?: number; movetimeMs?: number } {
  if (budget) {
    if (budget.kind === 'movetime') return { movetimeMs: budget.milliseconds };
    if (budget.kind === 'depth') return { depth: budget.depth };
    // 'nodes' is unsupported on the wire today → fall through to the depth fallback.
  }
  return typeof depthFallback === 'number' ? { depth: depthFallback } : {};
}
