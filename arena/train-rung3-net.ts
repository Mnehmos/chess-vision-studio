// Rung-3 value-net trainer.
//
// Trains a tiny MLP over the Rust-owned 28-dim feature vector:
//   23 Rung-2 features, including kingDanger, plus boardControl, loosePieces,
//   bestSeeCapture, safeChecks, pawnIslands.
//
// Objective: mixed parent residual regression + sibling ranking over SF d24
// multipv labels. Output is a Rust `ValueNet` JSON and is UNPROMOTED until it
// passes node-speed, heldout quality, self-play, and native SF-2400 gates.
//
//   npx vite-node arena/train-rung3-net.ts -- --epochs 150 --hidden 6
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Chess } from 'chess.js';

const SHARDS_DIR = 'arena/out/2b-shards';
const EXE = process.env.CVS_RUST_EXE ?? '../chess-vision-studio-rust-engine/target/release/analyze.exe';
const BASE_W = 'arena/out/value-weights-mixed.json';
const RUNG2_W = 'arena/out/rung2-weights-mixed.json';
const OUT = 'arena/out/rung3-net.json';

const FEATURE_KEYS = [
  'mobilityKnight',
  'mobilityBishop',
  'mobilityRook',
  'mobilityQueen',
  'kingShield',
  'kingZonePressure',
  'kingOpenFile',
  'passedPawnMg',
  'passedPawnEg',
  'connectedPassedPawn',
  'rookOpenFile',
  'rookSemiOpenFile',
  'rookSeventh',
  'doubledPawn',
  'isolatedPawn',
  'bishopPairMg',
  'bishopPairEg',
  'hangingPiece',
  'kingCentralExposure',
  'enemyQueenNearKing',
  'openCenterKingPenalty',
  'kingEscapeDeficit',
  'kingDanger',
  'boardControl',
  'loosePieces',
  'bestSeeCapture',
  'safeChecks',
  'pawnIslands',
] as const;

type TopMove = { san?: string; uci?: string; cp?: number; mate?: number };
interface LabeledRow {
  fen: string;
  evalBefore?: number;
  topMoves?: TopMove[];
}

interface Candidate {
  childFen: string;
  cpLoss: number;
}

interface Sample {
  parentFen: string;
  sfEval: number;
  moverSign: 1 | -1;
  candidates: Candidate[];
  holdout: boolean;
}

interface Feat {
  eval: number;
  x: number[];
}

interface Model {
  w1: number[][];
  b1: number[];
  w2: number[];
  b2: number;
}

interface Grad {
  w1: number[][];
  b1: number[];
  w2: number[];
  b2: number;
}

function numArg(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
}

function strArg(flag: string, dflt: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? dflt : dflt;
}

const HIDDEN = numArg('--hidden', 6);
const EPOCHS = numArg('--epochs', 150);
const LR = numArg('--lr', 0.01);
const L2 = numArg('--l2', 1e-4);
const ALPHA = numArg('--alpha', 1);
const BETA = numArg('--beta', 4);
const HOLDOUT = numArg('--holdout', 0.15);
const CLAMP = numArg('--clamp', 1200);
const MARGIN_CAP = numArg('--margin-cap', 120);
const LIMIT = numArg('--limit', 0);
const SEED = numArg('--seed', 1337);
const OUT_PATH = strArg('--out', OUT);

function fenHash(fen: string): number {
  let h = 2166136261;
  for (let i = 0; i < fen.length; i++) {
    h ^= fen.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cpOf(m: TopMove): number | null {
  if (typeof m.cp === 'number') return m.cp;
  if (typeof m.mate === 'number') return m.mate > 0 ? 1500 : -1500;
  return null;
}

function applyMove(fen: string, tm: TopMove): string | null {
  const c = new Chess(fen);
  if (tm.uci && tm.uci.length >= 4) {
    try {
      const moved = c.move({
        from: tm.uci.slice(0, 2),
        to: tm.uci.slice(2, 4),
        promotion: tm.uci.slice(4, 5) || undefined,
      });
      if (moved) return c.fen();
    } catch {
      /* fall through */
    }
  }
  if (tm.san) {
    try {
      const moved = c.move(tm.san);
      if (moved) return c.fen();
    } catch {
      /* invalid label */
    }
  }
  return null;
}

function loadSamples(): { samples: Sample[]; fens: string[]; shards: string[] } {
  const shards = readdirSync(SHARDS_DIR).filter((f) => f.startsWith('labeled')).sort();
  const samples: Sample[] = [];
  const fens = new Set<string>();
  for (const shard of shards) {
    for (const line of readFileSync(join(SHARDS_DIR, shard), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let row: LabeledRow;
      try {
        row = JSON.parse(line) as LabeledRow;
      } catch {
        continue;
      }
      if (typeof row.evalBefore !== 'number' || Math.abs(row.evalBefore) > CLAMP) continue;
      if (!row.topMoves || row.topMoves.length < 2) continue;
      const bestCp = cpOf(row.topMoves[0]);
      if (bestCp === null) continue;

      const candidates: Candidate[] = [];
      for (const tm of row.topMoves) {
        const cp = cpOf(tm);
        if (cp === null) continue;
        const childFen = applyMove(row.fen, tm);
        if (!childFen) continue;
        candidates.push({ childFen, cpLoss: Math.max(0, bestCp - cp) });
      }
      if (candidates.length < 2) continue;

      const chess = new Chess(row.fen);
      samples.push({
        parentFen: row.fen,
        sfEval: row.evalBefore,
        moverSign: chess.turn() === 'w' ? 1 : -1,
        candidates,
        holdout: fenHash(row.fen) < HOLDOUT,
      });
      fens.add(row.fen);
      for (const c of candidates) fens.add(c.childFen);
      if (LIMIT > 0 && samples.length >= LIMIT) break;
    }
    if (LIMIT > 0 && samples.length >= LIMIT) break;
  }
  return { samples, fens: [...fens], shards };
}

function faucet(fens: string[]): Map<string, Feat> {
  const tmp = mkdtempSync(join(tmpdir(), 'cvs-rung3-'));
  const fensPath = join(tmp, 'fens.txt');
  writeFileSync(fensPath, fens.join('\n'), 'utf8');
  const res = spawnSync(EXE, ['--features', '--depth', '1', '--fens', fensPath, '--base', BASE_W, '--rung2', RUNG2_W], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`faucet failed: ${res.stderr?.slice(0, 1000)}`);

  const out = new Map<string, Feat>();
  const lines = res.stdout.split('\n').filter((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const j = JSON.parse(lines[i]);
    if (j.error) continue;
    const vec = Array.isArray(j.featureVector)
      ? j.featureVector.map(Number)
      : FEATURE_KEYS.map((k) => Number(j.features?.[k] ?? 0));
    if (vec.length !== FEATURE_KEYS.length) throw new Error(`feature dim ${vec.length} != ${FEATURE_KEYS.length}`);
    out.set(fens[i], { eval: Number(j.evalWhiteCp), x: vec });
  }
  return out;
}

function normStats(samples: Sample[], feats: Map<string, Feat>): { mean: number[]; scale: number[] } {
  const xs: number[][] = [];
  for (const s of samples) {
    const p = feats.get(s.parentFen);
    if (p) xs.push(p.x);
    for (const c of s.candidates) {
      const f = feats.get(c.childFen);
      if (f) xs.push(f.x);
    }
  }
  const n = FEATURE_KEYS.length;
  const mean = new Array(n).fill(0);
  for (const x of xs) for (let i = 0; i < n; i++) mean[i] += x[i];
  for (let i = 0; i < n; i++) mean[i] /= Math.max(1, xs.length);
  const scale = new Array(n).fill(0);
  for (const x of xs) for (let i = 0; i < n; i++) scale[i] += (x[i] - mean[i]) ** 2;
  for (let i = 0; i < n; i++) scale[i] = Math.sqrt(scale[i] / Math.max(1, xs.length)) || 1;
  return { mean, scale };
}

function norm(x: number[], mean: number[], scale: number[]): number[] {
  return x.map((v, i) => (v - mean[i]) / scale[i]);
}

function initModel(): Model {
  const r = rng(SEED);
  const w1 = Array.from({ length: HIDDEN }, () =>
    Array.from({ length: FEATURE_KEYS.length }, () => (r() * 2 - 1) * 0.05),
  );
  return {
    w1,
    b1: new Array(HIDDEN).fill(0),
    w2: Array.from({ length: HIDDEN }, () => (r() * 2 - 1) * 0.05),
    b2: 0,
  };
}

function zeroGrad(): Grad {
  return {
    w1: Array.from({ length: HIDDEN }, () => new Array(FEATURE_KEYS.length).fill(0)),
    b1: new Array(HIDDEN).fill(0),
    w2: new Array(HIDDEN).fill(0),
    b2: 0,
  };
}

function forward(model: Model, x: number[]): { y: number; h: number[]; active: boolean[] } {
  const h = new Array(HIDDEN).fill(0);
  const active = new Array(HIDDEN).fill(false);
  let y = model.b2;
  for (let j = 0; j < HIDDEN; j++) {
    let a = model.b1[j];
    const row = model.w1[j];
    for (let i = 0; i < x.length; i++) a += row[i] * x[i];
    if (a > 0) {
      h[j] = a;
      active[j] = true;
      y += model.w2[j] * a;
    }
  }
  return { y, h, active };
}

function addGrad(model: Model, grad: Grad, x: number[], dY: number): void {
  const f = forward(model, x);
  grad.b2 += dY;
  for (let j = 0; j < HIDDEN; j++) {
    grad.w2[j] += dY * f.h[j];
    if (!f.active[j]) continue;
    const dA = dY * model.w2[j];
    grad.b1[j] += dA;
    for (let i = 0; i < x.length; i++) grad.w1[j][i] += dA * x[i];
  }
}

function predCp(model: Model, rawX: number[], mean: number[], scale: number[]): number {
  return forward(model, norm(rawX, mean, scale)).y;
}

function trainEpoch(
  model: Model,
  samples: Sample[],
  feats: Map<string, Feat>,
  mean: number[],
  scale: number[],
): { grad: Grad; regRows: number; rankPairs: number; rankViolations: number } {
  const grad = zeroGrad();
  let regRows = 0;
  let rankPairs = 0;
  let rankViolations = 0;
  for (const s of samples) {
    const pf = feats.get(s.parentFen);
    if (!pf) continue;
    const px = norm(pf.x, mean, scale);
    const residual = s.sfEval - pf.eval;
    const p = forward(model, px).y;
    addGrad(model, grad, px, (ALPHA * (p - residual)) / 100);
    regRows += 1;

    const bf = feats.get(s.candidates[0].childFen);
    if (!bf) continue;
    const bestPred = predCp(model, bf.x, mean, scale);
    const bestScore = s.moverSign * (bf.eval + bestPred);
    for (let i = 1; i < s.candidates.length; i++) {
      const cf = feats.get(s.candidates[i].childFen);
      if (!cf) continue;
      const candPred = predCp(model, cf.x, mean, scale);
      const candScore = s.moverSign * (cf.eval + candPred);
      const margin = Math.min(MARGIN_CAP, s.candidates[i].cpLoss);
      const violation = margin - (bestScore - candScore);
      rankPairs += 1;
      if (violation <= 0) continue;
      rankViolations += 1;
      addGrad(model, grad, norm(bf.x, mean, scale), (-BETA * s.moverSign) / 100);
      addGrad(model, grad, norm(cf.x, mean, scale), (BETA * s.moverSign) / 100);
    }
  }
  const denom = Math.max(1, regRows + rankPairs);
  for (let j = 0; j < HIDDEN; j++) {
    grad.b1[j] /= denom;
    grad.w2[j] = grad.w2[j] / denom + L2 * model.w2[j];
    for (let i = 0; i < FEATURE_KEYS.length; i++) grad.w1[j][i] = grad.w1[j][i] / denom + L2 * model.w1[j][i];
  }
  grad.b2 /= denom;
  return { grad, regRows, rankPairs, rankViolations };
}

function adamStep(model: Model, grad: Grad, state: { m: Grad; v: Grad; t: number }): void {
  state.t += 1;
  const b1 = 0.9;
  const b2 = 0.999;
  const eps = 1e-8;
  const upd = (val: number, g: number, getM: () => number, setM: (v: number) => void, getV: () => number, setV: (v: number) => void) => {
    const m = b1 * getM() + (1 - b1) * g;
    const v = b2 * getV() + (1 - b2) * g * g;
    setM(m);
    setV(v);
    const mh = m / (1 - b1 ** state.t);
    const vh = v / (1 - b2 ** state.t);
    return val - (LR * mh) / (Math.sqrt(vh) + eps);
  };
  for (let j = 0; j < HIDDEN; j++) {
    model.b1[j] = upd(model.b1[j], grad.b1[j], () => state.m.b1[j], (v) => (state.m.b1[j] = v), () => state.v.b1[j], (v) => (state.v.b1[j] = v));
    model.w2[j] = upd(model.w2[j], grad.w2[j], () => state.m.w2[j], (v) => (state.m.w2[j] = v), () => state.v.w2[j], (v) => (state.v.w2[j] = v));
    for (let i = 0; i < FEATURE_KEYS.length; i++) {
      model.w1[j][i] = upd(
        model.w1[j][i],
        grad.w1[j][i],
        () => state.m.w1[j][i],
        (v) => (state.m.w1[j][i] = v),
        () => state.v.w1[j][i],
        (v) => (state.v.w1[j][i] = v),
      );
    }
  }
  model.b2 = upd(model.b2, grad.b2, () => state.m.b2, (v) => (state.m.b2 = v), () => state.v.b2, (v) => (state.v.b2 = v));
}

function top1(samples: Sample[], feats: Map<string, Feat>, model: Model, mean: number[], scale: number[]): number {
  let hit = 0;
  let n = 0;
  for (const s of samples) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    let ok = true;
    for (let i = 0; i < s.candidates.length; i++) {
      const f = feats.get(s.candidates[i].childFen);
      if (!f) {
        ok = false;
        break;
      }
      const score = s.moverSign * (f.eval + predCp(model, f.x, mean, scale));
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (!ok) continue;
    n += 1;
    if (bestIdx === 0) hit += 1;
  }
  return n ? hit / n : 0;
}

function regMae(samples: Sample[], feats: Map<string, Feat>, model: Model, mean: number[], scale: number[]): number {
  let total = 0;
  let n = 0;
  for (const s of samples) {
    const f = feats.get(s.parentFen);
    if (!f) continue;
    total += Math.abs(s.sfEval - (f.eval + predCp(model, f.x, mean, scale)));
    n += 1;
  }
  return total / Math.max(1, n);
}

function bake(model: Model, mean: number[], scale: number[]): Model {
  const w1 = model.w1.map((row) => row.map((v, i) => v / scale[i]));
  const b1 = model.b1.map((b, j) => b - model.w1[j].reduce((acc, v, i) => acc + (v * mean[i]) / scale[i], 0));
  return { w1, b1, w2: [...model.w2], b2: model.b2 };
}

const { samples, fens, shards } = loadSamples();
console.log(`samples: ${samples.length} parents, ${fens.length} unique FENs (${shards.length} shards)`);
const feats = faucet(fens);
const train = samples.filter((s) => !s.holdout && feats.has(s.parentFen));
const hold = samples.filter((s) => s.holdout && feats.has(s.parentFen));
const { mean, scale } = normStats(train, feats);

const model = initModel();
const zero = { w1: model.w1.map((r) => r.map(() => 0)), b1: model.b1.map(() => 0), w2: model.w2.map(() => 0), b2: 0 };
const adam = { m: zeroGrad(), v: zeroGrad(), t: 0 };

console.log(`split: train ${train.length} / holdout ${hold.length}`);
console.log(`model: input ${FEATURE_KEYS.length}, hidden ${HIDDEN}, epochs ${EPOCHS}, lr ${LR}, alpha ${ALPHA}, beta ${BETA}`);
console.log(`baseline: train top1 ${(top1(train, feats, zero, mean, scale) * 100).toFixed(2)}%, holdout top1 ${(top1(hold, feats, zero, mean, scale) * 100).toFixed(2)}%`);

for (let epoch = 0; epoch < EPOCHS; epoch++) {
  const { grad, regRows, rankPairs, rankViolations } = trainEpoch(model, train, feats, mean, scale);
  adamStep(model, grad, adam);
  if (epoch % 10 === 0 || epoch === EPOCHS - 1) {
    console.log(
      `epoch ${String(epoch).padStart(3)}  regMae train=${regMae(train, feats, model, mean, scale).toFixed(1)} hold=${regMae(hold, feats, model, mean, scale).toFixed(1)}  ` +
        `top1 train=${(top1(train, feats, model, mean, scale) * 100).toFixed(2)}% hold=${(top1(hold, feats, model, mean, scale) * 100).toFixed(2)}%  ` +
        `hinge ${rankViolations}/${rankPairs} regRows=${regRows}`,
    );
  }
}

const baked = bake(model, mean, scale);
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(
  OUT_PATH,
  JSON.stringify(
    {
      inputDim: FEATURE_KEYS.length,
      hiddenDim: HIDDEN,
      w1: baked.w1,
      b1: baked.b1,
      w2: baked.w2,
      b2: baked.b2,
      outputScaleCp: 1.0,
    },
    null,
    2,
  ),
  'utf8',
);
writeFileSync(
  OUT_PATH.replace(/\.json$/, '.meta.json'),
  JSON.stringify(
    {
      head: 'Rung-3 tiny MLP',
      status: 'UNPROMOTED - experimental until full gate stack passes',
      objective: `mixed regression alpha=${ALPHA} + sibling ranking beta=${BETA}, margin cap ${MARGIN_CAP}cp`,
      featureKeys: FEATURE_KEYS,
      hiddenDim: HIDDEN,
      epochs: EPOCHS,
      lr: LR,
      l2: L2,
      clampCp: CLAMP,
      holdoutPct: HOLDOUT,
      samples: samples.length,
      train: train.length,
      holdout: hold.length,
      shards,
      exe: EXE,
      baseWeights: BASE_W,
      rung2Weights: RUNG2_W,
      final: {
        trainMaeCp: regMae(train, feats, model, mean, scale),
        holdoutMaeCp: regMae(hold, feats, model, mean, scale),
        trainTop1: top1(train, feats, model, mean, scale),
        holdoutTop1: top1(hold, feats, model, mean, scale),
      },
      normalizationBakedIntoW1: true,
      mean,
      scale,
    },
    null,
    2,
  ),
  'utf8',
);

console.log(`wrote ${OUT_PATH} (+ meta) - UNPROMOTED experimental net`);
