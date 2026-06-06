// Triangulation harness for an EXTERNAL (ChatGPT-authored) motif dataset.
// Drop the model's JSON at fixtures/chatgpt-cases.json and run this file. We
// cross-check three independent signals per case:
//   (A) the model's label/isPositive,
//   (B) our geometric DETECTOR,
//   (C) our search ORACLE (does the stated solution actually win?).
// (C) filters model hallucinations; (A)≠(B) on oracle-confirmed cases = a bug.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Chess } from 'chess.js';
import { findRemovalOfGuard, findDiscoveredCheck } from '../motif';
import { detectAllMotifs } from '../detectall';
import { tacticalOutcome } from '../tacticsearch';

interface ExtCase {
  id: string;
  fen: string;
  motif: string;
  isPositive: boolean;
  lookAlikeOf?: string | null;
  solution?: string[];
  expectedOutcome?: string;
  themes?: string[];
}

const FILE = join(__dirname, '../../fixtures/chatgpt-cases.json');

function uciToSan(fen: string, uci: string): string | null {
  try {
    const c = new Chess(fen);
    const m = c.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
    });
    return m ? m.san : null;
  } catch {
    return null;
  }
}

function legalFen(fen: string): boolean {
  try {
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
}

/**
 * Does our COMPREHENSIVE detector fire for this case? Uses detectAllMotifs
 * (Tier-1 + gated mate proof + skewer/pin tactics + Tier-2), matching the
 * solution's key move; plus the move-aware before/after detectors.
 */
function detectorFires(c: ExtCase): boolean {
  const key = c.solution?.[0] ? uciToSan(c.fen, c.solution[0]) : null;

  // Move-aware motifs need before/after the played move.
  if (c.motif === 'discovered_check' || c.motif === 'removal_of_guard') {
    if (!key) return false;
    try {
      const ch = new Chess(c.fen);
      ch.move(key);
      const r =
        c.motif === 'discovered_check'
          ? findDiscoveredCheck(c.fen, ch.fen())
          : findRemovalOfGuard(c.fen, ch.fen());
      return r.motifs.length > 0;
    } catch {
      return false;
    }
  }

  const all = detectAllMotifs(c.fen, { mateBudgetMs: 2500 });
  // a move-producing tactic: our detected motif starts with the solution key move
  if (key && all.some((m) => m.line[0] === key)) return true;
  // a static (s)pin already on the board that the solution exploits
  if (['pin_absolute', 'pin_relative', 'skewer'].includes(c.motif))
    return all.some((m) => m.type === c.motif);
  return false;
}

/** Search oracle: does the stated solution actually win material / force mate? */
function oracleConfirms(c: ExtCase): boolean {
  const first = c.solution?.[0];
  const san = first ? uciToSan(c.fen, first) : null;
  if (!san) return false;
  const ch = new Chess(c.fen);
  ch.move(san);
  const out = tacticalOutcome(ch.fen(), 6);
  if (out.mateInPlies !== null) return out.mateInPlies < 0; // opponent gets mated
  return -out.gain >= 1.5; // mover wins ≥ the exchange
}

const hasFile = existsSync(FILE);

describe.skipIf(!hasFile)('external dataset (ChatGPT) triangulation', () => {
  const raw = hasFile ? JSON.parse(readFileSync(FILE, 'utf8')) : { cases: [] };
  const cases: ExtCase[] = raw.cases ?? [];

  // Tier-1 motifs we currently claim as MOVE-producing detectors (the others —
  // skewer-as-move-solver, mate-in-2/3, and all Tier-2 — are openly on the roadmap).
  const CLAIMED = new Set(['fork', 'back_rank', 'discovered_check']);

  it('parses and reports the triangulation matrix', () => {
    let legal = 0;
    let oracleOk = 0;
    let claimedOk = 0;
    let claimedAgree = 0;
    let detectedOracle = 0; // ANY oracle-confirmed positive the detector fires on
    const mislabels: string[] = []; // model says positive+wins, oracle finds no win
    const gaps: string[] = []; // oracle confirms a win but our detector misses

    for (const c of cases) {
      if (!legalFen(c.fen)) continue;
      legal++;
      if (!c.isPositive || c.motif === 'none') continue;
      if (oracleConfirms(c)) {
        oracleOk++;
        const fires = detectorFires(c);
        if (fires) detectedOracle++;
        if (CLAIMED.has(c.motif)) {
          claimedOk++;
          if (fires) claimedAgree++;
          else gaps.push(`${c.id} (${c.motif}) — REGRESSION: claimed motif, detector missed`);
        } else if (!fires) {
          gaps.push(`${c.id} (${c.motif}) — roadmap gap`);
        }
      } else {
        mislabels.push(`${c.id} (${c.motif})`);
      }
    }

    console.log(`\nExternal dataset: ${cases.length} cases (${legal} legal FENs)`);
    console.log(`  oracle-confirmed positive wins: ${oracleOk}`);
    console.log(`  detectAllMotifs found:          ${detectedOracle}/${oracleOk} (was 14/30 with Tier-1 only)`);
    console.log(`  CLAIMED Tier-1 motifs detected: ${claimedAgree}/${claimedOk}`);
    console.log(`  model over-claims our oracle REFUTED (e.g. pin "wins" that are even trades): ${mislabels.length}`);
    if (mislabels.length) console.log('   ' + mislabels.join('\n   '));
    if (gaps.length) console.log('  GAPS (roadmap vs regression):\n   ' + gaps.join('\n   '));

    // Floor on the comprehensive detector — the proof-obligation integration lifted
    // detection from 14/30 to (near) 30/30 on oracle-confirmed positives.
    if (claimedOk >= 5) expect(claimedAgree / claimedOk).toBeGreaterThan(0.85);
    if (oracleOk >= 10) expect(detectedOracle / oracleOk).toBeGreaterThan(0.8);
  });
});

describe.skipIf(hasFile)('external dataset (not present)', () => {
  it('is skipped until fixtures/chatgpt-cases.json exists', () => {
    expect(true).toBe(true);
  });
});
