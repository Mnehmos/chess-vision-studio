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

export interface RustPositionContext {
  initialFen: string;
  moves: string[];
}

interface PendingRequest {
  resolve(line: string): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class RustEngine {
  private proc: ChildProcessWithoutNullStreams;
  private rl: Interface;
  private queue: PendingRequest[] = [];
  private failed?: Error;
  private stderrTail = '';

  constructor(
    exe: string,
    depth: number,
    baseWeights?: string,
    rung2Weights?: string,
    extraArgs: string[] = [],
  ) {
    const args = ['--serve', '--depth', String(depth), ...extraArgs];
    if (baseWeights) args.push('--base', baseWeights);
    if (rung2Weights) args.push('--rung2', rung2Weights);
    this.proc = spawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.rl = createInterface({ input: this.proc.stdout });
    this.rl.on('line', (line) => {
      const next = this.queue.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve(line);
      }
    });
    this.proc.stderr.on('data', (chunk: Buffer | string) => {
      this.stderrTail = (this.stderrTail + String(chunk)).slice(-8_192);
    });
    this.proc.once('error', (error) => this.fail(new Error(`Rust engine process error: ${error.message}`)));
    this.proc.once('exit', (code, signal) => {
      const detail = this.stderrTail.trim();
      this.fail(new Error(
        `Rust engine exited${code != null ? ` with code ${code}` : ''}${signal ? ` (${signal})` : ''}${detail ? `: ${detail}` : ''}`,
      ));
    });
  }

  /** Search `fen` at the configured depth; resolves with the pick + telemetry. */
  async analyze(fen: string, context?: RustPositionContext): Promise<RustPick> {
    const command = context
      ? JSON.stringify({ cmd: 'analyze', fen, initialFen: context.initialFen, moves: context.moves })
      : fen;
    return JSON.parse(await this.request(command, 120_000)) as RustPick;
  }

  /** Search with a per-request wall-clock budget via `go <ms> <fen>` (the
   * process's depth acts as the cap — spawn with a high cap for clock mode). */
  async analyzeTimed(fen: string, budgetMs: number, context?: RustPositionContext): Promise<RustPick> {
    const cappedBudgetMs = Math.max(50, Math.round(budgetMs));
    const command = context
      ? JSON.stringify({ cmd: 'go', budgetMs: cappedBudgetMs, fen, initialFen: context.initialFen, moves: context.moves })
      : `go ${cappedBudgetMs} ${fen}`;
    return JSON.parse(await this.request(command, Math.max(5_000, cappedBudgetMs + 5_000))) as RustPick;
  }

  /** Static eval (White-POV rounded cp; exact TS-eval parity) via `eval <fen>`. */
  async evalStatic(fen: string): Promise<number> {
    const out = JSON.parse(await this.request('eval ' + fen, 10_000)) as { evalWhiteCp?: number; error?: string };
    if (typeof out.evalWhiteCp === 'number') return out.evalWhiteCp;
    throw new Error(out.error ?? 'eval failed');
  }

  private request(command: string, timeoutMs: number): Promise<string> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      const pending: PendingRequest = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.fail(new Error(`Rust engine request timed out after ${timeoutMs}ms`));
          this.proc.kill();
        }, timeoutMs),
      };
      pending.timer.unref?.();
      this.queue.push(pending);
      this.proc.stdin.write(command + '\n', (error) => {
        if (error) this.fail(new Error(`Rust engine stdin failed: ${error.message}`));
      });
    });
  }

  private fail(error: Error): void {
    if (this.failed) return;
    this.failed = error;
    for (const pending of this.queue.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  dispose(): void {
    this.fail(new Error('Rust engine disposed'));
    try {
      this.proc.stdin.write('quit\n');
      this.proc.kill();
    } catch {
      /* already gone */
    }
  }
}
