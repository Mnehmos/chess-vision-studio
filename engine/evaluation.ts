// [3] Evaluation layer — UCI client over a pluggable transport.
// Stockfish is the ONLY async/environment dependency, and it is mockable
// (Invariant 1): the transport is the seam. Pure-logic tests inject a stub.
import { Chess } from 'chess.js';
import type { Eval } from './types';

/**
 * The engine seam. A transport speaks raw UCI text lines. The Node/browser
 * Stockfish builds and any test stub all implement this single interface.
 */
export interface EngineTransport {
  send(command: string): void;
  onLine(handler: (line: string) => void): void;
  dispose(): void;
}

/** Convert a UCI principal variation (e2e4 …) to SAN, replaying from `fen`. */
export function uciPvToSan(fen: string, uciMoves: string[]): string[] {
  const chess = new Chess(fen);
  const san: string[] = [];
  for (const uci of uciMoves) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci.slice(4, 5) : undefined;
    const move = chess.move({ from, to, promotion });
    if (!move) break; // PV occasionally over-runs; stop at first illegal
    san.push(move.san);
  }
  return san;
}

export interface EvalRequest {
  fen: string;
  depth: number;
  multipv?: number; // number of PV lines to request (forcing-move scan, §4a)
  timeoutMs?: number; // wall-clock cap; on expiry the search resolves 'unavailable' (no hang)
}

const DEFAULT_EVAL_TIMEOUT_MS = 20000;

export class UciEngine {
  private ready: Promise<void>;
  private lineHandlers: ((line: string) => void)[] = [];

  constructor(private transport: EngineTransport) {
    this.transport.onLine((line) => {
      for (const h of this.lineHandlers) h(line);
    });
    this.ready = this.handshake();
  }

  private handshake(): Promise<void> {
    return new Promise((resolve) => {
      const onLine = (line: string) => {
        if (line.includes('readyok')) {
          this.removeHandler(onLine);
          resolve();
        }
      };
      this.lineHandlers.push(onLine);
      this.transport.send('uci');
      this.transport.send('isready');
    });
  }

  private removeHandler(h: (line: string) => void): void {
    const i = this.lineHandlers.indexOf(h);
    if (i >= 0) this.lineHandlers.splice(i, 1);
  }

  // UCI cannot run overlapping searches: a second `go` before the first
  // `bestmove` corrupts the stream (this is the rapid-skip crash). Serialize all
  // engine access through a promise chain so requests run strictly one at a time.
  private chain: Promise<unknown> = Promise.resolve();
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task, task);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Evaluate at FIXED depth (deterministic across machines — §5 Step A). */
  async evaluate(req: EvalRequest): Promise<Eval> {
    const lines = await this.evaluateMultiPV({ ...req, multipv: req.multipv ?? 1 });
    return lines[0];
  }

  /** Returns one Eval per multipv line, ordered best-first. */
  evaluateMultiPV(req: EvalRequest): Promise<Eval[]> {
    return this.enqueue(() => this.runMultiPV(req));
  }

  private async runMultiPV(req: EvalRequest): Promise<Eval[]> {
    await this.ready;
    const multipv = req.multipv ?? 1;
    // Best info line seen per multipv index, keyed by depth completion.
    const byMultipv = new Map<number, { cp?: number; mate?: number; depth: number; pv: string[] }>();

    return new Promise<Eval[]>((resolve) => {
      let settled = false;
      const finish = (out: Eval[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.removeHandler(onLine);
        resolve(out);
      };
      const onLine = (line: string) => {
        if (line.startsWith('info') && line.includes(' pv ')) {
          const parsed = parseInfoLine(line);
          if (parsed && parsed.depth >= 1) {
            const prev = byMultipv.get(parsed.multipv);
            if (!prev || parsed.depth >= prev.depth) {
              byMultipv.set(parsed.multipv, {
                cp: parsed.cp,
                mate: parsed.mate,
                depth: parsed.depth,
                pv: uciPvToSan(req.fen, parsed.pvUci),
              });
            }
          }
        } else if (line.startsWith('bestmove')) {
          const out: Eval[] = [];
          for (let i = 1; i <= multipv; i++) {
            const r = byMultipv.get(i);
            if (r) out.push({ cp: r.cp, mate: r.mate, depth: r.depth, pv: r.pv });
          }
          // No parseable info line came back — the search produced nothing usable.
          // Flag it 'unavailable' so it is NEVER mistaken for a genuine 0.00 eval.
          if (out.length === 0) out.push({ depth: req.depth, pv: [], status: 'unavailable' });
          finish(out);
        }
      };
      // A stalled search must not hang forever; resolve an explicit 'unavailable'.
      const timer = setTimeout(() => {
        try {
          this.transport.send('stop');
        } catch {
          /* transport gone — ignore */
        }
        finish([{ depth: req.depth, pv: [], status: 'unavailable' }]);
      }, req.timeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS);
      this.lineHandlers.push(onLine);
      this.transport.send('ucinewgame');
      this.transport.send(`setoption name MultiPV value ${multipv}`);
      this.transport.send(`position fen ${req.fen}`);
      this.transport.send(`go depth ${req.depth}`);
    });
  }

  bestMove(fen: string, depth: number): Promise<string> {
    return this.enqueue(() => this.runBestMove(fen, depth));
  }

  private async runBestMove(fen: string, depth: number): Promise<string> {
    await this.ready;
    return new Promise<string>((resolve) => {
      const onLine = (line: string) => {
        if (line.startsWith('bestmove')) {
          this.removeHandler(onLine);
          resolve(line.split(/\s+/)[1] ?? '(none)');
        }
      };
      this.lineHandlers.push(onLine);
      this.transport.send('ucinewgame');
      this.transport.send(`position fen ${fen}`);
      this.transport.send(`go depth ${depth}`);
    });
  }

  dispose(): void {
    this.transport.dispose();
  }
}

interface ParsedInfo {
  depth: number;
  multipv: number;
  cp?: number;
  mate?: number;
  pvUci: string[];
}

/** Parse a UCI `info` line into score (side-to-move POV) + PV. */
export function parseInfoLine(line: string): ParsedInfo | null {
  const tokens = line.split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let cp: number | undefined;
  let mate: number | undefined;
  let pvUci: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'depth') depth = parseInt(tokens[i + 1], 10);
    else if (t === 'multipv') multipv = parseInt(tokens[i + 1], 10);
    else if (t === 'score') {
      const kind = tokens[i + 1];
      const val = parseInt(tokens[i + 2], 10);
      if (kind === 'cp') cp = val;
      else if (kind === 'mate') mate = val;
    } else if (t === 'pv') {
      pvUci = tokens.slice(i + 1);
      break;
    }
  }
  if (pvUci.length === 0) return null;
  return { depth, multipv, cp, mate, pvUci };
}
