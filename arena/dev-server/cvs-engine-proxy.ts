import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { createInterface, type Interface } from 'node:readline';
import type { Plugin } from 'vite';
import type { TeachingFactsRequestV1 } from '../../engine/teaching/types';
import { buildFeatureInspection } from '../../engine/analysis-frame';
import { readJsonBody, sendJson as json } from './http';

interface CvsEngineAnalyzeRequest {
  fen?: string;
  depth?: number;
  movetimeMs?: number;
  forcedMove?: string;
  // History-aware search (PR-04): repetition root + UCI line. Forwarded to the
  // engine's JSON request so the search root sees repetitions.
  initialFen?: string;
  moves?: string[];
}

interface CvsEnginePending {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  settled: boolean;
}

export interface CvsLineDispatcher {
  request(line: string): Promise<string>;
  handleLine(line: string): void;
  fail(error: Error): void;
  pendingCount(): number;
}

export function cvsEngineFeatureFlags(env: Record<string, string>): string[] {
  const flags: string[] = [];
  const add = (envKey: string, flag: string, defaultOn = false) => {
    const value = env[envKey];
    if ((defaultOn && value !== '0') || (!defaultOn && value === '1')) {
      flags.push(flag);
    }
  };
  const runtime = cvsEngineRuntime(env);
  add('CVS_RUST_ALLOW_UNVERIFIED', '--allow-unverified-net');
  add('CVS_RUST_FUTILITY', '--futility', true);
  add('CVS_RUST_RFP', '--rfp');
  add('CVS_RUST_LMP', '--lmp');
  add('CVS_RUST_SEEPRUNE', '--seeprune');
  add('CVS_RUST_DELTA', '--delta');
  add('CVS_RUST_COUNTERMOVE', '--countermove');
  add('CVS_RUST_CONTHIST', '--conthist');
  add('CVS_RUST_TTPS', '--tt-prune-store');
  add('CVS_RUST_QTT', '--qtt');
  add('CVS_RUST_HISTMALUS', '--histmalus');
  add('CVS_RUST_HISTLMR', '--histlmr');
  add('CVS_RUST_CAPHIST', '--caphist');
  add('CVS_RUST_TT2', '--tt2');
  add('CVS_RUST_IMPROVING', '--improving');
  add('CVS_RUST_RULE50', '--rule50');
  add('CVS_RUST_SINGULAR', '--singular');
  add('CVS_RUST_SMARTTIME', '--smarttime');
  if (runtime.threads > 1) flags.push('--threads', String(runtime.threads));
  if (runtime.cvsHelpers > 0) flags.push('--cvs-helpers', String(runtime.cvsHelpers));
  return flags;
}

function intEnv(
  env: Record<string, string>,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const raw = env[key]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function cvsEngineRuntime(env: Record<string, string>): {
  threads: number;
  cvsHelpers: number;
} {
  const explicitThreads = intEnv(env, 'CVS_RUST_THREADS', 1, 32);
  const requestedHelpers = intEnv(env, 'CVS_RUST_CVS_HELPERS', 0, 31) ?? 0;
  const threads = explicitThreads ?? (requestedHelpers > 0 ? requestedHelpers + 1 : 1);
  return {
    threads,
    cvsHelpers: Math.min(requestedHelpers, Math.max(0, threads - 1)),
  };
}

export function cvsEnginePoolSize(cpuCount: number, engineThreads: number): number {
  const usableCores = Math.max(1, (cpuCount || 4) - 2);
  return Math.max(1, Math.min(8, Math.floor(usableCores / Math.max(1, engineThreads))));
}

export function createCvsLineDispatcher(
  writeLine: (line: string) => void,
  timeoutMs = 20_000,
): CvsLineDispatcher {
  const queue: CvsEnginePending[] = [];

  return {
    request(line) {
      return new Promise((resolve, reject) => {
        const pending: CvsEnginePending = {
          resolve,
          reject,
          settled: false,
          timer: setTimeout(() => {
            pending.settled = true;
            reject(new Error('CVS Engine request timed out'));
          }, timeoutMs),
        };
        queue.push(pending);
        try {
          writeLine(line);
        } catch (error) {
          queue.pop();
          clearTimeout(pending.timer);
          pending.settled = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    handleLine(line) {
      const pending = queue.shift();
      if (!pending) return;
      clearTimeout(pending.timer);
      if (!pending.settled) {
        pending.settled = true;
        pending.resolve(line);
      }
    },
    fail(error) {
      for (const pending of queue.splice(0)) {
        clearTimeout(pending.timer);
        if (!pending.settled) {
          pending.settled = true;
          pending.reject(error);
        }
      }
    },
    pendingCount() {
      return queue.length;
    },
  };
}

interface CvsEngineProcess {
  child: ChildProcessWithoutNullStreams;
  rl: Interface;
  depth: number;
  argsKey: string;
  poolKey: string;
  dispatcher: CvsLineDispatcher;
  stderr: string[];
}

export function cvsEngineProxy(env: Record<string, string>): Plugin {
  // The rust engine is a serial stdin->stdout subprocess (one FEN at a time).
  // A least-loaded POOL of them parallelizes bulk analysis across cores while
  // staying 100% rust. Light use stays at one process; bulk fans out.
  const pools = new Map<string, CvsEngineProcess[]>();

  const dispose = () => {
    const procs = [...pools.values()].flat();
    pools.clear();
    for (const proc of procs) {
      proc.dispatcher.fail(new Error('CVS Engine process stopped'));
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
    const runtime = options.factsOnly ? { threads: 1, cvsHelpers: 0 } : cvsEngineRuntime(env);

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

    if (!options.factsOnly) {
      flags.push(...cvsEngineFeatureFlags(env));
      args.push(...flags);
    }

    return { exe, depth, args, argsKey: JSON.stringify(args), missing, flags, runtime };
  };

  const createProc = (cfg: ReturnType<typeof configFor>, poolKey: string): CvsEngineProcess => {
    const child = spawn(cfg.exe, cfg.args, { cwd: process.cwd(), stdio: 'pipe' });
    const rl = createInterface({ input: child.stdout });
    const dispatcher = createCvsLineDispatcher((line) => child.stdin.write(`${line}\n`));
    const proc: CvsEngineProcess = {
      child,
      rl,
      depth: cfg.depth,
      argsKey: cfg.argsKey,
      poolKey,
      dispatcher,
      stderr: [],
    };
    rl.on('line', (line) => proc.dispatcher.handleLine(line));
    child.stderr.on('data', (data) => {
      proc.stderr = [...proc.stderr, ...String(data).split(/\r?\n/).filter(Boolean)].slice(-20);
    });
    child.on('error', (error) => {
      proc.dispatcher.fail(error);
    });
    child.on('close', (code) => {
      pools.set(
        proc.poolKey,
        (pools.get(proc.poolKey) ?? []).filter((candidate) => candidate !== proc),
      );
      const suffix = proc.stderr.length ? `: ${proc.stderr.join(' | ')}` : '';
      proc.dispatcher.fail(new Error(`CVS Engine exited with code ${code}${suffix}`));
    });
    return proc;
  };

  // Each executable/config gets its own least-loaded pool. This lets the app
  // keep a pinned comparison binary while facts use the current protocol binary.
  const acquireEngine = (cfg: ReturnType<typeof configFor>): CvsEngineProcess => {
    const key = `${cfg.exe}:${cfg.argsKey}`;
    const pool = (pools.get(key) ?? []).filter((proc) => !proc.child.killed);
    const poolSize = cvsEnginePoolSize(cpus().length || 4, cfg.runtime.threads);
    if (pool.length < poolSize) pool.push(createProc(cfg, key));
    pools.set(key, pool);
    return pool.reduce(
      (best, proc) =>
        proc.dispatcher.pendingCount() < best.dispatcher.pendingCount() ? proc : best,
      pool[0],
    );
  };

  const requestEngine = (proc: CvsEngineProcess, line: string): Promise<string> =>
    proc.dispatcher.request(line);

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
            // A movetime (timed) search must not be capped by the default --depth, or
            // the engine returns early at that shallow depth instead of spending its
            // time budget. Start it at the max depth ceiling so TIME is the binding
            // constraint (this is what makes the "equal 1000ms" comparison real).
            const cfg = configFor(body.movetimeMs ? 30 : body.depth);
            if (!existsSync(cfg.exe))
              return json(res, 503, { error: 'CVS Engine binary not found', exe: cfg.exe });
            if (cfg.missing.length)
              return json(res, 503, {
                error: `Configured CVS Engine files are missing: ${cfg.missing.join(', ')}`,
              });
            const proc = acquireEngine(cfg);
            const forcedMove = body.forcedMove?.trim();
            const hasHistory = Array.isArray(body.moves) && body.moves.length > 0;
            let line = '';
            if (forcedMove || hasHistory) {
              // JSON request carries repetition history and/or a forced root move.
              const reqObj = {
                cmd: body.movetimeMs ? 'go' : 'analyze',
                fen: fen,
                initialFen: hasHistory ? (body.initialFen ?? 'startpos') : undefined,
                moves: hasHistory ? body.moves : undefined,
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

      // Developer feature inspection (PR-12): combine the engine's existing `cvs`
      // (feature registry) and `eval` (classical + optional NNUE) serve commands
      // into one CvsFeatureInspectionV1. No rust change required.
      server.middlewares.use('/api/cvs-engine/inspect', (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        readJsonBody<{ fen?: string }>(req)
          .then(async (body) => {
            const fen = body.fen?.trim();
            if (!fen) return json(res, 400, { error: 'fen is required' });
            const cfg = configFor();
            if (!existsSync(cfg.exe))
              return json(res, 503, { error: 'CVS Engine binary not found', exe: cfg.exe });
            if (cfg.missing.length)
              return json(res, 503, {
                error: `Configured CVS Engine files are missing: ${cfg.missing.join(', ')}`,
              });
            const proc = acquireEngine(cfg);
            const cvsOut = await requestEngine(proc, `cvs ${fen}`);
            const evalOut = await requestEngine(proc, `eval ${fen}`);
            let cvsParsed: Record<string, unknown>;
            let evalParsed: Record<string, unknown>;
            try {
              cvsParsed = JSON.parse(cvsOut) as Record<string, unknown>;
              evalParsed = JSON.parse(evalOut) as Record<string, unknown>;
            } catch {
              return json(res, 502, {
                error: 'CVS Engine returned non-JSON output',
                cvsOut,
                evalOut,
              });
            }
            if ('error' in cvsParsed) return json(res, 422, cvsParsed);
            if ('error' in evalParsed) return json(res, 422, evalParsed);
            const inspection = buildFeatureInspection({
              fen,
              evalWhiteCp: Number(evalParsed.evalWhiteCp),
              nnueStmCp: typeof evalParsed.nnueStmCp === 'number' ? evalParsed.nnueStmCp : null,
              registryVersion: Number(cvsParsed.registryVersion),
              registryHash: String(cvsParsed.registryHash),
              inputDim: Number(cvsParsed.inputDim),
              activeIds: Array.isArray(cvsParsed.activeIds)
                ? (cvsParsed.activeIds as number[])
                : [],
              activeNames: Array.isArray(cvsParsed.activeNames)
                ? (cvsParsed.activeNames as string[])
                : [],
            });
            return json(res, 200, inspection);
          })
          .catch((e) => json(res, 502, { error: String((e as Error)?.message ?? e) }));
      });
    },
  };
}
