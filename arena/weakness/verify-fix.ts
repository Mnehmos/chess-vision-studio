// Direct fix-verification — does --rootsafequiet repair the WEAKNESS TABLE (not just Elo)?
//
// For each recorded miss (a position where SF-d24 preferred a move CVS skipped), re-search
// fenBefore with CVS-baseline and CVS-rootsafequiet at a FIXED time budget, 1 thread
// (deterministic, isolates the flag's root-ordering effect), and check whether each now
// plays SF's preferred move. The flag is ordering-only, so at fixed DEPTH it would be a
// no-op; the benefit only shows at fixed TIME (better ordering -> deeper in the same time).
//
// Killer number: on the `missedSafeQuiet` positions, rsqHit% − baseHit% = how much the
// flag recovers the safe quiet CVS was skipping. That is the table fix, measured directly.
//
// Run: npx vite-node --script arena/weakness/verify-fix.ts
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { RustBackend, rustBackendExtraArgs } from '../engine-backend/rust-backend';

const norm = (s: string) => s.replace(/[+#!?]/g, '').trim();
function sanToUci(fen: string, san: string): string | null {
  try {
    const c = new Chess(fen);
    const m = (c.moves({ verbose: true }) as Array<{ san: string; from: string; to: string; promotion?: string }>)
      .find((x) => norm(x.san) === norm(san));
    return m ? m.from + m.to + (m.promotion ?? '') : null;
  } catch {
    return null;
  }
}

interface Miss { fenBefore: string; sfBestSan: string; tag: string; missedSafeQuiet: boolean; cpLoss: number }

const mk = (flag: '0' | '1') =>
  new RustBackend({
    extraArgs: rustBackendExtraArgs({
      ...process.env,
      CVS_RUST_SMARTTIME: '0',
      CVS_RUST_THREADS: '1',
      CVS_RUST_CVS_HELPERS: '0',
      CVS_RUST_ROOTSAFEQUIET: flag,
    }),
  });

async function main() {
  // Two configs A vs B, each parameterized by budget + rootsafequiet flag, both compared
  // to SF's preferred move. Default = ordering test (A=base@1200, B=rsq@1200). For the
  // depth-vs-eval diagnostic: A=base@1200, B=base@4000 (VERIFY_B_BUDGET_MS=4000 VERIFY_B_RSQ=0).
  const A_BUDGET = Number(process.env.VERIFY_A_BUDGET_MS ?? process.env.VERIFY_BUDGET_MS ?? 1200);
  const B_BUDGET = Number(process.env.VERIFY_B_BUDGET_MS ?? A_BUDGET);
  const A_RSQ = (process.env.VERIFY_A_RSQ ?? '0') === '1' ? '1' : '0';
  const B_RSQ = (process.env.VERIFY_B_RSQ ?? '1') === '1' ? '1' : '0';
  const misses: Miss[] = readFileSync('arena/out/weakness/misses.jsonl', 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Miss);
  const CAP = Number(process.env.VERIFY_CAP ?? misses.length);
  console.log(`verify-fix: ${Math.min(CAP, misses.length)} misses | 1 thread | A=rsq${A_RSQ}@${A_BUDGET}ms (base→) vs B=rsq${B_RSQ}@${B_BUDGET}ms (rsq→)`);

  const base = mk(A_RSQ as '0' | '1');
  const rsq = mk(B_RSQ as '0' | '1');
  type S = { n: number; baseHit: number; rsqHit: number; changed: number; sqN: number; sqBase: number; sqRsq: number };
  const stats: Record<string, S> = {};
  let done = 0;

  for (const m of misses.slice(0, CAP)) {
    const sfUci = sanToUci(m.fenBefore, m.sfBestSan);
    if (!sfUci) continue;
    let b: string | null = null;
    let r: string | null = null;
    try { b = (await base.bestMoveTimed(m.fenBefore, A_BUDGET)).uci; } catch { /* skip */ }
    try { r = (await rsq.bestMoveTimed(m.fenBefore, B_BUDGET)).uci; } catch { /* skip */ }
    if (!b || !r) continue;
    const s = (stats[m.tag] ??= { n: 0, baseHit: 0, rsqHit: 0, changed: 0, sqN: 0, sqBase: 0, sqRsq: 0 });
    s.n++;
    if (b === sfUci) s.baseHit++;
    if (r === sfUci) s.rsqHit++;
    if (r !== b) s.changed++;
    if (m.missedSafeQuiet) {
      s.sqN++;
      if (b === sfUci) s.sqBase++;
      if (r === sfUci) s.sqRsq++;
    }
    if (++done % 25 === 0) console.log(`  ${done} positions...`);
  }
  base.dispose();
  rsq.dispose();

  const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);
  console.log('\n=== Does --rootsafequiet recover SF-preferred moves on the missed positions? ===');
  console.log('| category | misses | base→SF% | rsq→SF% | changed% | safeQuiet n | sq base→SF% | **sq rsq→SF%** |');
  console.log('|---|---|---|---|---|---|---|---|');
  const tot: S = { n: 0, baseHit: 0, rsqHit: 0, changed: 0, sqN: 0, sqBase: 0, sqRsq: 0 };
  for (const [t, s] of Object.entries(stats).sort((a, b) => b[1].n - a[1].n)) {
    (Object.keys(tot) as (keyof S)[]).forEach((k) => (tot[k] += s[k]));
    console.log(`| ${t} | ${s.n} | ${pct(s.baseHit, s.n)}% | ${pct(s.rsqHit, s.n)}% | ${pct(s.changed, s.n)}% | ${s.sqN} | ${pct(s.sqBase, s.sqN)}% | **${pct(s.sqRsq, s.sqN)}%** |`);
  }
  console.log(`| **TOTAL** | ${tot.n} | ${pct(tot.baseHit, tot.n)}% | ${pct(tot.rsqHit, tot.n)}% | ${pct(tot.changed, tot.n)}% | ${tot.sqN} | ${pct(tot.sqBase, tot.sqN)}% | **${pct(tot.sqRsq, tot.sqN)}%** |`);
  console.log(`\nThe table is fixed insofar as 'sq rsq→SF%' exceeds 'sq base→SF%' (safe quiets recovered).`);
  setTimeout(() => process.exit(0), 300);
}

main().catch((e) => { console.error('verify-fix failed:', e); process.exit(1); });
