import type { FactRef, PieceRef, StructureDelta } from './types';

// Extract the bare PieceRef identity from a richer PieceFact (drop attacker lists
// etc.) so teaching events stay small and serialize cleanly.
export function toPieceRef(p: PieceRef): PieceRef {
  return { id: p.id, side: p.side, pieceType: p.pieceType, square: p.square };
}

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
