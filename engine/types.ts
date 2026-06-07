// Core data contracts (§4 of the spec). These interfaces ARE the spec.
// The engine is pure and headless: no React, no DOM, no I/O (Invariant 1).
// `MoveAnalysis` is the central seam (Invariant 2) — everything downstream
// consumes this one validated object and nothing reaches around it.

// ────────────────────────────────────────────────────────────────────────────
// [1] Position
// ────────────────────────────────────────────────────────────────────────────
export interface PositionState {
  fen: string;
  sideToMove: 'w' | 'b';
  moveNumber: number;
  legalMoves: string[]; // SAN
}

// ────────────────────────────────────────────────────────────────────────────
// [2] Relations — built for ONE position
// ────────────────────────────────────────────────────────────────────────────
export type Square = string; // 'e4'
export type PieceId = string; // e.g. 'wNf3' (color+type+from-square)

export interface PieceRelation {
  square: Square;
  piece: string; // 'wN', 'bQ', ...
  attackedBy: PieceId[]; // enemy pieces hitting this square
  defendedBy: PieceId[]; // friendly pieces guarding this square
}

export interface RelationMap {
  bySquare: Record<Square, PieceRelation>; // occupied squares only
  controlledByWhite: Square[];
  controlledByBlack: Square[];
}

// ────────────────────────────────────────────────────────────────────────────
// [3] Evaluation
// ────────────────────────────────────────────────────────────────────────────
export interface Eval {
  cp?: number; // centipawns, from side-to-move POV
  mate?: number; // mate in N (sign = side-to-move POV)
  depth: number;
  pv: string[]; // principal variation, SAN
  // Distinguishes a genuine eval from a game-over position and from a failed/timed-out
  // search. Undefined = 'ok'. 'unavailable' must NEVER be treated as a real 0.00.
  status?: 'ok' | 'terminal' | 'unavailable';
}

// ────────────────────────────────────────────────────────────────────────────
// [4] SEE
// ────────────────────────────────────────────────────────────────────────────
export interface SEEResult {
  square: Square;
  swing: number; // pawns; >0 = capturing side wins material
  losingSideToMove: boolean; // owner of piece on square loses material
}

// ────────────────────────────────────────────────────────────────────────────
// [5/6/5a] EVIDENCE — the unified candidate the ranker & UI consume.
// Discriminated union over a shared base. ONLY VALIDATED candidates are ever
// constructed (Invariant 7).
// ────────────────────────────────────────────────────────────────────────────
export type InsightKind = 'changed_relation' | 'motif'; // + 'pawn_fact' | 'king_fact' later

export type InsightSource = 'played_move' | 'refutation' | 'available'; // 'available' = a MISSED chance

export interface InsightBase {
  id: string;
  kind: InsightKind;
  side: 'white' | 'black'; // who benefits from / is exposed by the insight
  squares: Square[]; // squares to involve
  arrows: [Square, Square][]; // overlay hints for the render layer
  source: InsightSource;
  materialSwing: number; // pawns (from SEE); 0 if N/A
  kingSafetyDelta: number; // signed; see §5
  inPV: boolean;
  saliency: number; // 0..1, DERIVED by the ranker — never hand-set
  templateId: string; // keys the deterministic explanation (M6)
  evidence: string[]; // the validated facts this insight rests on
}

// A single changed relationship (from the diff layer)
export type ChangeType =
  | 'piece_captured'
  | 'now_undefended'
  | 'now_defended'
  | 'now_see_losing'
  | 'defender_left'
  | 'line_opened'
  | 'line_closed'
  | 'check_created'
  | 'mate_threat'
  | 'pv_refutation'
  | 'escape_squares_changed';

export interface ChangedRelation extends InsightBase {
  kind: 'changed_relation';
  type: ChangeType;
}

// A named tactic — a label on an engine-verified line (Invariant 7)
export type MotifType =
  // Tier 1 — geometrically / engine PROVABLE (MVP)
  | 'fork'
  | 'pin_absolute'
  | 'pin_relative'
  | 'skewer'
  | 'discovered_attack'
  | 'discovered_check'
  | 'back_rank'
  | 'removal_of_guard'
  | 'mating_net'
  // Tier 2 — PROPOSED (LLM/heuristic) then engine-VALIDATED (next wave)
  | 'overload'
  | 'deflection'
  | 'decoy'
  | 'interference'
  | 'zwischenzug'
  | 'trapped_piece'
  | 'x_ray';

export interface Motif extends InsightBase {
  kind: 'motif';
  type: MotifType;
  tier: 1 | 2;
  byPiece: PieceId; // piece executing the motif
  line: string[]; // the forcing sequence (SAN) that realizes it
  consequence: { materialSwing: number; mateIn?: number }; // validated payoff
  proposedBy: 'geometry' | 'heuristic' | 'llm';
  validatedBy: 'geometry' | 'see' | 'engine_pv'; // REQUIRED; unvalidated = not constructed
  // NO `confidence` field. Tactical validity is BINARY (Invariant 7).
}

export type InsightCandidate = ChangedRelation | Motif; // | PawnFact | KingFact (later)

export type Classification =
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'unclassified'; // the eval was unavailable — NOT a real 0.00 / 'best'

// Mate-proof obligation facts (oracle says mate exists; the evaluator explains it).
export interface MateProof {
  mateInMoves: number;
  matingSide: 'white' | 'black';
  line: string[]; // SAN, ending on the mating move (…#)
  matingMove: string;
  matingPiece: string; // 'Rook e7' — the critical attacker
  checkingLine: string; // 'e-file' | 'rank 7' | 'a diagonal' | 'knight'
  supportPiece?: string; // a friendly piece defending the mating square
  trappedKing: string;
  kingEscapesAtStart: number;
}

// ────────────────────────────────────────────────────────────────────────────
// [7] The central seam — everything downstream consumes THIS
// ────────────────────────────────────────────────────────────────────────────
export interface MoveAnalysis {
  positionId?: string; // stable identity (positionAfter + SAN); consumers gate on it
  positionBefore: string; // FEN
  positionAfter: string; // FEN
  move: string; // SAN, e.g. '15. Qxg4'
  classification: Classification;
  evalBefore: Eval; // best-move eval at positionBefore
  evalAfter: Eval;
  cpLoss: number; // pawns lost vs best move (see §5)
  rankedInsights: InsightCandidate[]; // VALIDATED only, sorted desc by saliency
  topExplanation: string; // = rankedInsights[0] rendered, or "solid move"
  mateProof?: MateProof; // present when a forced mate is in play (oracle-confirmed)
  ledMap?: LedMap; // active-mode color map (later)
}

// ────────────────────────────────────────────────────────────────────────────
// [9] LED / hardware twin
// ────────────────────────────────────────────────────────────────────────────
export type LedColor =
  | 'green'
  | 'red'
  | 'blue'
  | 'yellow'
  | 'orange'
  | 'purple'
  | 'dark_red' // Black king zone (darker shade of Black's base red)
  | 'dark_blue' // White king zone (darker shade of White's base blue)
  | 'gray'
  | 'red_blink'
  | 'off';

export interface LedMap {
  mode: string;
  squares: Record<Square, LedColor>; // all 64
}
