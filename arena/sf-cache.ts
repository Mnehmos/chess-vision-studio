// Shared Stockfish eval cache — side-effect-free module (no auto-run), safe to
// import from any harness. One SfCachePool wraps one or more UciEngine instances
// and memoizes evals by FEN@depth, persisted as JSONL so every gate/gauntlet run
// pays each position eval exactly once.
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import type { Eval } from '../engine/types';
import type { UciEngine } from '../engine/evaluation';

export class SfCachePool {
  private cache = new Map<string, Eval>();
  private inflight = new Map<string, Promise<Eval>>();
  private rr = 0;
  constructor(
    private engines: UciEngine[],
    private depth: number,
    private cachePath: string,
  ) {
    if (existsSync(cachePath)) {
      for (const line of readFileSync(cachePath, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const { k, e } = JSON.parse(line) as { k: string; e: Eval };
          this.cache.set(k, e);
        } catch {
          /* skip bad line */
        }
      }
    }
  }
  get cachedCount(): number {
    return this.cache.size;
  }
  async evalFen(fen: string): Promise<Eval> {
    const key = `${fen}@${this.depth}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const eng = this.engines[this.rr++ % this.engines.length]!;
    const p = (async () => {
      const e = await eng.evaluate({ fen, depth: this.depth });
      this.cache.set(key, e);
      this.inflight.delete(key);
      try {
        appendFileSync(this.cachePath, JSON.stringify({ k: key, e }) + '\n', 'utf8');
      } catch {
        /* cache persist best-effort */
      }
      return e;
    })();
    this.inflight.set(key, p);
    return p;
  }
}
