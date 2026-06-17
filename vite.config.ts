/// <reference types="vitest" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { cpus } from 'node:os';
import type { TeachingFactsRequestV1 } from './engine/teaching/types';
import { killProcessTree, npmCommand, readJsonBody, sendJson as json } from './arena/dev-server/http';
import { openaiProxy } from './arena/dev-server/openai-proxy';

interface CvsEngineAnalyzeRequest {
  fen?: string;
  depth?: number;
  movetimeMs?: number;
  forcedMove?: string;
}

interface CvsEnginePending {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface CvsEngineProcess {
  child: ChildProcessWithoutNullStreams;
  rl: Interface;
  depth: number;
  argsKey: string;
  poolKey: string;
  queue: CvsEnginePending[];
  stderr: string[];
}

function cvsEngineProxy(env: Record<string, string>): Plugin {
  // The rust engine is a serial stdin->stdout subprocess (one FEN at a time).
  // A least-loaded POOL of them parallelizes bulk analysis across cores while
  // staying 100% rust. Light use stays at one process; bulk fans out.
  const pools = new Map<string, CvsEngineProcess[]>();
  const POOL_SIZE = Math.max(2, Math.min(8, (cpus().length || 4) - 2));

  const dispose = () => {
    const procs = [...pools.values()].flat();
    pools.clear();
    for (const proc of procs) {
      for (const pending of proc.queue.splice(0)) {
        clearTimeout(pending.timer);
        pending.reject(new Error('CVS Engine process stopped'));
      }
      try {
        proc.child.stdin.write('quit\n');
        proc.child.kill();
        proc.rl.close();
      } catch {
        // Already gone.
      }
    }
  };

  const configFor = (
    requestedDepth?: number,
    options: { exe?: string; factsOnly?: boolean } = {},
  ) => {
    const analyzeBin = process.platform === 'win32' ? 'analyze.exe' : 'analyze';
    const exe =
      options.exe?.trim() ||
      env.CVS_RUST_EXE?.trim() ||
      `../chess-vision-studio-rust-engine/target/release/${analyzeBin}`;
    const depthRaw = Number(requestedDepth ?? (options.factsOnly ? 1 : (env.CVS_RUST_DEPTH ?? 6)));
    const depth = Number.isFinite(depthRaw) ? Math.max(1, Math.min(30, Math.round(depthRaw))) : 6;
    const args = ['--serve', '--depth', String(depth)];
    const missing: string[] = [];
    const flags: string[] = [];

    const addFileArg = (
      flag: string,
      path: string | undefined,
      label: string,
      required: boolean,
    ) => {
      const clean = path?.trim();
      if (!clean) return;
      if (!existsSync(clean)) {
        if (required) missing.push(`${label}: ${clean}`);
        return;
      }
      args.push(flag, clean);
    };

    if (!options.factsOnly) {
      addFileArg(
        '--base',
        env.CVS_RUST_BASE || 'arena/out/value-weights-mixed.json',
        'base weights',
        !!env.CVS_RUST_BASE,
      );
      addFileArg(
        '--rung2',
        env.CVS_RUST_RUNG2 || 'arena/out/rung2-weights-mixed.json',
        'rung2 weights',
        !!env.CVS_RUST_RUNG2,
      );
      addFileArg('--nnue', env.CVS_RUST_NNUE, 'nnue', !!env.CVS_RUST_NNUE);
      addFileArg(
        '--helper-nnue',
        env.CVS_RUST_HELPER_NNUE,
        'helper nnue',
        !!env.CVS_RUST_HELPER_NNUE,
      );
    }

    const addFlag = (envKey: string, flag: string, defaultOn = false) => {
      const value = env[envKey];
      if ((defaultOn && value !== '0') || (!defaultOn && value === '1')) {
        args.push(flag);
        flags.push(flag);
      }
    };
    if (!options.factsOnly) {
      addFlag('CVS_RUST_FUTILITY', '--futility', true);
      addFlag('CVS_RUST_RFP', '--rfp');
      addFlag('CVS_RUST_LMP', '--lmp');
      addFlag('CVS_RUST_SEEPRUNE', '--seeprune');
      addFlag('CVS_RUST_DELTA', '--delta');
      addFlag('CVS_RUST_COUNTERMOVE', '--countermove');
      addFlag('CVS_RUST_CONTHIST', '--conthist');
      addFlag('CVS_RUST_TTPS', '--tt-prune-store');
      addFlag('CVS_RUST_QTT', '--qtt');
      addFlag('CVS_RUST_HISTMALUS', '--histmalus');
      addFlag('CVS_RUST_HISTLMR', '--histlmr');
      addFlag('CVS_RUST_CAPHIST', '--caphist');
      addFlag('CVS_RUST_TT2', '--tt2');
      addFlag('CVS_RUST_IMPROVING', '--improving');
      addFlag('CVS_RUST_RULE50', '--rule50');
    }

    return { exe, depth, args, argsKey: JSON.stringify(args), missing, flags };
  };

  const createProc = (cfg: ReturnType<typeof configFor>, poolKey: string): CvsEngineProcess => {
    const child = spawn(cfg.exe, cfg.args, { cwd: process.cwd(), stdio: 'pipe' });
    const rl = createInterface({ input: child.stdout });
    const proc: CvsEngineProcess = {
      child,
      rl,
      depth: cfg.depth,
      argsKey: cfg.argsKey,
      poolKey,
      queue: [],
      stderr: [],
    };
    rl.on('line', (line) => {
      const next = proc.queue.shift();
      if (!next) return;
      clearTimeout(next.timer);
      next.resolve(line);
    });
    child.stderr.on('data', (data) => {
      proc.stderr = [...proc.stderr, ...String(data).split(/\r?\n/).filter(Boolean)].slice(-20);
    });
    child.on('error', (error) => {
      for (const pending of proc.queue.splice(0)) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
    });
    child.on('close', (code) => {
      pools.set(
        proc.poolKey,
        (pools.get(proc.poolKey) ?? []).filter((candidate) => candidate !== proc),
      );
      const suffix = proc.stderr.length ? `: ${proc.stderr.join(' | ')}` : '';
      for (const pending of proc.queue.splice(0)) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`CVS Engine exited with code ${code}${suffix}`));
      }
    });
    return proc;
  };

  // Each executable/config gets its own least-loaded pool. This lets the app
  // keep a pinned comparison binary while facts use the current protocol binary.
  const acquireEngine = (cfg: ReturnType<typeof configFor>): CvsEngineProcess => {
    const key = `${cfg.exe}:${cfg.argsKey}`;
    const pool = (pools.get(key) ?? []).filter((proc) => !proc.child.killed);
    if (pool.length < POOL_SIZE) pool.push(createProc(cfg, key));
    pools.set(key, pool);
    return pool.reduce(
      (best, proc) => (proc.queue.length < best.queue.length ? proc : best),
      pool[0],
    );
  };

  const requestEngine = (proc: CvsEngineProcess, line: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const ix = proc.queue.findIndex((p) => p.resolve === resolve);
        if (ix >= 0) proc.queue.splice(ix, 1);
        reject(new Error('CVS Engine request timed out'));
      }, 20_000);
      proc.queue.push({ resolve, reject, timer });
      proc.child.stdin.write(`${line}\n`);
    });

  return {
    name: 'cvs-engine-proxy',
    configureServer(server) {
      server.httpServer?.on('close', dispose);
      server.middlewares.use('/api/cvs-engine/health', (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });
        const cfg = configFor();
        if (!existsSync(cfg.exe)) {
          return json(res, 200, {
            ok: true,
            available: false,
            exe: cfg.exe,
            depth: cfg.depth,
            flags: cfg.flags,
            error:
              'CVS Engine binary not found. Build chess-vision-studio-rust-engine with cargo build --release.',
          });
        }
        if (cfg.missing.length) {
          return json(res, 200, {
            ok: true,
            available: false,
            exe: cfg.exe,
            depth: cfg.depth,
            flags: cfg.flags,
            error: `Configured CVS Engine files are missing: ${cfg.missing.join(', ')}`,
          });
        }
        return json(res, 200, {
          ok: true,
          available: true,
          exe: cfg.exe,
          depth: cfg.depth,
          flags: cfg.flags,
        });
      });

      server.middlewares.use('/api/cvs-engine/analyze', (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        readJsonBody<CvsEngineAnalyzeRequest>(req)
          .then(async (body) => {
            const fen = body.fen?.trim();
            if (!fen) return json(res, 400, { error: 'fen is required' });
            const cfg = configFor(body.depth);
            if (!existsSync(cfg.exe))
              return json(res, 503, { error: 'CVS Engine binary not found', exe: cfg.exe });
            if (cfg.missing.length)
              return json(res, 503, {
                error: `Configured CVS Engine files are missing: ${cfg.missing.join(', ')}`,
              });
            const proc = acquireEngine(cfg);
            const forcedMove = body.forcedMove?.trim();
            let line = '';
            if (forcedMove) {
              const reqObj = {
                cmd: body.movetimeMs ? 'go' : 'analyze',
                fen: fen,
                budgetMs: body.movetimeMs ? Math.max(50, Math.round(body.movetimeMs)) : undefined,
                forcedMoveUci: forcedMove,
              };
              line = JSON.stringify(reqObj);
            } else {
              line = body.movetimeMs
                ? `go ${Math.max(50, Math.round(body.movetimeMs))} ${fen}`
                : fen;
            }
            const out = await requestEngine(proc, line);
            let parsed: unknown;
            try {
              parsed = JSON.parse(out);
            } catch {
              return json(res, 502, { error: 'CVS Engine returned non-JSON output', output: out });
            }
            if (typeof parsed === 'object' && parsed && 'error' in parsed)
              return json(res, 422, parsed);
            return json(res, 200, parsed);
          })
          .catch((e) => json(res, 502, { error: String((e as Error)?.message ?? e) }));
      });

      server.middlewares.use('/api/cvs-engine/facts', (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        readJsonBody<TeachingFactsRequestV1>(req)
          .then(async (body) => {
            if (body.schemaVersion !== 1) {
              return json(res, 400, {
                error: `Unsupported teaching facts schemaVersion ${body.schemaVersion}`,
              });
            }
            if (!body.fenBefore?.trim() || !body.playedMoveUci?.trim()) {
              return json(res, 400, { error: 'fenBefore and playedMoveUci are required' });
            }
            const analyzeBin = process.platform === 'win32' ? 'analyze.exe' : 'analyze';
            const factsExe =
              env.CVS_RUST_FACTS_EXE?.trim() ||
              `../chess-vision-studio-rust-engine/target/release/${analyzeBin}`;
            const cfg = configFor(1, { exe: factsExe, factsOnly: true });
            if (!existsSync(cfg.exe))
              return json(res, 503, { error: 'CVS Engine binary not found', exe: cfg.exe });
            if (cfg.missing.length) {
              return json(res, 503, {
                error: `Configured CVS Engine files are missing: ${cfg.missing.join(', ')}`,
              });
            }
            const out = await requestEngine(
              acquireEngine(cfg),
              JSON.stringify({ ...body, cmd: 'facts' }),
            );
            let parsed: unknown;
            try {
              parsed = JSON.parse(out);
            } catch {
              return json(res, 502, { error: 'CVS Engine returned non-JSON output', output: out });
            }
            if (typeof parsed === 'object' && parsed && 'error' in parsed)
              return json(res, 422, parsed);
            return json(res, 200, parsed);
          })
          .catch((e) => json(res, 502, { error: String((e as Error)?.message ?? e) }));
      });
    },
  };
}

type TrainingPhase = 'idle' | 'importing' | 'training' | 'done' | 'error' | 'stopped';

interface TrainingStartConfig {
  mode?: 'import-train' | 'train-only';
  input?: string;
  datasetOut?: string;
  weightsOut?: string;
  reportOut?: string;
  depth?: number;
  limit?: number;
  maxPlies?: number;
  minElo?: number;
  sampleEvery?: number;
  epochs?: number;
}

interface TrainingStatus {
  phase: TrainingPhase;
  active: boolean;
  startedAt: string | null;
  endedAt: string | null;
  config: Required<TrainingStartConfig>;
  import: { seen: number; imported: number; skipped: number; rows: number; limit: number };
  train: {
    trainRows: number;
    holdoutRows: number;
    baselineTop1: number | null;
    tunedTop1: number | null;
  };
  error: string;
  logs: string[];
}

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
function stockfishProxy(env: Record<string, string>): Plugin {
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
      if (
        proc.current &&
        line.startsWith('info ') &&
        line.includes(' score ') &&
        line.includes(' pv ')
      ) {
        const t = line.split(/\s+/);
        const di = t.indexOf('depth');
        const si = t.indexOf('score');
        const pi = t.indexOf('pv');
        let scoreCp = 0;
        let mate: number | null = null;
        if (si >= 0 && t[si + 1] === 'cp') scoreCp = Number(t[si + 2]);
        else if (si >= 0 && t[si + 1] === 'mate') mate = Number(t[si + 2]);
        proc.current.best = {
          depth: di >= 0 ? Number(t[di + 1]) : 0,
          scoreCp,
          mate,
          pv: pi >= 0 ? t.slice(pi + 1) : [],
        };
        return;
      }
      if (line.startsWith('bestmove')) finish(proc, line.split(/\s+/)[1] ?? '(none)');
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

function trainingSupervisor(): Plugin {
  const clients = new Set<import('http').ServerResponse>();
  let current: {
    child: ChildProcessWithoutNullStreams | null;
    zstd: ChildProcessWithoutNullStreams | null;
    stopRequested: boolean;
  } | null = null;
  let status: TrainingStatus = idleStatus();

  const broadcast = () => {
    const payload = `data: ${JSON.stringify(status)}\n\n`;
    for (const c of clients) c.write(payload);
  };
  const log = (line: string) => {
    const text = line.trimEnd();
    if (!text) return;
    status.logs = [...status.logs, text].slice(-300);
    parseProgress(text, status);
    broadcast();
  };
  const setPhase = (phase: TrainingPhase, error = '') => {
    status.phase = phase;
    status.active = phase === 'importing' || phase === 'training';
    status.error = error;
    if (!status.startedAt && status.active) status.startedAt = new Date().toISOString();
    if (!status.active && phase !== 'idle') status.endedAt = new Date().toISOString();
    broadcast();
  };

  async function runPipeline(cfg: Required<TrainingStartConfig>) {
    try {
      if (cfg.mode === 'import-train') {
        setPhase('importing');
        await runImport(cfg, log, (child, zstd) => {
          current = { child, zstd, stopRequested: current?.stopRequested ?? false };
        });
      }
      if (current?.stopRequested) {
        setPhase('stopped');
        return;
      }
      setPhase('training');
      await runTrain(cfg, log, (child) => {
        current = { child, zstd: null, stopRequested: current?.stopRequested ?? false };
      });
      readTrainReport(cfg.reportOut, status);
      current = null;
      setPhase('done');
    } catch (e) {
      const message = String((e as Error)?.message ?? e);
      const stopped = current?.stopRequested ?? false;
      log(message);
      current = null;
      setPhase(stopped ? 'stopped' : 'error', message);
    }
  }

  return {
    name: 'training-supervisor',
    configureServer(server) {
      server.middlewares.use('/api/training/events', (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.write(`data: ${JSON.stringify(status)}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
      });
      server.middlewares.use('/api/training/status', (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });
        json(res, 200, status);
      });
      server.middlewares.use('/api/training/start', (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        if (status.active) return json(res, 409, { error: 'training job already running' });
        readJsonBody<TrainingStartConfig>(req)
          .then((body) => {
            const cfg = normalizeTrainingConfig(body);
            status = idleStatus(cfg);
            current = { child: null, zstd: null, stopRequested: false };
            void runPipeline(cfg);
            json(res, 200, status);
          })
          .catch((e) => json(res, 400, { error: String((e as Error)?.message ?? e) }));
      });
      server.middlewares.use('/api/training/stop', (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        if (current) {
          current.stopRequested = true;
          killProcessTree(current.child);
          killProcessTree(current.zstd);
          log('stop requested');
        }
        setPhase('stopped');
        json(res, 200, status);
      });
    },
  };
}

function idleStatus(
  config: Required<TrainingStartConfig> = normalizeTrainingConfig({}),
): TrainingStatus {
  return {
    phase: 'idle',
    active: false,
    startedAt: null,
    endedAt: null,
    config,
    import: { seen: 0, imported: 0, skipped: 0, rows: 0, limit: config.limit },
    train: { trainRows: 0, holdoutRows: 0, baselineTop1: null, tunedTop1: null },
    error: '',
    logs: [],
  };
}

function normalizeTrainingConfig(raw: TrainingStartConfig): Required<TrainingStartConfig> {
  const num = (v: number | undefined, fallback: number) =>
    Number.isFinite(v) && v !== undefined ? v : fallback;
  return {
    mode: raw.mode ?? 'import-train',
    input: raw.input?.trim() || 'fixtures/sample-game.pgn',
    datasetOut: raw.datasetOut?.trim() || 'arena/out/lichess-master-dataset.jsonl',
    weightsOut: raw.weightsOut?.trim() || 'arena/out/weights.json',
    reportOut: raw.reportOut?.trim() || 'arena/out/train-report.json',
    depth: num(raw.depth, 10),
    limit: num(raw.limit, 50),
    maxPlies: num(raw.maxPlies, 80),
    minElo: num(raw.minElo, 2200),
    sampleEvery: Math.max(1, num(raw.sampleEvery, 1)),
    epochs: num(raw.epochs, 120),
  };
}

function runImport(
  cfg: Required<TrainingStartConfig>,
  log: (line: string) => void,
  onChild: (
    child: ChildProcessWithoutNullStreams,
    zstd: ChildProcessWithoutNullStreams | null,
  ) => void,
): Promise<void> {
  const zst = /\.zst$/i.test(cfg.input);
  const args = [
    'run',
    'lichess:import',
    '--',
    zst ? '-' : cfg.input,
    '--out',
    cfg.datasetOut,
    '--depth',
    String(cfg.depth),
    '--limit',
    String(cfg.limit),
    '--max-plies',
    String(cfg.maxPlies),
    '--min-elo',
    String(cfg.minElo),
    '--sample-every',
    String(cfg.sampleEvery),
  ];
  const child = spawn(npmCommand(), args, { cwd: process.cwd(), stdio: 'pipe' });
  let zstd: ChildProcessWithoutNullStreams | null = null;
  if (zst) {
    zstd = spawn('zstd', ['-dc', cfg.input], { cwd: process.cwd(), stdio: 'pipe' });
    zstd.stdout.pipe(child.stdin);
    zstd.stderr.on('data', (d) => log(String(d)));
    zstd.on('error', (e) => {
      log(`zstd failed: ${String(e.message)}`);
      child.stdin.destroy(e);
    });
    zstd.on('close', (code) => {
      if (code && !child.killed) child.stdin.destroy(new Error(`zstd exited with code ${code}`));
    });
  } else {
    child.stdin.end();
  }
  onChild(child, zstd);
  return waitFor(child, log, 'import');
}

function runTrain(
  cfg: Required<TrainingStartConfig>,
  log: (line: string) => void,
  onChild: (child: ChildProcessWithoutNullStreams) => void,
): Promise<void> {
  const args = [
    'run',
    'dataset:train',
    '--',
    cfg.datasetOut,
    '--out',
    cfg.weightsOut,
    '--report',
    cfg.reportOut,
    '--epochs',
    String(cfg.epochs),
  ];
  const child = spawn(npmCommand(), args, { cwd: process.cwd(), stdio: 'pipe' });
  child.stdin.end();
  onChild(child);
  return waitFor(child, log, 'train');
}

function waitFor(
  child: ChildProcessWithoutNullStreams,
  log: (line: string) => void,
  label: string,
): Promise<void> {
  child.stdout.on('data', (d) => String(d).split(/\r?\n/).forEach(log));
  child.stderr.on('data', (d) => String(d).split(/\r?\n/).forEach(log));
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

function parseProgress(line: string, status: TrainingStatus): void {
  const imported = /imported game\s+(\d+)\/(\d+):.*\((\d+)\s+rows\)/.exec(line);
  if (imported) {
    status.import.imported = Number(imported[1]);
    status.import.limit = Number(imported[2]);
    status.import.rows += Number(imported[3]);
  }
  const done = /done:\s+seen=(\d+),\s+imported=(\d+),\s+skipped=(\d+),\s+rows=(\d+)/.exec(line);
  if (done) {
    status.import.seen = Number(done[1]);
    status.import.imported = Number(done[2]);
    status.import.skipped = Number(done[3]);
    status.import.rows = Number(done[4]);
  }
  const trained =
    /trained\s+(\d+)\s+rows,\s+holdout\s+(\d+):\s+top-1\s+([\d.]+)%\s+->\s+([\d.]+)%/.exec(line);
  if (trained) {
    status.train.trainRows = Number(trained[1]);
    status.train.holdoutRows = Number(trained[2]);
    status.train.baselineTop1 = Number(trained[3]) / 100;
    status.train.tunedTop1 = Number(trained[4]) / 100;
  }
}

function readTrainReport(path: string, status: TrainingStatus): void {
  if (!existsSync(path)) return;
  try {
    const report = JSON.parse(readFileSync(path, 'utf8')) as {
      trainRows?: number;
      holdoutRows?: number;
      baseline?: { top1Match?: number };
      tuned?: { top1Match?: number };
    };
    status.train.trainRows = report.trainRows ?? status.train.trainRows;
    status.train.holdoutRows = report.holdoutRows ?? status.train.holdoutRows;
    status.train.baselineTop1 = report.baseline?.top1Match ?? status.train.baselineTop1;
    status.train.tunedTop1 = report.tuned?.top1Match ?? status.train.tunedTop1;
  } catch {
    // Report is optional; stdout parsing still gives the monitor useful data.
  }
}

// Stockfish WASM needs cross-origin isolation (SharedArrayBuffer) in the browser.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ''); // '' = load ALL vars, incl. non-VITE_
  return {
    plugins: [
      react(),
      openaiProxy(env),
      cvsEngineProxy(env),
      stockfishProxy(env),
      trainingSupervisor(),
    ],
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    test: {
      globals: true,
      environment: 'node',
      include: [
        'engine/**/*.test.ts',
        'app/**/*.test.ts',
        'app/**/*.test.tsx',
        'llm/**/*.test.ts',
        'arena/**/*.test.ts',
      ],
      testTimeout: 30000,
    },
  };
});
