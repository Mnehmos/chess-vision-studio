import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface, type Interface } from 'node:readline';
import type { Plugin } from 'vite';
import { readJsonBody, sendJson as json } from './http';
import { parseStockfishBestMove, parseStockfishInfoLine } from './stockfish-uci';

interface SfResult {
  fen: string;
  bestmove: string;
  scoreCp: number;
  mate: number | null;
  pv: string[];
  depth: number;
}

interface SfPending {
  fen: string;
  depth: number;
  movetimeMs?: number;
  forcedMove?: string;
  resolve: (r: SfResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  best: { depth: number; scoreCp: number; mate: number | null; pv: string[] } | null;
}

interface SfProcess {
  child: ChildProcessWithoutNullStreams;
  rl: Interface;
  ready: boolean;
  busy: boolean;
  queue: SfPending[];
  current: SfPending | null;
  stderr: string[];
}

// Native Stockfish, the leakage-free reference oracle, as a pooled UCI
// subprocess (mirrors cvsEngineProxy). Same model as the rust engine: the
// server hides the protocol, the client does one POST. Requires a native
// Stockfish binary (CVS_SF_EXE); defaults to the bundled avx2 build. Kept at
// one Threads=1 process by default so it never fights the depth-20 labeling.
export function stockfishProxy(env: Record<string, string>): Plugin {
  const LF = String.fromCharCode(10);
  let pool: SfProcess[] = [];
  let poolKey = '';
  const POOL_SIZE = Math.max(1, Math.min(4, Number(env.CVS_SF_POOL ?? 1) || 1));

  const sfConfig = () => {
    const exe =
      env.CVS_SF_EXE?.trim() || 'F:/tools/stockfish/stockfish/stockfish-windows-x86-64-avx2.exe';
    const depthRaw = Number(env.CVS_SF_DEPTH ?? 12);
    const depth = Number.isFinite(depthRaw) ? Math.max(1, Math.min(30, Math.round(depthRaw))) : 12;
    // Default 1 thread: matches CVS rust's single-threaded search for a fair
    // equal-threads comparison, and lets many processes run in parallel for
    // batch throughput. Override via CVS_SF_THREADS for deep single-position.
    const threads = Math.max(1, Math.min(32, Number(env.CVS_SF_THREADS ?? 1) || 1));
    const hash = Math.max(16, Number(env.CVS_SF_HASH ?? 128) || 128);
    return { exe, depth, threads, hash };
  };

  const send = (proc: SfProcess, ...cmds: string[]) => {
    for (const c of cmds) proc.child.stdin.write(c + LF);
  };

  const pump = (proc: SfProcess) => {
    if (!proc.ready || proc.busy || proc.queue.length === 0) return;
    const req = proc.queue.shift() as SfPending;
    proc.current = req;
    proc.busy = true;
    const searchmoves = req.forcedMove ? ` searchmoves ${req.forcedMove}` : '';
    send(
      proc,
      'ucinewgame',
      'setoption name Clear Hash',
      `position fen ${req.fen}`,
      req.movetimeMs ? `go movetime ${req.movetimeMs}${searchmoves}` : `go depth ${req.depth}${searchmoves}`,
    );
  };

  const finish = (proc: SfProcess, bestmove: string) => {
    const req = proc.current;
    proc.current = null;
    proc.busy = false;
    if (req) {
      clearTimeout(req.timer);
      const b = req.best;
      req.resolve({
        fen: req.fen,
        bestmove,
        scoreCp: b?.scoreCp ?? 0,
        mate: b?.mate ?? null,
        pv: b?.pv ?? [],
        depth: b?.depth ?? 0,
      });
    }
    pump(proc);
  };

  const createSf = (cfg: ReturnType<typeof sfConfig>): SfProcess => {
    const child = spawn(cfg.exe, [], { cwd: process.cwd(), stdio: 'pipe' });
    const rl = createInterface({ input: child.stdout });
    const proc: SfProcess = {
      child,
      rl,
      ready: false,
      busy: false,
      queue: [],
      current: null,
      stderr: [],
    };
    rl.on('line', (line) => {
      if (line.includes('uciok')) {
        send(
          proc,
          `setoption name Threads value ${cfg.threads}`,
          `setoption name Hash value ${cfg.hash}`,
          'isready',
        );
        return;
      }
      if (line.includes('readyok')) {
        proc.ready = true;
        pump(proc);
        return;
      }
      const info = parseStockfishInfoLine(line);
      if (proc.current && info) {
        proc.current.best = info;
        return;
      }
      const bestMove = parseStockfishBestMove(line);
      if (bestMove) finish(proc, bestMove);
    });
    child.stderr.on('data', (d) => {
      proc.stderr = [
        ...proc.stderr,
        ...String(d)
          .split(LF)
          .map((s) => s.trim())
          .filter(Boolean),
      ].slice(-20);
    });
    const fail = (err: Error) => {
      pool = pool.filter((p) => p !== proc);
      const pendings = proc.current ? [proc.current, ...proc.queue] : proc.queue;
      proc.current = null;
      proc.queue = [];
      for (const q of pendings) {
        clearTimeout(q.timer);
        q.reject(err);
      }
    };
    child.on('error', (e) => fail(e));
    child.on('close', (code) =>
      fail(
        new Error(
          `Stockfish exited (${code})${proc.stderr.length ? `: ${proc.stderr.join(' | ')}` : ''}`,
        ),
      ),
    );
    send(proc, 'uci');
    return proc;
  };

  const dispose = () => {
    const procs = pool;
    pool = [];
    for (const proc of procs) {
      const pendings = proc.current ? [proc.current, ...proc.queue] : proc.queue;
      for (const q of pendings) {
        clearTimeout(q.timer);
        q.reject(new Error('Stockfish stopped'));
      }
      try {
        send(proc, 'quit');
        proc.child.kill();
        proc.rl.close();
      } catch {
        // Already gone.
      }
    }
  };

  const acquireSf = (cfg: ReturnType<typeof sfConfig>): SfProcess => {
    const key = `${cfg.exe}:${cfg.depth}:${cfg.threads}:${cfg.hash}`;
    if (key !== poolKey) {
      dispose();
      poolKey = key;
    }
    pool = pool.filter((p) => !p.child.killed);
    if (pool.length < POOL_SIZE) pool.push(createSf(cfg));
    const load = (proc: SfProcess) => proc.queue.length + (proc.busy ? 1 : 0);
    return pool.reduce((best, proc) => (load(proc) < load(best) ? proc : best), pool[0]);
  };

  const request = (
    proc: SfProcess,
    fen: string,
    depth: number,
    movetimeMs?: number,
    forcedMove?: string,
  ): Promise<SfResult> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const ix = proc.queue.findIndex((p) => p.resolve === resolve);
        if (ix >= 0) proc.queue.splice(ix, 1);
        reject(new Error('Stockfish request timed out'));
      }, 30_000);
      proc.queue.push({ fen, depth, movetimeMs, forcedMove, resolve, reject, timer, best: null });
      pump(proc);
    });

  return {
    name: 'stockfish-proxy',
    configureServer(server) {
      server.httpServer?.on('close', dispose);
      server.middlewares.use('/api/stockfish/health', (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });
        const cfg = sfConfig();
        if (!existsSync(cfg.exe)) {
          return json(res, 200, {
            ok: true,
            available: false,
            exe: cfg.exe,
            depth: cfg.depth,
            error:
              'Native Stockfish not found. Set CVS_SF_EXE to a Stockfish .exe (download from stockfishchess.org).',
          });
        }
        return json(res, 200, { ok: true, available: true, exe: cfg.exe, depth: cfg.depth });
      });
      server.middlewares.use('/api/stockfish/analyze', (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        readJsonBody<{ fen?: string; depth?: number; movetimeMs?: number; forcedMove?: string }>(req)
          .then(async (body) => {
            const fen = body.fen?.trim();
            if (!fen) return json(res, 400, { error: 'fen is required' });
            const cfg = sfConfig();
            if (!existsSync(cfg.exe))
              return json(res, 503, { error: 'Native Stockfish not found', exe: cfg.exe });
            const depth = body.depth
              ? Math.max(1, Math.min(30, Math.round(body.depth)))
              : cfg.depth;
            const movetimeMs = body.movetimeMs
              ? Math.max(10, Math.min(10_000, Math.round(body.movetimeMs)))
              : undefined;
            const forcedMove = body.forcedMove?.trim();
            const out = await request(acquireSf(cfg), fen, depth, movetimeMs, forcedMove);
            return json(res, 200, out);
          })
          .catch((e) => json(res, 502, { error: String((e as Error)?.message ?? e) }));
      });
    },
  };
}
