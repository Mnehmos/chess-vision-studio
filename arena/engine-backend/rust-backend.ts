// Rust backend (R5) — the ACTIVE engine path. Bridges to the Rust engine's
// `analyze --serve` subprocess (FEN in → JSON out, one long-lived process).
// CLI subprocess is the deliberate first bridge; WASM/native can replace it
// later without changing the CvsEngineBackend seam.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { RustEngine } from '../gauntlet/rust-engine';
import type { BackendId, CvsEngineBackend, EvalResult, MoveResult, PositionContext, SearchOpts } from './types';

// CVS_RUST_EXE overrides the binary path (e.g. a target-next build while the
// default exe is locked by running gauntlets).
export const DEFAULT_RUST_EXE =
  process.env.CVS_RUST_EXE ?? '../chess-vision-studio-rust-engine/target/release/analyze.exe';
export const DEFAULT_BASE_WEIGHTS = 'arena/out/value-weights-mixed.json';
export const DEFAULT_RUNG2_WEIGHTS = 'arena/out/rung2-weights-mixed.json';
/** R4-gate operating depth: Rust d6 strictly dominates TS d4 (see R4_GATE_REPORT). */
export const RUST_DEFAULT_DEPTH = 6;

export interface RustBackendOptions {
  exe?: string;
  baseWeights?: string;
  rung2Weights?: string;
  defaultDepth?: number;
  extraArgs?: string[];
}

export function rustBackendExtraArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra: string[] = [];
  if (env.CVS_RUST_NNUE) extra.push('--nnue', env.CVS_RUST_NNUE);
  if (env.CVS_RUST_HELPER_NNUE) extra.push('--helper-nnue', env.CVS_RUST_HELPER_NNUE);
  if (env.CVS_RUST_ALLOW_UNVERIFIED === '1') extra.push('--allow-unverified-net');
  if (env.CVS_RUST_FUTILITY === '1') extra.push('--futility');
  if (env.CVS_RUST_RFP === '1') extra.push('--rfp');
  if (env.CVS_RUST_TTPS === '1') extra.push('--tt-prune-store');
  if (env.CVS_RUST_QTT === '1') extra.push('--qtt');
  if (env.CVS_RUST_HISTMALUS === '1') extra.push('--histmalus');
  if (env.CVS_RUST_HISTLMR === '1') extra.push('--histlmr');
  // Move-ordering / pruning experiments promoted after cutechess-gated wins
  // (2026-06-27). Each only activates when its env flag is set to '1'.
  if (env.CVS_RUST_LMP === '1') extra.push('--lmp');
  if (env.CVS_RUST_IMPROVING === '1') extra.push('--improving');
  if (env.CVS_RUST_TT2 === '1') extra.push('--tt2');
  if (env.CVS_RUST_CONTHIST === '1') extra.push('--conthist');
  if (env.CVS_RUST_COUNTERMOVE === '1') extra.push('--countermove');
  if (env.CVS_RUST_SINGULAR === '1') extra.push('--singular');
  if (env.CVS_RUST_SMARTTIME === '1') extra.push('--smarttime');
  return extra;
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
      extraArgs: options.extraArgs ?? rustBackendExtraArgs(),
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
      const extra = [...this.opts.extraArgs];
      // CVS_RUST_FUTILITY=1 enables futility pruning (accepted-with-note,
      // 2026-06-11: fixed-N +34, gen7 blunder collapse preserved at depth).
      // CVS_RUST_RFP=1 enables reverse futility pruning (accepted-with-note,
      // 2026-06-11: standard engine practice; SPRT +68.8 and 100-game 63.5%
      // screen on record, user ruling: accept with note).
      // 2026-06-12 accepted-with-note TT pair (fixed-N +15.6/+17.4; pair
      // confirmation 56.0% over 100 games, no interaction).
      // 2026-06-12 history rework (accepted with note, fixed-N 53.2%/400):
      // maluses+gravity substrate + history-informed LMR. -23% nodes, +3 depth.
      e = new RustEngine(this.opts.exe, depth, this.opts.baseWeights, this.opts.rung2Weights, extra);
      this.engines.set(depth, e);
    }
    return e;
  }

  private discardEngine(depth: number): void {
    this.engines.get(depth)?.dispose();
    this.engines.delete(depth);
  }

  private async withEngine<T>(depth: number, run: (engine: RustEngine) => Promise<T>): Promise<T> {
    try {
      return await run(this.engineFor(depth));
    } catch (error) {
      this.discardEngine(depth);
      throw error;
    }
  }

  id(): BackendId {
    const w = `${this.opts.baseWeights.split(/[\\/]/).pop()}+${this.opts.rung2Weights.split(/[\\/]/).pop()}`;
    return { backend: 'rust', engine: `cvs-bitboard-core@${this.engineVersion}`, weightsId: w };
  }

  async bestMove(fen: string, options: SearchOpts = {}, context?: PositionContext): Promise<MoveResult> {
    return this.analyze(fen, options, context);
  }

  async analyze(fen: string, options: SearchOpts = {}, context?: PositionContext): Promise<MoveResult> {
    const depth = options.depth ?? this.opts.defaultDepth;
    const p = await this.withEngine(depth, (engine) => engine.analyze(fen, context));
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
    const evalWhiteCp = await this.withEngine(this.opts.defaultDepth, (engine) => engine.evalStatic(fen));
    return { evalWhiteCp };
  }

  /** Clock-budgeted best move (`go <ms>`): depth 30 cap, wall clock drives the
   * search — the Lichess-bot / equal-clock mode. */
  async bestMoveTimed(fen: string, budgetMs: number, context?: PositionContext): Promise<MoveResult> {
    const p = await this.withEngine(30, (engine) => engine.analyzeTimed(fen, budgetMs, context));
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
