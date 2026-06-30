// TS legacy backend — wraps the frozen chess.js-based @cvs/engine behind the
// backend seam. Reference/comparison use only; no engine capability is added.
// @cvs/engine is deprecated (everything we need moved to the Rust engine); this stays as a frozen
// legacy reference. Its value head is now fixed (the old tunable value/rung2 weights were removed),
// so the only knob is the policy weight vector — we run the default policy weights.
import { CvsEngine, DEFAULT_POLICY_WEIGHTS, type PolicyWeights } from '@cvs/engine';
import type { BackendId, CvsEngineBackend, EvalResult, MoveResult, SearchOpts } from './types';

export class TsLegacyBackend implements CvsEngineBackend {
  private engine: CvsEngine;
  private weightsId: string;

  constructor(weights: PolicyWeights = DEFAULT_POLICY_WEIGHTS, weightsId = 'default') {
    this.engine = new CvsEngine({ weights });
    this.weightsId = weightsId;
  }

  id(): BackendId {
    return { backend: 'ts-legacy', engine: '@cvs/engine (chess.js, frozen reference)', weightsId: this.weightsId };
  }

  async bestMove(fen: string, options: SearchOpts = {}): Promise<MoveResult> {
    return this.analyze(fen, options);
  }

  async analyze(fen: string, options: SearchOpts = {}): Promise<MoveResult> {
    const t0 = Date.now();
    const r = this.engine.analyze(fen, { depth: options.depth ?? 4 });
    return {
      uci: r.bestMove?.uci ?? null,
      san: r.bestMove?.san ?? null,
      scoreCp: r.scoreCp,
      mate: r.mate ?? null,
      pv: r.pv,
      depth: r.depth,
      nodes: r.nodes,
      qNodes: 0, // legacy analyze() does not surface searcher telemetry
      ttHits: 0,
      timeMs: Date.now() - t0,
    };
  }

  async evaluate(fen: string): Promise<EvalResult> {
    return { evalWhiteCp: this.engine.evaluate(fen) };
  }

  dispose(): void {
    /* in-process engine — nothing to release */
  }
}
