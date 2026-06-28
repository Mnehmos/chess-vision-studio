/**
 * Rust fact adapters (plan §6 PR-06). Map the Rust PositionFacts / MoveStateFacts
 * the protocol ALREADY supplies into per-lens views, each tagged with its source
 * and computed/uncomputed/unavailable status. The rule that matters: a field Rust
 * marks `uncomputed` (backward pawns, connected passed, open/semi-open files, pawn
 * chains in the current registry) must surface its tagged status — NEVER an empty
 * array presented as "none". Consumers keep the working TypeScript visual for
 * uncomputed/unavailable features (explicit fallback), and prefer Rust where it is
 * computed.
 */
import type {
  FactCollection,
  KingShieldFact,
  MotifOpportunity,
  MoveStateFacts,
  PawnStructureFacts,
  PieceFact,
  PieceRef,
  PinOpportunity,
  PositionFacts,
} from './teaching/types';

export interface LensView<T> {
  source: 'rust' | 'typescript';
  status: 'computed' | 'uncomputed' | 'unavailable';
  data: T;
  provenance: string[];
}

function rust<T>(
  status: LensView<T>['status'],
  data: T,
  provenance: string[],
): LensView<T> {
  return { source: 'rust', status, data, provenance };
}

export function pieceFactForSquare(
  position: PositionFacts,
  square: string,
): PieceFact | undefined {
  return position.pieces.find((piece) => piece.square === square);
}

export interface OccupiedPieceThreat {
  square: string;
  side: PieceRef['side'];
  pieceType: PieceRef['pieceType'];
  attackers: PieceRef[];
  attackerCount: number;
  loose: boolean;
}

/** Occupied pieces that are attacked, with their Rust-computed attackers. */
export function occupiedPieceThreatView(
  position: PositionFacts,
): LensView<OccupiedPieceThreat[]> {
  const data = position.pieces
    .filter((p) => p.attacked)
    .map((p) => ({
      square: p.square,
      side: p.side,
      pieceType: p.pieceType,
      attackers: p.attackers,
      attackerCount: p.attackerCount,
      loose: p.loose,
    }));
  return rust('computed', data, ['attack_map']);
}

export interface OccupiedPieceDefense {
  square: string;
  side: PieceRef['side'];
  pieceType: PieceRef['pieceType'];
  defenders: PieceRef[];
  defenderCount: number;
  onlyDefenderOf: PieceRef[];
}

/** Occupied pieces with their Rust-computed defenders + only-defender relations. */
export function occupiedPieceDefenseView(
  position: PositionFacts,
): LensView<OccupiedPieceDefense[]> {
  const data = position.pieces
    .filter((p) => p.defenders.length > 0 || p.onlyDefenderOf.length > 0)
    .map((p) => ({
      square: p.square,
      side: p.side,
      pieceType: p.pieceType,
      defenders: p.defenders,
      defenderCount: p.defenderCount,
      onlyDefenderOf: p.onlyDefenderOf,
    }));
  return rust('computed', data, ['attack_map']);
}

export interface HangingPiece {
  square: string;
  side: PieceRef['side'];
  pieceType: PieceRef['pieceType'];
  scoreCp?: number;
  bestCaptureUci?: string;
}

/** Pieces the Rust SEE marks as losing (a real "hanging" claim, not a guess). */
export function hangingPieceView(position: PositionFacts): LensView<HangingPiece[]> {
  const data: HangingPiece[] = [];
  for (const p of position.pieces) {
    if (p.see.status === 'computed' && p.see.value.losing) {
      data.push({
        square: p.square,
        side: p.side,
        pieceType: p.pieceType,
        scoreCp: p.see.value.scoreCp,
        bestCaptureUci: p.see.value.bestCaptureUci,
      });
    }
  }
  return rust('computed', data, ['see']);
}

/** The whole Rust pawn-structure block (computed arrays + tagged collections). */
export function pawnStructureView(position: PositionFacts): LensView<PawnStructureFacts> {
  return rust('computed', position.pawnStructure, ['pawn_structure']);
}

/**
 * A single pawn-structure collection as a tagged view. For an `uncomputed`/
 * `unavailable` collection (backward, connectedPassed, openFiles, semiOpenFiles,
 * pawnChains in the current registry) the data is empty but the STATUS carries the
 * reason — the consumer must not render this as "none" and should keep its
 * TypeScript visual.
 */
export function pawnFeatureView<T>(
  collection: FactCollection<T>,
  validator: string,
): LensView<T[]> {
  if (collection.status === 'computed') return rust('computed', collection.items, [validator]);
  return rust(collection.status, [], [validator]);
}

/** Missing-king-shield is a tagged collection; surface its status. */
export function kingShieldView(position: PositionFacts): LensView<KingShieldFact[]> {
  return pawnFeatureView(position.pawnStructure.kingShieldMissing, 'pawn_structure');
}

/** Created/removed/worsened hazards + created/removed structures for a move. */
export function moveHazardDeltaView(
  move: MoveStateFacts,
): LensView<MoveStateFacts['deltas']> {
  return rust('computed', move.deltas, ['hazard_deltas', 'pawn_structure']);
}

function motifCollectionView<T>(
  collection: FactCollection<T>,
  validator: string,
): LensView<T[]> {
  if (collection.status === 'computed') return rust('computed', collection.items, [validator]);
  return rust(collection.status, [], [validator]);
}

/** Rust fork opportunities (preferred over the broader TS fork motifs). */
export function forkOpportunityView(position: PositionFacts): LensView<MotifOpportunity[]> {
  return motifCollectionView(position.availableMotifs, 'fork_validation');
}

/** Rust pin opportunities (preferred over the broader TS pin motifs). */
export function pinOpportunityView(position: PositionFacts): LensView<PinOpportunity[]> {
  return motifCollectionView(position.availablePins, 'pin_validation');
}
