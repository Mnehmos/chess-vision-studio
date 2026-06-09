// PV-leaf attribution for a single position. Force-searches each candidate ROOT
// move (under both the default and the Rung-2 mixed eval), walks each PV to its
// terminal leaf, and compares CVS-default / CVS-mixed / Stockfish evals at the
// leaf — to localize WHERE the mixed eval diverges from truth in a way that flips
// the root move choice. Answers: bad leaf eval vs horizon/quiescence vs search
// bookkeeping. Read-only.
//
//   npm run pv:attribution -- --fen "<FEN>" --moves "Rf7,Bf7" --depth 4
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import {
  CvsEngine,
  combinedPartials,
  evaluateWhite,
  flattenRung2,
  flattenValueWeights,
  loadDataset,
  RUNG2_KEYS,
  DEFAULT_POLICY_WEIGHTS,
  DEFAULT_VALUE_WEIGHTS,
  DEFAULT_RUNG2_WEIGHTS,
  type PolicyWeights,
  type Rung2Weights,
  type ValueWeights,
} from '@cvs/engine';
import { UciEngine } from '../engine/evaluation';
import { createNodeStockfishTransport } from '../engine/stockfish-node';

interface Cfg {
  fen: string;
  index: number; // alternative to --fen: pull fen from dataset index
  input: string;
  moves: string[]; // SAN candidate root moves
  policy: string;
  base: string;
  rung2: string;
  depth: number;
  qualityDepth: number;
}
const DEFAULT_CONFIG: Cfg = {
  fen: '',
  index: -1,
  input: 'arena/out/combined-multipv.jsonl',
  moves: [],
  policy: 'arena/out/weights.json',
  base: 'arena/out/value-weights-mixed.json',
  rung2: 'arena/out/rung2-weights-mixed.json',
  depth: 4,
  qualityDepth: 10,
};

const j = (p: string, d: unknown) => (p === 'default' ? d : JSON.parse(readFileSync(p, 'utf8')));
const fmt = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(0);

function whitePovSf(leafFen: string, cp: number | undefined, mate: number | undefined): number | null {
  const stm = new Chess(leafFen).turn();
  if (typeof mate === 'number') return (stm === 'w' ? 1 : -1) * (mate > 0 ? 3000 : -3000);
  if (typeof cp === 'number') return stm === 'w' ? cp : -cp;
  return null;
}

function replayPv(fen: string, pv: string[]): string {
  const c = new Chess(fen);
  for (const lan of pv) {
    try {
      if (!c.move({ from: lan.slice(0, 2), to: lan.slice(2, 4), promotion: lan.slice(4) || undefined })) break;
    } catch {
      break;
    }
  }
  return c.fen();
}

export async function attribute(cfg: Cfg = DEFAULT_CONFIG, log: (m: string) => void = (m) => console.log(m)): Promise<void> {
  let fen = cfg.fen;
  if (!fen && cfg.index >= 0) fen = loadDataset(cfg.input)[cfg.index]!.fen;
  if (!fen) {
    log('provide --fen or --index');
    return;
  }
  const policy = j(cfg.policy, DEFAULT_POLICY_WEIGHTS) as PolicyWeights;
  const base = j(cfg.base, DEFAULT_VALUE_WEIGHTS) as ValueWeights;
  const rung2 = j(cfg.rung2, DEFAULT_RUNG2_WEIGHTS) as Rung2Weights;
  const engines = {
    default: new CvsEngine({ weights: policy }),
    mixed: new CvsEngine({ weights: policy, valueWeights: base, rung2Weights: rung2 }),
  };
  const parentStm = new Chess(fen).turn();

  const transport = await createNodeStockfishTransport();
  const sf = new UciEngine(transport);
  try {
    log(`PV-leaf attribution @ depth ${cfg.depth} (SF leaf depth ${cfg.qualityDepth})`);
    log(`FEN: ${fen}  (${parentStm === 'w' ? 'White' : 'Black'} to move)`);

    for (const which of ['mixed', 'default'] as const) {
      const eng = engines[which];
      log(`\n### ${which.toUpperCase()} engine — root move scores (parent POV, higher = preferred) ###`);
      log(`| Move | Search score | Leaf CVS-${which} | Leaf SF | Error(CVS−SF) | PV |`);
      log(`|---|---:|---:|---:|---:|---|`);
      const rows: { move: string; score: number; leafFen: string; pv: string[] }[] = [];
      for (const san of cfg.moves) {
        const c = new Chess(fen);
        let moved;
        try {
          moved = c.move(san);
        } catch {
          moved = null;
        }
        if (!moved) {
          log(`| ${san} | (illegal) | | | | |`);
          continue;
        }
        const childFen = c.fen();
        const res = eng.analyze(childFen, { depth: Math.max(1, cfg.depth - 1) });
        const score = -res.scoreCp; // parent-POV value of the move (negamax)
        const pv = [moved.lan, ...res.pv];
        const leafFen = replayPv(fen, pv);
        rows.push({ move: san, score, leafFen, pv });
        // Leaf evals (White POV).
        const leafChess = new Chess(leafFen);
        const cvsLeaf = evaluateWhite(leafChess, which === 'mixed' ? base : DEFAULT_VALUE_WEIGHTS, which === 'mixed' ? rung2 : DEFAULT_RUNG2_WEIGHTS);
        let sfLeaf: number | null = null;
        try {
          const e = await sf.evaluate({ fen: leafFen, depth: cfg.qualityDepth });
          if (e.status !== 'unavailable') sfLeaf = whitePovSf(leafFen, e.cp, e.mate);
        } catch {
          /* ignore */
        }
        const err = sfLeaf === null ? NaN : cvsLeaf - sfLeaf;
        log(`| ${san} | ${fmt(score)} | ${fmt(cvsLeaf)} | ${sfLeaf === null ? 'n/a' : fmt(sfLeaf)} | ${Number.isNaN(err) ? 'n/a' : fmt(err)} | ${pv.join(' ')} |`);
      }
      // Which move does this engine prefer?
      if (rows.length >= 2) {
        rows.sort((a, b) => b.score - a.score);
        log(`  → ${which} prefers ${rows[0]!.move} (score ${fmt(rows[0]!.score)}) over ${rows[1]!.move} (score ${fmt(rows[1]!.score)})`);
      }
    }

    // Smoking-gun: for each candidate, the mixed-PV leaf's Rung-2 contribution breakdown vs SF error.
    log(`\n### Mixed-PV leaf Rung-2 attribution (White POV cp) ###`);
    for (const san of cfg.moves) {
      const c = new Chess(fen);
      let moved;
      try {
        moved = c.move(san);
      } catch {
        moved = null;
      }
      if (!moved) continue;
      const res = engines.mixed.analyze(c.fen(), { depth: Math.max(1, cfg.depth - 1) });
      const pv = [moved.lan, ...res.pv];
      const leafFen = replayPv(fen, pv);
      const leaf = new Chess(leafFen);
      const parts = combinedPartials(leaf);
      const flat = [...flattenValueWeights(base), ...flattenRung2(rung2)];
      const cvsDef = evaluateWhite(leaf, DEFAULT_VALUE_WEIGHTS, DEFAULT_RUNG2_WEIGHTS);
      const cvsMix = evaluateWhite(leaf, base, rung2);
      let sfLeaf: number | null = null;
      try {
        const e = await sf.evaluate({ fen: leafFen, depth: cfg.qualityDepth });
        if (e.status !== 'unavailable') sfLeaf = whitePovSf(leafFen, e.cp, e.mate);
      } catch {
        /* ignore */
      }
      log(`\n${san} → leaf ${leafFen}`);
      log(`  CVS default ${fmt(cvsDef)} | CVS mixed ${fmt(cvsMix)} | SF ${sfLeaf === null ? 'n/a' : fmt(sfLeaf)} | mixed−SF ${sfLeaf === null ? 'n/a' : fmt(cvsMix - sfLeaf)} | mixed−default ${fmt(cvsMix - cvsDef)}`);
      const r2 = RUNG2_KEYS.map((k, i) => ({ k, c: flat[8 + i]! * parts[8 + i]!, feat: parts[8 + i]! }))
        .filter((x) => Math.abs(x.c) > 0.5)
        .sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
      log(`  Rung-2 contributions: ${r2.map((x) => `${x.k} ${fmt(x.c)}(f${x.feat.toFixed(1)})`).join(' · ')}`);
    }
    log(`\nReading: if the move the mixed engine PREFERS has a large positive mixed−SF error at its leaf, the eval over-values that leaf (capacity/quiescence gap). If both leaves are evaluated well but the worse move still scores higher, suspect search bookkeeping (sign/TT/ordering/quiescence).`);
  } finally {
    sf.dispose();
  }
}

function parseArgs(argv: string[]): Cfg {
  const cfg = { ...DEFAULT_CONFIG };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--fen') cfg.fen = next();
    else if (a === '--index') cfg.index = Number(next());
    else if (a === '--input') cfg.input = next();
    else if (a === '--moves') cfg.moves = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--policy') cfg.policy = next();
    else if (a === '--base') cfg.base = next();
    else if (a === '--rung2') cfg.rung2 = next();
    else if (a === '--depth') cfg.depth = Number(next()) || cfg.depth;
  }
  return cfg;
}

if (!process.env.VITEST) {
  attribute(parseArgs(process.argv.slice(2))).catch((e) => {
    console.error('pv-attribution failed:', e);
    process.exit(1);
  });
}
