// Engine backend abstraction (R5). The app talks to "an engine" through this
// seam; which engine answers is a config switch. The TS/chess.js engine remains
// available as the legacy/reference backend; the Rust engine is the active
// engine path (CLI-subprocess bridge first — WASM/native can come later without
// changing this interface).

export interface BackendId {
  /** e.g. 'rust' | 'ts-legacy' */
  backend: string;
  /** engine name/version (git short hash for rust, package for ts) */
  engine: string;
  /** which trained weights are loaded (file names or 'default') */
  weightsId: string;
}

export interface SearchOpts {
  depth?: number;
}

export interface MoveResult {
  uci: string | null;
  san: string | null;
  /** Centipawns, side-to-move POV (negamax convention). */
  scoreCp: number;
  mate: number | null;
  pv: string[];
  depth: number;
  nodes: number;
  qNodes: number;
  ttHits: number;
  timeMs: number;
}

export interface EvalResult {
  /** Centipawns from White's perspective (static eval). */
  evalWhiteCp: number;
}

export interface CvsEngineBackend {
  id(): BackendId;
  bestMove(fen: string, options?: SearchOpts): Promise<MoveResult>;
  /** analyze == bestMove with full telemetry; same shape, future superset. */
  analyze(fen: string, options?: SearchOpts): Promise<MoveResult>;
  evaluate(fen: string): Promise<EvalResult>;
  dispose(): void;
}
