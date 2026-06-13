import type { FactCollection, Side, StructureDelta } from './types';

export interface StructureComparison {
  // Damaging structures the played move created that the best move did NOT —
  // i.e. weaknesses the correction actually avoids.
  avoided: StructureDelta[];
  // Damaging structures created by BOTH played and best — unavoidable, so they
  // cannot be blamed on the played move.
  shared: StructureDelta[];
  // Whether a best-move counterfactual was actually available and computed.
  // Without it, causal attribution is impossible (unknown ≠ "best is clean").
  hasBest: boolean;
}

function deltaKey(d: StructureDelta): string {
  return `${d.kind}|${[...d.squares].sort().join(',')}`;
}

function computedItems(c: FactCollection<StructureDelta> | undefined): StructureDelta[] | null {
  if (!c) return null;
  return c.status === 'computed' ? c.items : null;
}

// Compare the damaging structures the played move created against the best move's.
// Only the mover's own side and the requested damaging kinds are considered.
export function compareCreatedStructures(
  played: FactCollection<StructureDelta>,
  best: FactCollection<StructureDelta> | undefined,
  side: Side,
  kinds: string[],
): StructureComparison {
  const playedItems = (computedItems(played) ?? []).filter(
    (d) => d.side === side && kinds.includes(d.kind),
  );
  const bestItems = computedItems(best);
  if (bestItems === null) {
    // No usable counterfactual: report the damage but flag that best is unknown.
    return { avoided: playedItems, shared: [], hasBest: false };
  }
  const bestKeys = new Set(
    bestItems.filter((d) => d.side === side && kinds.includes(d.kind)).map(deltaKey),
  );
  const avoided: StructureDelta[] = [];
  const shared: StructureDelta[] = [];
  for (const d of playedItems) {
    if (bestKeys.has(deltaKey(d))) shared.push(d);
    else avoided.push(d);
  }
  return { avoided, shared, hasBest: true };
}
