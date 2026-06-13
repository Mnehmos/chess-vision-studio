import type { FactRef, StructureDelta } from './types';

// A structure delta IS already an evidence-shaped fact; carry its identity through.
export function structureDeltaToFactRef(delta: StructureDelta): FactRef {
  return {
    factId: delta.factId,
    kind: delta.kind,
    squares: [...delta.squares],
    side: delta.side,
  };
}

// Stable, deterministic event id — identity is content, never an array index
// (plan §3 identity rule). Squares are sorted so the id is order-independent.
export function stableEventId(topicId: string, playedUci: string, squares: string[]): string {
  const squareKey = [...squares].sort().join('-');
  return `${topicId}:${playedUci}:${squareKey}`;
}

// Distinct files (a-h) touched by a square list, sorted.
export function filesOf(squares: string[]): string[] {
  const files: string[] = [];
  for (const sq of squares) {
    const f = sq[0];
    if (f && !files.includes(f)) files.push(f);
  }
  return files.sort();
}
