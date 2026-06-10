// 2B King-Exposure Head trainer, v2 — mixed regression(α) + sibling-ranking(β).
//
// v1 (pure static-residual ridge) found no signal: the residual is dominated by
// search-depth noise. v2 adds the objective that actually worked for Rung-2:
// rank the SF-multipv candidate moves by the eval of their child positions.
// The 4 new 2B weights are the only free parameters; the promoted 26 stay
// frozen (their contribution rides inside the faucet's evalWhiteCp).
//
//   eval_white(pos) = faucetEval(pos) + Σ w_k · f_k(pos)      (k over the 4 new dims)
//   s_i (mover POV) = ±eval_white(childOf(move_i))
//   ranking loss    = hinge(margin(cpLoss_i) − (s_best − s_i))
//   regression loss = (w·f(parent) − (sfEvalBefore − faucetEval(parent)))²
//
//   npx vite-node arena/train-2b-v2.ts -- [--alpha 1] [--beta 4] [--epochs 300]
//                                         [--lr 0.05] [--l2 0.001] [--clamp 1200]
//
// Output: arena/out/rung2-weights-2b.json (+ .meta.json), UNPROMOTED. The gate
// stack (regression rows, eval-r4, mini-gauntlet, d20) decides promotion.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chess.js';

const SHARDS_DIR = 'arena/out/2b-shards';
const EXE = process.env.CVS_RUST_EXE ?? '../chess-vision-studio-rust-engine/target/release/analyze.exe';
const BASE_W = 'arena/out/value-weights-mixed.json';
const RUNG2_W = 'arena/out/rung2-weights-mixed.json';
const NEW_KEYS = ['kingCentralExposure', 'enemyQueenNearKing', 'openCenterKingPenalty', 'kingEscapeDeficit', 'kingDanger'] as const;
// The weight JSONs are camelCase (Rust serde rename_all = "camelCase") — the
// feature keys ARE the field names. v3 lesson: a snake_case field is silently
// ignored by serde and the head stays inert.
const OUT_FIELD: Record<(typeof NEW_KEYS)[number], string> = {
  kingCentralExposure: 'kingCentralExposure',
  enemyQueenNearKing: 'enemyQueenNearKing',
  openCenterKingPenalty: 'openCenterKingPenalty',
  kingEscapeDeficit: 'kingEscapeDeficit',
  kingDanger: 'kingDanger',
};

function arg(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
}
const ALPHA = arg('--alpha', 1);
const BETA = arg('--beta', 4);
const EPOCHS = arg('--epochs', 300);
const LR = arg('--lr', 0.05);
const L2 = arg('--l2', 0.001);
const CLAMP = arg('--clamp', 1200);
const MARGIN_CAP = arg('--margin-cap', 100);
const HOLDOUT = arg('--holdout', 0.15);

function fenHash(fen: string): number {
  let h = 2166136261;
  for (let i = 0; i < fen.length; i++) {
    h ^= fen.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

interface LabeledRow {
  fen: string;
  evalBefore?: number; // white POV cp
  topMoves?: { san: string; uci?: string; cp?: number; mate?: number }[];
}

interface Candidate {
  childFen: string;
  cpLoss: number; // vs the multipv best, mover POV
}

interface Sample {
  parentFen: string;
  resid: number; // sfEvalBefore − faucetEval(parent)
  moverSign: 1 | -1; // +1 white to move
  candidates: Candidate[]; // [0] is SF best
  holdout: boolean;
}

function cpOf(line: { cp?: number; mate?: number }): number | null {
  if (typeof line.cp === 'number') return line.cp;
  if (typeof line.mate === 'number') return line.mate > 0 ? 1500 : -1500;
  return null;
}

function loadSamples(): { samples: Sample[]; fens: Set<string>; shards: string[] } {
  const shards = readdirSync(SHARDS_DIR).filter((f) => f.startsWith('labeled')).sort();
  const samples: Sample[] = [];
  const fens = new Set<string>();
  for (const shard of shards) {
    for (const line of readFileSync(join(SHARDS_DIR, shard), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let row: LabeledRow;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof row.evalBefore !== 'number' || Math.abs(row.evalBefore) > CLAMP) continue;
      if (!row.topMoves || row.topMoves.length < 2) continue;
      const chess = new Chess(row.fen);
      const bestCp = cpOf(row.topMoves[0]);
      if (bestCp === null) continue;
      const candidates: Candidate[] = [];
      for (const tm of row.topMoves) {
        const cp = cpOf(tm);
        if (cp === null) continue;
        const c = new Chess(row.fen);
        let moved;
        try {
          moved = c.move(tm.san);
        } catch {
          moved = null;
        }
        if (!moved) continue;
        candidates.push({ childFen: c.fen(), cpLoss: Math.max(0, bestCp - cp) });
      }
      if (candidates.length < 2) continue;
      samples.push({
        parentFen: row.fen,
        resid: 0, // filled after the faucet pass
        moverSign: chess.turn() === 'w' ? 1 : -1,
        candidates,
        holdout: fenHash(row.fen) < HOLDOUT,
      });
      fens.add(row.fen);
      for (const c of candidates) fens.add(c.childFen);
    }
  }
  return { samples, fens, shards };
}

interface Feat {
  eval: number;
  x: number[];
}

function faucet(fens: string[]): Map<string, Feat> {
  const tmp = mkdtempSync(join(tmpdir(), 'cvs2bv2-'));
  const fensPath = join(tmp, 'fens.txt');
  writeFileSync(fensPath, fens.join('\n'));
  const res = spawnSync(EXE, ['--features', '--depth', '1', '--fens', fensPath, '--base', BASE_W, '--rung2', RUNG2_W], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`faucet failed: ${res.stderr?.slice(0, 300)}`);
  const out = new Map<string, Feat>();
  const lines = res.stdout.split('\n').filter((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const j = JSON.parse(lines[i]);
    if (j.error) continue;
    out.set(fens[i], { eval: j.evalWhiteCp, x: NEW_KEYS.map((k) => j.features[k] as number) });
  }
  return out;
}

function dot(w: number[], x: number[]): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i] * x[i];
  return s;
}

/** Fraction of samples where argmax over candidates picks the SF best move. */
function top1(samples: Sample[], feats: Map<string, Feat>, w: number[]): number {
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
      const score = s.moverSign * (f.eval + dot(w, f.x));
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

const { samples, fens, shards } = loadSamples();
console.log(`samples: ${samples.length} parents, ${fens.size} unique FENs to extract (${shards.length} shards)`);
const feats = faucet([...fens]);
for (const s of samples) {
  const f = feats.get(s.parentFen);
  if (f) s.resid = 0; // resid computed inline below using f.eval; kept per-sample for the report
}
const train = samples.filter((s) => !s.holdout && feats.has(s.parentFen));
const hold = samples.filter((s) => s.holdout && feats.has(s.parentFen));
console.log(`split: train ${train.length} / holdout ${hold.length}`);

const w = NEW_KEYS.map(() => 0);
const labeledEval = new Map<string, number>(); // parentFen -> sf evalBefore
{
  // second pass for regression targets (evalBefore lives in the shard rows)
  for (const shard of shards) {
    for (const line of readFileSync(join(SHARDS_DIR, shard), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as LabeledRow;
        if (typeof row.evalBefore === 'number') labeledEval.set(row.fen, row.evalBefore);
      } catch {
        /* skip */
      }
    }
  }
}

for (let epoch = 0; epoch < EPOCHS; epoch++) {
  const grad = NEW_KEYS.map(() => 0);
  let nReg = 0;
  let nRank = 0;
  for (const s of train) {
    const pf = feats.get(s.parentFen)!;
    const target = labeledEval.get(s.parentFen);
    if (typeof target === 'number') {
      // regression on the parent's residual
      const r = target - pf.eval;
      const err = dot(w, pf.x) - r;
      for (let k = 0; k < NEW_KEYS.length; k++) grad[k] += ALPHA * err * pf.x[k] * 2e-4; // cp² scale-down
      nReg += 1;
    }
    const bf = feats.get(s.candidates[0].childFen);
    if (!bf) continue;
    const sBest = s.moverSign * (bf.eval + dot(w, bf.x));
    for (let i = 1; i < s.candidates.length; i++) {
      const cf = feats.get(s.candidates[i].childFen);
      if (!cf) continue;
      const sI = s.moverSign * (cf.eval + dot(w, cf.x));
      const margin = Math.min(MARGIN_CAP, s.candidates[i].cpLoss);
      if (sBest - sI < margin) {
        // hinge active: push best up, candidate down (chain through moverSign)
        for (let k = 0; k < NEW_KEYS.length; k++) grad[k] += BETA * (s.moverSign * cf.x[k] - s.moverSign * bf.x[k]) * 0.01;
        nRank += 1;
      }
    }
  }
  for (let k = 0; k < NEW_KEYS.length; k++) {
    grad[k] = grad[k] / Math.max(1, train.length) + L2 * w[k];
    w[k] -= LR * grad[k] * 100; // features are unit-scale ints; weights live in cp
  }
  if (epoch % 50 === 0 || epoch === EPOCHS - 1) {
    console.log(
      `epoch ${String(epoch).padStart(3)}  w=[${w.map((v) => v.toFixed(2)).join(', ')}]  activeHinges=${nRank} regRows=${nReg}`,
    );
  }
}

console.log('\nlearned weights (cp per feature unit):');
for (let i = 0; i < NEW_KEYS.length; i++) console.log(`  ${NEW_KEYS[i].padEnd(24)} ${w[i].toFixed(4)}`);
const w0 = [0, 0, 0, 0];
console.log('\nTOP-1 (argmax child eval == SF best):');
console.log(`  train   before=${(top1(train, feats, w0) * 100).toFixed(2)}%  after=${(top1(train, feats, w) * 100).toFixed(2)}%`);
console.log(`  holdout before=${(top1(hold, feats, w0) * 100).toFixed(2)}%  after=${(top1(hold, feats, w) * 100).toFixed(2)}%`);

const rung2 = JSON.parse(readFileSync(RUNG2_W, 'utf8'));
for (let i = 0; i < NEW_KEYS.length; i++) rung2[OUT_FIELD[NEW_KEYS[i]]] = w[i];
writeFileSync('arena/out/rung2-weights-2b.json', JSON.stringify(rung2, null, 2));
writeFileSync(
  'arena/out/rung2-weights-2b.meta.json',
  JSON.stringify(
    {
      head: '2B king-exposure v2',
      objective: `mixed: alpha=${ALPHA} residual regression + beta=${BETA} sibling ranking (hinge, margin cap ${MARGIN_CAP}cp)`,
      epochs: EPOCHS,
      lr: LR,
      l2: L2,
      clampCp: CLAMP,
      samples: samples.length,
      shards,
      weights: Object.fromEntries(NEW_KEYS.map((k, i) => [k, w[i]])),
      exe: EXE,
      status: 'UNPROMOTED — experimental until full gate stack passes',
    },
    null,
    2,
  ),
);
console.log('\nwrote arena/out/rung2-weights-2b.json (+ meta) — UNPROMOTED experimental weights');
