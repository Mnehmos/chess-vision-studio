// Rust backend (R5) — the ACTIVE engine path. Bridges to the Rust engine's
// `analyze --serve` subprocess (FEN in → JSON out, one long-lived process).
// CLI subprocess is the deliberate first bridge; WASM/native can replace it
// later without changing the CvsEngineBackend seam.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { RustEngine } from '../gauntlet/rust-engine';
import type { BackendId, CvsEngineBackend, EvalResult, MoveResult, SearchOpts } from './types';

export const DEFAULT_RUST_EXE = '../chess-vision-studio-rust-engine/target/release/analyze.exe';
export const DEFAULT_BASE_WEIGHTS = 'arena/out/value-weights-mixed.json';
export const DEFAULT_RUNG2_WEIGHTS = 'arena/out/rung2-weights-mixed.json';
/** R4-gate operating depth: Rust d6 strictly dominates TS d4 (see R4_GATE_REPORT). */
export const RUST_DEFAULT_DEPTH = 6;

export interface RustBackendOptions {
  exe?: string;
  baseWeights?: string;
  rung2Weights?: string;
  defaultDepth?: number;
}

export class RustBackend implements CvsEngineBackend {
  private engines = new Map<number, RustEngine>(); // one serve process per depth
  private opts: Required<RustBackendOptions>;
  private engineVersion: string;

  constructor(options: RustBackendOptions = {}) {
    this.opts = {
      exe: options.exe ?? DEFAULT_RUST_EXE,
      baseWeights: options.baseWeights ?? DEFAULT_BASE_WEIGHTS,
      rung2Weights: options.rung2Weights ?? DEFAULT_RUNG2_WEIGHTS,
      defaultDepth: options.defaultDepth ?? RUST_DEFAULT_DEPTH,
    };
    if (!existsSync(this.opts.exe)) {
      throw new Error(`Rust engine binary not found at ${this.opts.exe} — run 'cargo build --release' in chess-vision-studio-rust-engine`);
    }
    let version = 'unknown';
    try {
      version = execSync('git rev-parse --short HEAD', { cwd: '../chess-vision-studio-rust-engine', encoding: 'utf8' }).trim();
    } catch {
      /* best effort */
    }
    this.engineVersion = version;
  }

  private engineFor(depth: number): RustEngine {
    let e = this.engines.get(depth);
    if (!e) {
      e = new RustEngine(this.opts.exe, depth, this.opts.baseWeights, this.opts.rung2Weights);
      this.engines.set(depth, e);
    }
    return e;
  }

  id(): BackendId {
    const w = `${this.opts.baseWeights.split(/[\\/]/).pop()}+${this.opts.rung2Weights.split(/[\\/]/).pop()}`;
    return { backend: 'rust', engine: `cvs-bitboard-core@${this.engineVersion}`, weightsId: w };
  }

  async bestMove(fen: string, options: SearchOpts = {}): Promise<MoveResult> {
    return this.analyze(fen, options);
  }

  async analyze(fen: string, options: SearchOpts = {}): Promise<MoveResult> {
    const depth = options.depth ?? this.opts.defaultDepth;
    const p = await this.engineFor(depth).analyze(fen);
    if (p.error) throw new Error(`rust analyze failed: ${p.error}`);
    return {
      uci: p.uci,
      san: null, // SAN is a presentation concern; callers convert via chess.js when needed
      scoreCp: p.scoreCp,
      mate: p.mate,
      pv: p.pv,
      depth: p.depth,
      nodes: p.nodes,
      qNodes: p.qNodes,
      ttHits: p.ttHits,
      timeMs: p.timeMs,
    };
  }

  async evaluate(fen: string): Promise<EvalResult> {
    // Any serve process answers `eval`; reuse (or create) the default-depth one.
    const evalWhiteCp = await this.engineFor(this.opts.defaultDepth).evalStatic(fen);
    return { evalWhiteCp };
  }

  /** Clock-budgeted best move (`go <ms>`): depth 30 cap, wall clock drives the
   * search — the Lichess-bot / equal-clock mode. */
  async bestMoveTimed(fen: string, budgetMs: number): Promise<MoveResult> {
    const p = await this.engineFor(30).analyzeTimed(fen, budgetMs);
    if (p.error) throw new Error(`rust timed analyze failed: ${p.error}`);
    return {
      uci: p.uci,
      san: null,
      scoreCp: p.scoreCp,
      mate: p.mate,
      pv: p.pv,
      depth: p.depth,
      nodes: p.nodes,
      qNodes: p.qNodes ?? 0,
      ttHits: p.ttHits,
      timeMs: p.timeMs,
    };
  }

  dispose(): void {
    for (const e of this.engines.values()) e.dispose();
    this.engines.clear();
  }
}
