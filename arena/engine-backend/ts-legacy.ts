// TS legacy backend — wraps the frozen chess.js-based @cvs/engine behind the
// backend seam. Reference/comparison use only; no engine capability is added.
import { CvsEngine, DEFAULT_POLICY_WEIGHTS, type Rung2Weights, type ValueWeights } from '@cvs/engine';
import type { BackendId, CvsEngineBackend, EvalResult, MoveResult, SearchOpts } from './types';

export class TsLegacyBackend implements CvsEngineBackend {
  private engine: CvsEngine;
  private weightsId: string;

  constructor(valueWeights?: ValueWeights, rung2Weights?: Rung2Weights, weightsId = 'default') {
    this.engine = new CvsEngine({ weights: DEFAULT_POLICY_WEIGHTS, valueWeights, rung2Weights });
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
