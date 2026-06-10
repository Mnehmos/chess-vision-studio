// Texel tuner — fit ALL rung2 weights (18 base + 5 king-exposure) against
// GAME OUTCOMES, not Stockfish labels.
//
// Why: four eval-head fits on SF eval/multipv labels improved eval *prediction*
// without improving move *choice* (Rung-1, 2B v1–v3, Rung-3 MLP). The Texel
// method sidesteps the label problem entirely: weights are chosen so the
// static eval, squashed through a sigmoid, predicts who actually WON the game
// each position came from. Linear-in-weights eval ⇒ this is logistic-style
// regression with the (frozen) material+PST base as an offset.
//
//   P(white wins) = σ((base + w·f) / K)      σ(x) = 1/(1+e^(−x/K))
//   loss          = Σ (σ − y)²               y ∈ {1, ½, 0} from [Result]
//
// Data: cutechess SPRT PGNs + gauntlet PGNs (f:/tools/sprt-*.pgn by default).
// Sampling: plies 10..(N−6), side-to-move not in check, |base eval| ≤ 1200cp,
// dedup by FEN. K is fit first on the base eval alone, then frozen.
//
//   npx vite-node arena/train-texel.ts -- [--epochs 400] [--lr 2] [--l2 0.0002]
//        [--pgn-glob "f:/tools/sprt-*.pgn"] [--max-per-game 24]
//
// Output: arena/out/rung2-weights-texel.json (+ .meta.json), UNPROMOTED —
// the usual gate stack decides.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { Chess } from 'chess.js';

const EXE = process.env.CVS_RUST_EXE ?? '../chess-vision-studio-rust-engine/target-cand/release/analyze.exe';
const BASE_W = 'arena/out/value-weights-mixed.json';
const RUNG2_W = 'arena/out/rung2-weights-mixed.json';
const OUT = 'arena/out/rung2-weights-texel.json';

// camelCase — these ARE the serde field names (snake_case is silently ignored).
const KEYS = [
  'mobilityKnight', 'mobilityBishop', 'mobilityRook', 'mobilityQueen',
  'kingShield', 'kingZonePressure', 'kingOpenFile',
  'passedPawnMg', 'passedPawnEg', 'connectedPassedPawn',
  'rookOpenFile', 'rookSemiOpenFile', 'rookSeventh',
  'doubledPawn', 'isolatedPawn', 'bishopPairMg', 'bishopPairEg',
  'hangingPiece',
  'kingCentralExposure', 'enemyQueenNearKing', 'openCenterKingPenalty',
  'kingEscapeDeficit', 'kingDanger',
] as const;

function arg(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
}
function argS(flag: string, dflt: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const EPOCHS = arg('--epochs', 400);
const LR = arg('--lr', 2); // cp-scale weights need a chunky lr with normalized grads
const L2 = arg('--l2', 0.0002);
const MAX_PER_GAME = arg('--max-per-game', 24);
const PGN_GLOB = argS('--pgn-glob', 'f:/tools/sprt-*.pgn');
const HOLDOUT = arg('--holdout', 0.15);

function fenHash(fen: string): number {
  let h = 2166136261;
  for (let i = 0; i < fen.length; i++) {
    h ^= fen.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// ---------- 1. harvest (fen, outcome) samples from PGNs ----------
function pgnFiles(): string[] {
  const dir = dirname(PGN_GLOB);
  const pat = new RegExp('^' + basename(PGN_GLOB).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return readdirSync(dir).filter((f) => pat.test(f)).map((f) => join(dir, f));
}

type Sample = { fen: string; y: number };
function harvest(): Sample[] {
  const samples: Sample[] = [];
  const seen = new Set<string>();
  let games = 0;
  for (const file of pgnFiles()) {
    const text = readFileSync(file, 'utf8');
    // split on blank line before [Event — each PGN game block
    for (const block of text.split(/\n\n(?=\[Event )/)) {
      const result = /\[Result "(1-0|0-1|1\/2-1\/2)"\]/.exec(block)?.[1];
      if (!result) continue;
      const y = result === '1-0' ? 1 : result === '0-1' ? 0 : 0.5;
      const chess = new Chess();
      try {
        chess.loadPgn(block);
      } catch {
        continue;
      }
      games++;
      const history = chess.history();
      const startFen = /\[FEN "([^"]+)"\]/.exec(block)?.[1];
      const replay = startFen ? new Chess(startFen) : new Chess();
      const fens: string[] = [];
      for (const san of history) {
        try {
          replay.move(san);
        } catch {
          break;
        }
        fens.push(replay.fen());
      }
      // quiet middle slice, capped per game to keep games weighted evenly
      const lo = 10, hi = fens.length - 6;
      const eligible: string[] = [];
      for (let i = lo; i < hi; i++) {
        const c = new Chess(fens[i]);
        if (c.inCheck()) continue;
        eligible.push(fens[i]);
      }
      const step = Math.max(1, Math.floor(eligible.length / MAX_PER_GAME));
      for (let i = 0; i < eligible.length; i += step) {
        if (!seen.has(eligible[i])) {
          seen.add(eligible[i]);
          samples.push({ fen: eligible[i], y });
        }
      }
    }
  }
  console.log(`harvested ${samples.length} unique positions from ${games} games (${pgnFiles().length} files)`);
  return samples;
}

// ---------- 2. faucet: features + eval for every sample ----------
type Feat = { evalWhiteCp: number; x: number[] };
function faucet(fens: string[]): Map<string, Feat> {
  const out = new Map<string, Feat>();
  const CHUNK = 20000;
  for (let c = 0; c < fens.length; c += CHUNK) {
    const slice = fens.slice(c, c + CHUNK);
    const tmp = mkdtempSync(join(tmpdir(), 'cvstexel-'));
    const fensPath = join(tmp, 'fens.txt');
    writeFileSync(fensPath, slice.join('\n'));
    const res = spawnSync(EXE, ['--features', '--depth', '1', '--fens', fensPath, '--base', BASE_W, '--rung2', RUNG2_W], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 1024,
    });
    if (res.status !== 0) throw new Error(`faucet failed: ${res.stderr?.slice(0, 300)}`);
    const lines = res.stdout.split('\n').filter((l) => l.trim());
    for (let i = 0; i < lines.length; i++) {
      const j = JSON.parse(lines[i]);
      if (j.error) continue;
      out.set(slice[i], { evalWhiteCp: j.evalWhiteCp, x: KEYS.map((k) => (j.features?.[k] as number) ?? 0) });
    }
  }
  return out;
}

// ---------- 3. fit ----------
function main() {
  const samples = harvest();
  const feats = faucet(samples.map((s) => s.fen));
  const w0: Record<string, number> = JSON.parse(readFileSync(RUNG2_W, 'utf8'));
  const w0v = KEYS.map((k) => w0[k] ?? 0);

  type Row = { base: number; x: number[]; y: number };
  const rows: Row[] = [];
  for (const s of samples) {
    const f = feats.get(s.fen);
    if (!f) continue;
    // base = full faucet eval minus the loaded rung2 contribution → the frozen
    // material/PST/tempo core the tuned weights sit on top of.
    let contrib = 0;
    for (let i = 0; i < KEYS.length; i++) contrib += w0v[i] * f.x[i];
    const base = f.evalWhiteCp - contrib;
    if (Math.abs(base) > 1200) continue;
    rows.push({ base, x: f.x, y: s.y });
  }
  const train = rows.filter((r) => fenHash(JSON.stringify(r.x) + r.base) >= HOLDOUT);
  const hold = rows.filter((r) => fenHash(JSON.stringify(r.x) + r.base) < HOLDOUT);
  console.log(`rows: ${rows.length} (train ${train.length} / holdout ${hold.length})`);

  // Fit K on base eval alone (coarse grid) — the cp→probability temperature.
  const sig = (cp: number, K: number) => 1 / (1 + Math.exp(-cp / K));
  let bestK = 200, bestLoss = Infinity;
  for (let K = 80; K <= 500; K += 10) {
    let loss = 0;
    for (const r of train) loss += (sig(r.base, K) - r.y) ** 2;
    if (loss < bestLoss) { bestLoss = loss; bestK = K; }
  }
  console.log(`K = ${bestK} (base-only train MSE ${(bestLoss / train.length).toFixed(5)})`);

  const mse = (set: Row[], w: number[]) => {
    let loss = 0;
    for (const r of set) {
      let e = r.base;
      for (let i = 0; i < w.length; i++) e += w[i] * r.x[i];
      loss += (sig(e, bestK) - r.y) ** 2;
    }
    return loss / set.length;
  };

  // Gradient descent from the current mixed weights (warm start).
  const w = [...w0v];
  console.log(`start: train MSE ${mse(train, w).toFixed(6)}  holdout ${mse(hold, w).toFixed(6)}`);
  for (let ep = 0; ep < EPOCHS; ep++) {
    const g = new Array(KEYS.length).fill(0);
    for (const r of train) {
      let e = r.base;
      for (let i = 0; i < w.length; i++) e += w[i] * r.x[i];
      const s = sig(e, bestK);
      const d = (2 * (s - r.y) * s * (1 - s)) / bestK;
      for (let i = 0; i < w.length; i++) g[i] += d * r.x[i];
    }
    for (let i = 0; i < w.length; i++) {
      w[i] -= (LR * g[i]) / train.length + LR * L2 * (w[i] - w0v[i]);
      w[i] = Math.max(-60, Math.min(60, w[i]));
    }
    if (ep % 50 === 0 || ep === EPOCHS - 1) {
      console.log(`epoch ${String(ep).padStart(3)}  train MSE ${mse(train, w).toFixed(6)}  holdout ${mse(hold, w).toFixed(6)}`);
    }
  }

  const out: Record<string, number> = { ...w0 };
  KEYS.forEach((k, i) => (out[k] = Number(w[i].toFixed(4))));
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  writeFileSync(OUT.replace('.json', '.meta.json'), JSON.stringify({
    method: 'texel-logistic', K: bestK, rows: rows.length, epochs: EPOCHS, lr: LR, l2: L2,
    warmStart: RUNG2_W, pgnGlob: PGN_GLOB, trainMse: mse(train, w), holdoutMse: mse(hold, w),
    baseOnlyHoldoutMse: mse(hold, w0v.map(() => 0)),
    note: 'UNPROMOTED until gate stack passes',
  }, null, 2));
  console.log(`wrote ${OUT}`);
  KEYS.forEach((k, i) => console.log(`  ${k.padEnd(24)} ${w0v[i].toFixed(2).padStart(8)} -> ${w[i].toFixed(2).padStart(8)}`));
}

main();
