/// <reference types="vitest" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * Dev-server OpenAI proxy. The key stays in .env (plain OPENAI_API_KEY, server-side)
 * and is injected here — it is NEVER sent to or bundled into the browser. The client
 * calls /api/openai/chat/completions (same origin) and we forward to OpenAI with the
 * Authorization header attached. This is why you keep a .env: no VITE_ prefix needed.
 */
function openaiProxy(env: Record<string, string>): Plugin {
  const key = env.OPENAI_API_KEY || '';
  const model = env.OPENAI_MODEL || 'gpt-5.5';
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const json = (res: import('http').ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  return {
    name: 'openai-proxy',
    configureServer(server) {
      // Lets the app discover whether a server-side key exists (no key leaves the box).
      server.middlewares.use('/api/openai/health', (_req, res) => {
        json(res, 200, { ok: true, hasKey: !!key, model });
      });
      server.middlewares.use('/api/openai/chat/completions', (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: { message: 'POST only' } });
        if (!key)
          return json(res, 500, {
            error: { message: 'OPENAI_API_KEY is not set in .env (server-side). Add it and restart the dev server.' },
          });
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const upstream = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
              body,
            });
            const text = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(text);
          } catch (e) {
            json(res, 502, { error: { message: String((e as Error)?.message ?? e) } });
          }
        });
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
  train: { trainRows: number; holdoutRows: number; baselineTop1: number | null; tunedTop1: number | null };
  error: string;
  logs: string[];
}

function trainingSupervisor(): Plugin {
  const clients = new Set<import('http').ServerResponse>();
  let current:
    | {
        child: ChildProcessWithoutNullStreams | null;
        zstd: ChildProcessWithoutNullStreams | null;
        stopRequested: boolean;
      }
    | null = null;
  let status: TrainingStatus = idleStatus();

  const json = (res: import('http').ServerResponse, code: number, body: unknown) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
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

function idleStatus(config: Required<TrainingStartConfig> = normalizeTrainingConfig({})): TrainingStatus {
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
  const num = (v: number | undefined, fallback: number) => (Number.isFinite(v) && v !== undefined ? v : fallback);
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

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runImport(
  cfg: Required<TrainingStartConfig>,
  log: (line: string) => void,
  onChild: (child: ChildProcessWithoutNullStreams, zstd: ChildProcessWithoutNullStreams | null) => void,
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

function waitFor(child: ChildProcessWithoutNullStreams, log: (line: string) => void, label: string): Promise<void> {
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
  const trained = /trained\s+(\d+)\s+rows,\s+holdout\s+(\d+):\s+top-1\s+([\d.]+)%\s+->\s+([\d.]+)%/.exec(line);
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

function killProcessTree(child: ChildProcessWithoutNullStreams | null): void {
  if (!child || child.killed || child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function readJsonBody<T>(req: import('http').IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1_000_000) reject(new Error('request body too large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? (JSON.parse(body) as T) : ({} as T));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Stockfish WASM needs cross-origin isolation (SharedArrayBuffer) in the browser.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ''); // '' = load ALL vars, incl. non-VITE_
  return {
    plugins: [react(), openaiProxy(env), trainingSupervisor()],
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    test: {
      globals: true,
      environment: 'node',
      include: ['engine/**/*.test.ts', 'app/**/*.test.ts', 'app/**/*.test.tsx', 'llm/**/*.test.ts', 'arena/**/*.test.ts'],
      testTimeout: 30000,
    },
  };
});
