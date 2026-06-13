export const TEACHING_FACTS_SCHEMA_VERSION = 1 as const;

export interface TeachingFactsRequestV1 {
  schemaVersion: 1;
  fenBefore: string;
  playedMoveUci: string;
  bestMoveUci?: string;
  refutationUci?: string;
  principalVariationUci?: string[];
  options?: {
    includeMotifOpportunities: boolean;
    includeCounterfactual: boolean;
  };
}

export interface TeachingFactBundleV1 {
  schemaVersion: 1;
  fenBefore: string;
  before: PositionFacts;
  played: MoveStateFacts;
  best?: MoveStateFacts;
  refutation?: MoveStateFacts;
  provenance: FactsProvenance;
  errors: FactError[];
}

export interface PositionFacts {
  sideToMove: Side;
  pieces: PieceFact[];
  pawnStructure: PawnStructureFacts;
  kingSafety: FactCollection<KingSafetyFact>;
  availableCaptures: FactCollection<CaptureOpportunity>;
  availableMotifs: FactCollection<MotifOpportunity>;
}

export interface MoveStateFacts {
  move: MoveFact;
  fenAfter: string;
  position: PositionFacts;
  deltas: {
    createdHazards: FactCollection<HazardFact>;
    removedHazards: FactCollection<HazardFact>;
    worsenedHazards: FactCollection<HazardFact>;
    createdStructures: FactCollection<StructureDelta>;
    removedStructures: FactCollection<StructureDelta>;
  };
}

export interface MoveFact {
  uci: string;
  from: string;
  to: string;
  promotion?: string;
}

export type FactCollection<T> =
  | { status: 'computed'; items: T[] }
  | { status: 'uncomputed'; reason: string }
  | { status: 'unavailable'; reason: string };

export type FactValue<T> =
  | { status: 'computed'; value: T }
  | { status: 'uncomputed'; reason: string }
  | { status: 'unavailable'; reason: string };

export type Side = 'white' | 'black';
export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

export interface PieceRef {
  id: string;
  side: Side;
  pieceType: PieceType;
  square: string;
}

export interface PieceFact extends PieceRef {
  attackers: PieceRef[];
  defenders: PieceRef[];
  attackerCount: number;
  defenderCount: number;
  attacked: boolean;
  loose: boolean;
  see: FactValue<SeeLosingFact>;
  onlyDefenderOf: PieceRef[];
}

export interface SeeLosingFact {
  losing: boolean;
  bestCaptureUci?: string;
  scoreCp?: number;
}

export interface PawnStructureFacts {
  doubled: DoubledPawnFact[];
  isolated: PieceRef[];
  passed: PieceRef[];
  islands: PawnIslandFact[];
  backward: FactCollection<PieceRef>;
  connectedPassed: FactCollection<PieceRef>;
  openFiles: FactCollection<string>;
  semiOpenFiles: FactCollection<SideFileFact>;
  kingShieldMissing: FactCollection<KingShieldFact>;
  pawnChains: FactCollection<PawnChainFact>;
}

export interface DoubledPawnFact {
  id: string;
  side: Side;
  file: string;
  squares: string[];
}

export interface PawnIslandFact {
  id: string;
  side: Side;
  files: string[];
  squares: string[];
}

export interface StructureDelta {
  factId: string;
  kind: string;
  side: Side;
  squares: string[];
}

export interface SideFileFact {
  side: Side;
  file: string;
}

export interface KingShieldFact {
  side: Side;
  kingSquare: string;
  missingSquares: string[];
}

export interface PawnChainFact {
  side: Side;
  squares: string[];
}

export interface KingSafetyFact {
  side: Side;
  kingSquare: string;
}

export interface CaptureOpportunity {
  moveUci: string;
}

export interface MotifOpportunity {
  validator: string;
}

export interface HazardFact {
  id: string;
  kind: string;
  side: Side;
  squares: string[];
}

export interface FactsProvenance {
  engine: string;
  engineCommit?: string;
  factsRegistryVersion: number;
  validators: string[];
}

export interface FactError {
  code: string;
  message: string;
  field?: string;
}

export function isTeachingFactBundleV1(value: unknown): value is TeachingFactBundleV1 {
  if (!value || typeof value !== 'object') return false;
  const bundle = value as Partial<TeachingFactBundleV1>;
  return (
    bundle.schemaVersion === TEACHING_FACTS_SCHEMA_VERSION &&
    typeof bundle.fenBefore === 'string' &&
    !!bundle.before &&
    !!bundle.played &&
    !!bundle.provenance &&
    Array.isArray(bundle.errors)
  );
}
