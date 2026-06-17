import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { killProcessTree, npmCommand, readJsonBody, sendJson as json } from './http';
import {
  idleStatus,
  normalizeTrainingConfig,
  parseProgress,
  readTrainReport,
  type TrainingPhase,
  type TrainingStartConfig,
  type TrainingStatus,
} from './training-state';

export function trainingSupervisor(): Plugin {
  const clients = new Set<ServerResponse>();
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
