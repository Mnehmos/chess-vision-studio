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
import { findForks, findMatesIn1, findPinsAndSkewers, findRemovalOfGuard, findDiscoveredCheck } from '../motif';
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

/** Does our detector fire for this case's motif on its key move/position? */
function detectorFires(c: ExtCase): boolean {
  const key = c.solution?.[0] ? uciToSan(c.fen, c.solution[0]) : null;
  switch (c.motif) {
    case 'fork':
      return key ? findForks(c.fen).motifs.some((m) => m.line[0] === key) : false;
    case 'mating_net':
    case 'back_rank':
      return key ? findMatesIn1(c.fen).motifs.some((m) => m.line[0] === key) : false;
    case 'pin_absolute':
    case 'pin_relative':
    case 'skewer':
      return (
        findPinsAndSkewers(c.fen, 'w').motifs.some((m) => m.type === c.motif) ||
        findPinsAndSkewers(c.fen, 'b').motifs.some((m) => m.type === c.motif)
      );
    case 'discovered_check':
      if (!key) return false;
      try {
        const ch = new Chess(c.fen);
        ch.move(key);
        return findDiscoveredCheck(c.fen, ch.fen()).motifs.length > 0;
      } catch {
        return false;
      }
    case 'removal_of_guard':
      if (!key) return false;
      try {
        const ch = new Chess(c.fen);
        ch.move(key);
        return findRemovalOfGuard(c.fen, ch.fen()).motifs.length > 0;
      } catch {
        return false;
      }
    default:
      return false; // Tier-2 not yet covered
  }
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

  it('parses and reports the triangulation matrix', () => {
    let legal = 0;
    let oracleOk = 0; // model-positive cases the oracle confirms
    let detAgree = 0; // of those, how many our detector also fires on
    const mislabels: string[] = []; // model says positive, oracle says it doesn't win
    const bugs: string[] = []; // oracle confirms a win but our detector misses it

    for (const c of cases) {
      if (!legalFen(c.fen)) continue;
      legal++;
      if (c.isPositive && c.motif !== 'none') {
        const oracle = oracleConfirms(c);
        if (oracle) {
          oracleOk++;
          if (detectorFires(c)) detAgree++;
          else bugs.push(`${c.id} (${c.motif}): oracle wins but detector misses`);
        } else {
          mislabels.push(`${c.id} (${c.motif}): model-positive but oracle finds no win`);
        }
      }
    }

    console.log(`\nExternal dataset: ${cases.length} cases (${legal} legal FENs)`);
    console.log(`  oracle-confirmed positives: ${oracleOk}`);
    console.log(`  detector agreed on:         ${detAgree}/${oracleOk}`);
    console.log(`  model mislabels (oracle disagrees): ${mislabels.length}`);
    if (mislabels.length) console.log('   ' + mislabels.slice(0, 15).join('\n   '));
    if (bugs.length) console.log('  DETECTOR GAPS:\n   ' + bugs.slice(0, 25).join('\n   '));

    // Floor: on positives BOTH our oracle confirms, our detector should mostly agree.
    if (oracleOk >= 5) expect(detAgree / oracleOk).toBeGreaterThan(0.5);
  });
});

describe.skipIf(hasFile)('external dataset (not present)', () => {
  it('is skipped until fixtures/chatgpt-cases.json exists', () => {
    expect(true).toBe(true);
  });
});
