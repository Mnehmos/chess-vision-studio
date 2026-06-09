// Rust engine client (gauntlet backend). Spawns ONE `analyze --serve` process
// for a whole run; each request writes a FEN line and resolves with the JSON
// pick + telemetry. The Rust engine is the active engine path — this file is
// pure orchestration glue.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

export interface RustPick {
  fen: string;
  uci: string | null;
  scoreCp: number;
  mate: number | null;
  pv: string[];
  depth: number;
  nodes: number;
  qNodes: number;
  qCaptures: number;
  quietExt: number;
  ttHits: number;
  cutoffs: number;
  timeMs: number;
  error?: string;
}

export class RustEngine {
  private proc: ChildProcessWithoutNullStreams;
  private rl: Interface;
  private queue: ((line: string) => void)[] = [];

  constructor(
    exe: string,
    depth: number,
    baseWeights?: string,
    rung2Weights?: string,
  ) {
    const args = ['--serve', '--depth', String(depth)];
    if (baseWeights) args.push('--base', baseWeights);
    if (rung2Weights) args.push('--rung2', rung2Weights);
    this.proc = spawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.rl = createInterface({ input: this.proc.stdout });
    this.rl.on('line', (line) => {
      const next = this.queue.shift();
      if (next) next(line);
    });
  }

  /** Search `fen` at the configured depth; resolves with the pick + telemetry. */
  analyze(fen: string): Promise<RustPick> {
    return new Promise((resolve, reject) => {
      this.queue.push((line) => {
        try {
          resolve(JSON.parse(line) as RustPick);
        } catch (e) {
          reject(e);
        }
      });
      this.proc.stdin.write(fen + '\n');
    });
  }

  /** Static eval (White-POV rounded cp; exact TS-eval parity) via `eval <fen>`. */
  evalStatic(fen: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.queue.push((line) => {
        try {
          const o = JSON.parse(line) as { evalWhiteCp?: number; error?: string };
          if (typeof o.evalWhiteCp === 'number') resolve(o.evalWhiteCp);
          else reject(new Error(o.error ?? 'eval failed'));
        } catch (e) {
          reject(e);
        }
      });
      this.proc.stdin.write('eval ' + fen + '\n');
    });
  }

  dispose(): void {
    try {
      this.proc.stdin.write('quit\n');
      this.proc.kill();
    } catch {
      /* already gone */
    }
  }
}
