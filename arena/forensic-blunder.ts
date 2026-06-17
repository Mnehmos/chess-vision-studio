// Forensic blunder finder. Replays the depth-4 holdout gate, finds every position
// where the Rung-2 mixed engine's SEARCHED move is a blunder (cpLoss ≥ 2 pawns vs
// Stockfish), and dumps a full diff per blunder: the moves (default / mixed / SF),
// cpLoss for each, PVs, the value-term breakdown of the two candidate children,
// which Rung-2 features caused the ordering flip, and SEE / hanging / mate /
// king-safety guardrail checks on the mixed move. Read-only; changes no weights.
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import {
  CvsEngine,
  combinedPartials,
  extractRung2Features,
  flattenRung2,
  flattenValueWeights,
  loadDataset,
  see,
  DEFAULT_POLICY_WEIGHTS,
  DEFAULT_VALUE_WEIGHTS,
  DEFAULT_RUNG2_WEIGHTS,
  RUNG2_KEYS,
  type PolicyWeights,
  type Rung2Weights,
  type ValueWeights,
} from '@cvs/engine';
import { UciEngine } from '../engine/evaluation';
import { createNodeStockfishTransport } from '../engine/stockfish-node';
import { computeCpLoss } from '../engine/classify';
import { DEFAULT_STOCKFISH_REVIEW_DEPTH } from './review-config';

interface Cfg {
  input: string;
  policy: string;
  base: string;
  rung2: string;
  offset: number;
  positions: number;
  depth: number;
  qualityDepth: number;
  blunderCp: number;
  onlyIndex: number; // -1 = scan; otherwise analyze just this dataset index
}
const DEFAULT_CONFIG: Cfg = {
  input: 'arena/out/combined-multipv.jsonl',
  policy: 'arena/out/weights.json',
  base: 'arena/out/value-weights-mixed.json',
  rung2: 'arena/out/rung2-weights-mixed.json',
  offset: 543,
  positions: 95,
  depth: 4,
  qualityDepth: DEFAULT_STOCKFISH_REVIEW_DEPTH,
  blunderCp: 2, // pawns
  onlyIndex: -1,
};

const j = (p: string, d: unknown) => (p === 'default' ? d : JSON.parse(readFileSync(p, 'utf8')));

function applyUci(fen: string, uci: string): string | null {
  const c = new Chess(fen);
  try {
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    return m ? c.fen() : null;
  } catch {
    return null;
  }
}

/** Per-term White-POV contribution breakdown of a (non-terminal) position. */
function breakdown(fen: string, base: ValueWeights, rung2: Rung2Weights) {
  const c = new Chess(fen);
  const terminal = c.isCheckmate() || c.isStalemate() || c.isInsufficientMaterial() || c.isDraw();
  const parts = combinedPartials(c);
  const flat = [...flattenValueWeights(base), ...flattenRung2(rung2)];
  const contrib = parts.map((p, k) => flat[k]! * p);
  const baseLabels = ['mat.p', 'mat.n', 'mat.b', 'mat.r', 'mat.q', 'pstScale', 'bishopPair', 'tempo'];
  return {
    terminal,
    total: contrib.reduce((a, b) => a + b, 0),
    baseTotal: contrib.slice(0, 8).reduce((a, b) => a + b, 0),
    base: baseLabels.map((l, i) => ({ l, c: contrib[i]! })),
    rung2: RUNG2_KEYS.map((key, i) => ({ key, c: contrib[8 + i]!, feat: parts[8 + i]! })),
    parts,
  };
}

function fmtCp(x: number): string {
  return (x >= 0 ? '+' : '') + x.toFixed(0);
}

export async function forensic(cfg: Cfg = DEFAULT_CONFIG, log: (m: string) => void = (m) => console.log(m)): Promise<void> {
  const all = loadDataset(cfg.input);
  const slice = all.slice(cfg.offset, cfg.offset + cfg.positions);
  const policy = j(cfg.policy, DEFAULT_POLICY_WEIGHTS) as PolicyWeights;
  const base = j(cfg.base, DEFAULT_VALUE_WEIGHTS) as ValueWeights;
  const rung2 = j(cfg.rung2, DEFAULT_RUNG2_WEIGHTS) as Rung2Weights;
  const def = new CvsEngine({ weights: policy });
  const mix = new CvsEngine({ weights: policy, valueWeights: base, rung2Weights: rung2 });

  const transport = await createNodeStockfishTransport();
  const sf = new UciEngine(transport);
  const blunders: number[] = [];
  try {
    log(`scanning ${slice.length} positions [${cfg.offset}..${cfg.offset + cfg.positions}) @ CVS depth ${cfg.depth}, SF depth ${cfg.qualityDepth}…`);
    for (let i = 0; i < slice.length; i++) {
      const fen = slice[i]!.fen;
      const datasetIdx = cfg.offset + i;
      if (cfg.onlyIndex >= 0 && datasetIdx !== cfg.onlyIndex) continue;
      let before;
      try {
        before = await sf.evaluate({ fen, depth: cfg.qualityDepth });
      } catch {
        continue;
      }
      if (before.status === 'unavailable' || !before.pv?.[0]) continue;
      const mixPick = mix.bestMove(fen, { depth: cfg.depth });
      if (!mixPick) continue;
      const fenAfterMix = applyUci(fen, mixPick.uci);
      if (!fenAfterMix) continue;
      let afterMix;
      try {
        afterMix = await sf.evaluate({ fen: fenAfterMix, depth: cfg.qualityDepth });
      } catch {
        continue;
      }
      const mixLoss = Math.max(0, computeCpLoss(before, afterMix));
      if (cfg.onlyIndex < 0 && mixLoss < cfg.blunderCp) continue;

      // Found a blunder (or the requested index) — full forensic dump.
      blunders.push(datasetIdx);
      const stm = new Chess(fen).turn();
      const defPick = def.bestMove(fen, { depth: cfg.depth });
      const fenAfterDef = defPick ? applyUci(fen, defPick.uci) : null;
      let defLoss = NaN;
      if (fenAfterDef) {
        try {
          const afterDef = await sf.evaluate({ fen: fenAfterDef, depth: cfg.qualityDepth });
          defLoss = Math.max(0, computeCpLoss(before, afterDef));
        } catch {
          /* ignore */
        }
      }
      const sfBest = before.pv[0]!;
      const mixPv = mix.analyze(fen, { depth: cfg.depth }).pv;

      log(`\n${'='.repeat(78)}`);
      log(`BLUNDER @ dataset index ${cfg.offset + i}`);
      log(`FEN: ${fen}`);
      log(`side to move: ${stm === 'w' ? 'White' : 'Black'}`);
      log(`SF best (d${cfg.qualityDepth}): ${sfBest}   SF eval(before): ${before.mate !== undefined ? 'M' + before.mate : fmtCp(before.cp ?? 0) + 'cp (stm POV)'}`);
      log(`default move (d${cfg.depth}): ${defPick?.san ?? '(none)'}   cpLoss ${(defLoss).toFixed(2)} pawns`);
      log(`Rung-2 mixed move (d${cfg.depth}): ${mixPick.san}   cpLoss ${mixLoss.toFixed(2)} pawns${mixLoss >= cfg.blunderCp ? '  <-- BLUNDER' : ''}`);
      log(`mixed PV: ${mixPv.join(' ')}`);
      log(`SF PV: ${before.pv.join(' ')}`);

      // Value-term breakdown of the two candidate CHILDREN (under mixed weights).
      if (fenAfterDef && fenAfterMix) {
        const parentSign = stm === 'w' ? 1 : -1;
        const bd = breakdown(fenAfterDef, base, rung2);
        const bm = breakdown(fenAfterMix, base, rung2);
        log(`\n-- leaf eval (White POV cp) of the two children, under MIXED weights --`);
        log(`  after default ${defPick?.san}: total ${fmtCp(bd.total)}  (base ${fmtCp(bd.baseTotal)})${bd.terminal ? ' [terminal]' : ''}`);
        log(`  after mixed   ${mixPick.san}: total ${fmtCp(bm.total)}  (base ${fmtCp(bm.baseTotal)})${bm.terminal ? ' [terminal]' : ''}`);
        log(`  parent prefers the move maximizing parentSign*childEval (parentSign=${parentSign}):`);
        log(`    pref(default) = ${fmtCp(parentSign * bd.total)}   pref(mixed) = ${fmtCp(parentSign * bm.total)}`);

        // Which Rung-2 features tilted the parent toward the mixed (blundering) move.
        const flips = RUNG2_KEYS.map((key, idx) => {
          const k = 8 + idx;
          const delta = parentSign * (flattenRung2(rung2)[idx]! * (bm.parts[k]! - bd.parts[k]!));
          return { key, delta, wMix: rung2[key], featMix: bm.parts[k]!, featDef: bd.parts[k]! };
        })
          .filter((f) => Math.abs(f.delta) > 0.5)
          .sort((a, b) => b.delta - a.delta);
        log(`\n-- Rung-2 features tilting the parent toward the mixed move (+ = pushed the blunder) --`);
        for (const f of flips) {
          log(`  ${f.key.padEnd(20)} Δpref ${fmtCp(f.delta)}cp  (w=${f.wMix.toFixed(2)}, feat def=${f.featDef.toFixed(2)} → mix=${f.featMix.toFixed(2)})`);
        }
        if (flips.length === 0) log(`  (none > 0.5cp — the flip is base/PST or deeper-search driven, not a single Rung-2 term)`);
      }

      // Guardrails on the mixed move.
      log(`\n-- guardrails on the mixed move ${mixPick.san} --`);
      const from = mixPick.uci.slice(0, 2);
      const to = mixPick.uci.slice(2, 4);
      const seeVal = see(fen, from as Square, to as Square);
      log(`  SEE(${from}${to}) = ${seeVal}${seeVal < 0 ? '  <-- LOSING capture/exchange (SEE<0)' : ''}`);
      const childMix = new Chess(fenAfterMix);
      const hang = extractRung2Features(childMix).hangingPiece; // White-POV pawns; <0 means White hangs more
      const moverHang = stm === 'w' ? -Math.min(0, hang) : Math.max(0, hang);
      log(`  hanging after move (mover's hanging material, pawns): ${moverHang.toFixed(2)}${moverHang > 0 ? '  <-- left material hanging' : ''}`);
      let oppMate = false;
      for (const mv of childMix.moves()) {
        const t = new Chess(fenAfterMix);
        t.move(mv);
        if (t.isCheckmate()) {
          oppMate = true;
          break;
        }
      }
      log(`  allows opponent mate-in-1: ${oppMate ? 'YES  <-- mate guardrail violated' : 'no'}`);
      const kzNow = extractRung2Features(new Chess(fen)).kingZonePressure;
      const kzAfter = extractRung2Features(childMix).kingZonePressure;
      log(`  kingZonePressure (W-POV, + = Black king more pressured): ${kzNow.toFixed(1)} → ${kzAfter.toFixed(1)}`);

      // PV-tip leaf: the position the depth search over-values (horizon localization).
      const tip = new Chess(fen);
      let tipOk = mixPv.length > 0;
      for (const mv of mixPv) {
        try {
          if (!tip.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv.slice(4) || undefined })) {
            tipOk = false;
            break;
          }
        } catch {
          tipOk = false;
          break;
        }
      }
      if (tipOk) {
        const tipFen = tip.fen();
        const tipMix = breakdown(tipFen, base, rung2);
        const tipDef = breakdown(tipFen, DEFAULT_VALUE_WEIGHTS, DEFAULT_RUNG2_WEIGHTS);
        let tipSf;
        try {
          tipSf = await sf.evaluate({ fen: tipFen, depth: cfg.qualityDepth });
        } catch {
          /* ignore */
        }
        log(`\n-- PV-tip leaf (after mixed PV ${mixPv.join(' ')}) — where the horizon misjudgment lives --`);
        log(`  tip FEN: ${tipFen}`);
        log(`  mixed-eval(tip) ${fmtCp(tipMix.total)}  vs  default-eval(tip) ${fmtCp(tipDef.total)}  (Δ ${fmtCp(tipMix.total - tipDef.total)}cp from Rung-2)`);
        if (tipSf && tipSf.status !== 'unavailable') {
          log(`  SF eval(tip, d${cfg.qualityDepth}) ${tipSf.mate !== undefined ? 'M' + tipSf.mate : fmtCp(tipSf.cp ?? 0) + 'cp (stm POV)'}`);
        }
        const tipRung2 = tipMix.rung2.filter((r) => Math.abs(r.c) > 0.5).sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
        log(`  Rung-2 contributions at tip (what mixed adds over default, White POV cp):`);
        for (const r of tipRung2) log(`    ${r.key.padEnd(20)} ${fmtCp(r.c)}cp (feat ${r.feat.toFixed(2)})`);
      }
    }
    if (blunders.length === 0) log(`\nNo blunder (cpLoss ≥ ${cfg.blunderCp}) found for the mixed engine in this slice/depth.`);
    else log(`\n${blunders.length} blunder(s) found at indices: ${blunders.join(', ')}`);
  } finally {
    sf.dispose();
  }
}

function parseArgs(argv: string[]): Cfg {
  const cfg = { ...DEFAULT_CONFIG };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--input') cfg.input = next();
    else if (a === '--policy') cfg.policy = next();
    else if (a === '--base') cfg.base = next();
    else if (a === '--rung2') cfg.rung2 = next();
    else if (a === '--offset') cfg.offset = Number(next()) || 0;
    else if (a === '--positions') cfg.positions = Number(next()) || cfg.positions;
    else if (a === '--depth') cfg.depth = Number(next()) || cfg.depth;
    else if (a === '--index') cfg.onlyIndex = Number(next());
  }
  return cfg;
}

if (!process.env.VITEST) {
  forensic(parseArgs(process.argv.slice(2))).catch((e) => {
    console.error('forensic failed:', e);
    process.exit(1);
  });
}
