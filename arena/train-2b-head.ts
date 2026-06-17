// 2B King-Exposure Head trainer (RSI loop 2B).
//
// Targets the forensic finding: CVS holds a positive/near-equal static eval in
// initiative/king-attack midgames where SF d24 already scores the position
// as lost (delusion gaps of 300–950cp). Fits ONLY the four new Rung-2 fields
// (kingCentralExposure, enemyQueenNearKing, openCenterKingPenalty,
// kingEscapeDeficit) against the residual sfEval − cvsStaticEval; the promoted
// 26 weights stay frozen. Rust owns feature extraction (`analyze --features`);
// this script is pure orchestration + a closed-form ridge solve.
//
//   npm run vite-node arena/train-2b-head.ts -- [--lambda 50] [--clamp 1200] [--holdout 0.15]
//
// Output: arena/out/rung2-weights-2b.json (+ .meta.json). Promotion is a
// separate, gated decision — this script only fits and reports.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUNS_DIR = 'arena/gauntlet/runs';
const EXE = process.env.CVS_RUST_EXE ?? '../chess-vision-studio-rust-engine/target/release/analyze.exe';
const BASE_W = 'arena/out/value-weights-mixed.json';
const RUNG2_W = 'arena/out/rung2-weights-mixed.json';
const DEFAULT_STOCKFISH_REVIEW_DEPTH = 24;
const NEW_KEYS = ['kingCentralExposure', 'enemyQueenNearKing', 'openCenterKingPenalty', 'kingEscapeDeficit'] as const;
// serde field names in the Rust weight JSON
const OUT_FIELD: Record<(typeof NEW_KEYS)[number], string> = {
  kingCentralExposure: 'king_central_exposure',
  enemyQueenNearKing: 'enemy_queen_near_king',
  openCenterKingPenalty: 'open_center_king_penalty',
  kingEscapeDeficit: 'king_escape_deficit',
};

function arg(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
}
const LAMBDA = arg('--lambda', 50);
const CLAMP = arg('--clamp', 1200);
const HOLDOUT = arg('--holdout', 0.15);

// Deterministic holdout: hash the FEN, not Math.random — reruns are stable.
function fenHash(fen: string): number {
  let h = 2166136261;
  for (let i = 0; i < fen.length; i++) {
    h ^= fen.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

interface Row {
  fen: string;
  sfEval: number; // white POV cp, from the gauntlet oracle
  oracleDepth: number;
}

function collectRows(): Row[] {
  const byFen = new Map<string, Row>();
  for (const dir of readdirSync(RUNS_DIR)) {
    const p = join(RUNS_DIR, dir, 'scored_moves.jsonl');
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let m: any;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      const sfEval = m.stockfishEvalBefore;
      if (typeof sfEval !== 'number' || !m.fenBefore) continue;
      if (Math.abs(sfEval) > CLAMP) continue; // mate-range/lost-position noise
      const prev = byFen.get(m.fenBefore);
      const depth = m.oracleDepth ?? DEFAULT_STOCKFISH_REVIEW_DEPTH;
      if (!prev || depth > prev.oracleDepth) {
        byFen.set(m.fenBefore, { fen: m.fenBefore, sfEval, oracleDepth: depth });
      }
    }
  }
  return [...byFen.values()];
}

interface Sample {
  x: number[]; // the 4 new features, white-POV signed
  resid: number; // sfEval − cvsStaticEval (what the current eval fails to see)
  holdout: boolean;
}

function extractFeatures(rows: Row[]): Sample[] {
  const tmp = mkdtempSync(join(tmpdir(), 'cvs2b-'));
  const fensPath = join(tmp, 'fens.txt');
  writeFileSync(fensPath, rows.map((r) => r.fen).join('\n'));
  const res = spawnSync(EXE, ['--features', '--depth', '1', '--fens', fensPath, '--base', BASE_W, '--rung2', RUNG2_W], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`faucet failed: ${res.stderr?.slice(0, 400)}`);
  const lines = res.stdout.split('\n').filter((l) => l.trim());
  if (lines.length !== rows.length) throw new Error(`faucet line mismatch: ${lines.length} vs ${rows.length}`);
  const samples: Sample[] = [];
  for (let i = 0; i < rows.length; i++) {
    const j = JSON.parse(lines[i]);
    if (j.error) continue;
    samples.push({
      x: NEW_KEYS.map((k) => j.features[k] as number),
      resid: rows[i].sfEval - j.evalWhiteCp,
      holdout: fenHash(rows[i].fen) < HOLDOUT,
    });
  }
  return samples;
}

/** Closed-form ridge: w = (XᵀX + λI)⁻¹ Xᵀr, 4×4 Gaussian elimination. */
function ridge(samples: Sample[]): number[] {
  const n = NEW_KEYS.length;
  const A: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? LAMBDA : 0)),
  );
  const b = new Array(n).fill(0);
  for (const s of samples) {
    for (let i = 0; i < n; i++) {
      if (s.x[i] === 0) continue;
      b[i] += s.x[i] * s.resid;
      for (let j = 0; j < n; j++) A[i][j] += s.x[i] * s.x[j];
    }
  }
  // solve A w = b
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = 0; r < n; r++) {
      if (r === col || A[r][col] === 0) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}

function stats(samples: Sample[], w: number[]): { mae0: number; mae1: number; n: number } {
  let a0 = 0;
  let a1 = 0;
  for (const s of samples) {
    const pred = s.x.reduce((acc, xi, i) => acc + xi * w[i], 0);
    a0 += Math.abs(s.resid);
    a1 += Math.abs(s.resid - pred);
  }
  return { mae0: a0 / samples.length, mae1: a1 / samples.length, n: samples.length };
}

const rows = collectRows();
const samples = extractFeatures(rows);
const firing = samples.filter((s) => s.x.some((v) => v !== 0));
const train = samples.filter((s) => !s.holdout);
const hold = samples.filter((s) => s.holdout);
const w = ridge(train);

console.log(`dataset: ${rows.length} unique FENs (clamp ±${CLAMP}cp), ${firing.length} with 2B features firing`);
console.log(`split: train ${train.length} / holdout ${hold.length} (deterministic fen-hash @ ${HOLDOUT})`);
console.log(`lambda: ${LAMBDA}`);
for (let i = 0; i < NEW_KEYS.length; i++) console.log(`  ${NEW_KEYS[i].padEnd(24)} ${w[i].toFixed(4)} cp/unit`);
const firingHold = hold.filter((s) => s.x.some((v) => v !== 0));
const firingTrain = train.filter((s) => s.x.some((v) => v !== 0));
for (const [label, set] of [
  ['train(all)', train],
  ['train(firing)', firingTrain],
  ['holdout(all)', hold],
  ['holdout(firing)', firingHold],
] as const) {
  const s = stats(set, w);
  console.log(`${label.padEnd(16)} n=${s.n}  MAE resid before=${s.mae0.toFixed(2)}cp  after=${s.mae1.toFixed(2)}cp  (Δ ${(s.mae0 - s.mae1).toFixed(2)})`);
}

const rung2 = JSON.parse(readFileSync(RUNG2_W, 'utf8'));
for (let i = 0; i < NEW_KEYS.length; i++) rung2[OUT_FIELD[NEW_KEYS[i]]] = w[i];
const outPath = 'arena/out/rung2-weights-2b.json';
writeFileSync(outPath, JSON.stringify(rung2, null, 2));
writeFileSync(
  outPath.replace('.json', '.meta.json'),
  JSON.stringify(
    {
      head: '2B king-exposure',
      objective: 'ridge residual regression (sfEvalBefore − cvsStaticEval), 26 promoted weights frozen',
      lambda: LAMBDA,
      clampCp: CLAMP,
      datasetFens: rows.length,
      firing: firing.length,
      weights: Object.fromEntries(NEW_KEYS.map((k, i) => [k, w[i]])),
      sourceRuns: readdirSync(RUNS_DIR).filter((d) => existsSync(join(RUNS_DIR, d, 'scored_moves.jsonl'))),
      exe: EXE,
      status: 'UNPROMOTED — experimental until full gate stack passes',
    },
    null,
    2,
  ),
);
console.log(`wrote ${outPath} (+ meta) — UNPROMOTED experimental weights`);
