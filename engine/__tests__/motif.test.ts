// M5 DoD (HARDEST PUZZLE) — Tier-1 motifs through PROPOSE → VALIDATE → LOG.
// For every motif type: (1) a proven-POSITIVE fixture detects & validates it,
// and (2) a proven-NEGATIVE fixture (looks like the motif but isn't) is REJECTED
// and never emitted. The rejection is the test of record (Invariant 7).
import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import {
  findForks,
  findPinsAndSkewers,
  findMatesIn1,
  findRemovalOfGuard,
  findDiscoveredCheck,
} from '../motif';
import { analyzeMove } from '../saliency';
import type { ChangedRelation, Eval } from '../types';

const after = (fen: string, san: string): string => {
  const c = new Chess(fen);
  c.move(san);
  return c.fen();
};
const has = (ms: { type: string }[], t: string) => ms.some((m) => m.type === t);

// ── FORK ─────────────────────────────────────────────────────────────────────
describe('M5 — fork', () => {
  it('POSITIVE: Nc7+ forks the king and rook and wins the rook in every reply', () => {
    const { motifs } = findForks('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1');
    const fork = motifs.find((m) => m.type === 'fork');
    expect(fork).toBeDefined();
    expect(fork!.materialSwing).toBe(5); // wins the rook
    expect(fork!.line[0]).toBe('Nc7+');
    expect(fork!.validatedBy).toBe('see');
  });
  it('NEGATIVE: a fork whose forker is itself hanging (…Bxc7) is REJECTED', () => {
    const { motifs, rejected } = findForks('r3k3/8/8/1N6/5b2/8/8/4K3 w - - 0 1');
    expect(has(motifs, 'fork')).toBe(false); // never emitted
    expect(rejected.some((r) => r.type === 'fork')).toBe(true); // logged, not shown
  });
});

// ── PIN (absolute) ───────────────────────────────────────────────────────────
describe('M5 — pin_absolute', () => {
  it('POSITIVE: bishop pins the knight to the king (clear ray)', () => {
    const { motifs } = findPinsAndSkewers('4k3/3n4/8/1B6/8/8/8/4K3 w - - 0 1', 'b');
    expect(has(motifs, 'pin_absolute')).toBe(true);
  });
  it('NEGATIVE: bishop aimed at a knight but the king is off the ray → REJECTED', () => {
    const { motifs } = findPinsAndSkewers('5k2/8/2n5/1B6/8/8/8/4K3 w - - 0 1', 'b');
    expect(has(motifs, 'pin_absolute')).toBe(false); // the knight can legally move
  });
});

// ── SKEWER ───────────────────────────────────────────────────────────────────
describe('M5 — skewer', () => {
  it('POSITIVE: rook skewers the queen, winning the rook behind', () => {
    const { motifs } = findPinsAndSkewers('r5k1/8/8/8/q7/8/8/R3K3 w - - 0 1', 'b');
    expect(has(motifs, 'skewer')).toBe(true);
  });
  it('NEGATIVE: the rook’s own pawn blocks the line → no skewer', () => {
    const { motifs } = findPinsAndSkewers('r5k1/8/8/8/q7/P7/8/R3K3 w - - 0 1', 'b');
    expect(has(motifs, 'skewer')).toBe(false);
  });
});

// ── BACK-RANK & MATING-NET (proven by chess.js isCheckmate) ──────────────────
describe('M5 — back_rank / mating_net', () => {
  it('POSITIVE back_rank: Re8# with the king walled in by its own pawns', () => {
    const { motifs } = findMatesIn1('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1');
    const m = motifs.find((x) => x.type === 'back_rank');
    expect(m).toBeDefined();
    expect(m!.line).toContain('Re8#');
  });
  it('NEGATIVE back_rank: a luft (…h6) means it is NOT mate → REJECTED', () => {
    const { motifs } = findMatesIn1('6k1/5pp1/7p/8/8/8/8/4R1K1 w - - 0 1');
    expect(motifs).toHaveLength(0); // no fabricated mate
  });
  it('POSITIVE mating_net: the sample game R1e7# is detected as a (non-back-rank) mate', () => {
    const { motifs } = findMatesIn1('4R3/3N1kpp/p1r3p1/3p4/2p2PrP/8/P1P3P1/4R1K1 w - - 0 31');
    expect(motifs.some((m) => m.line.includes('R1e7#') && m.type === 'mating_net')).toBe(true);
  });
});

// ── REMOVAL OF GUARD ─────────────────────────────────────────────────────────
describe('M5 — removal_of_guard', () => {
  it('POSITIVE: Rxc6 removes the bishop’s sole guard → e5 is now SEE-losing', () => {
    const before = '4k3/8/2n5/4b3/8/8/8/2R1R1K1 w - - 0 1';
    const { motifs } = findRemovalOfGuard(before, after(before, 'Rxc6'));
    const m = motifs.find((x) => x.type === 'removal_of_guard');
    expect(m).toBeDefined();
    expect(m!.squares).toContain('e5');
    expect(m!.materialSwing).toBe(3);
  });
  it('NEGATIVE: a second guard (g6 knight) still protects e5 → REJECTED', () => {
    const before = '4k3/8/2n3n1/4b3/8/8/8/2R1R1K1 w - - 0 1';
    const { motifs } = findRemovalOfGuard(before, after(before, 'Rxc6'));
    expect(has(motifs, 'removal_of_guard')).toBe(false);
  });
});

// ── DISCOVERED CHECK ─────────────────────────────────────────────────────────
describe('M5 — discovered_check', () => {
  it('POSITIVE: Ng5 uncovers the e1 rook’s check on e8', () => {
    const before = '4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1';
    const { motifs } = findDiscoveredCheck(before, after(before, 'Ng5'));
    const m = motifs.find((x) => x.type === 'discovered_check');
    expect(m).toBeDefined();
    expect(m!.squares).toContain('e1'); // the checker is the piece that did NOT move
  });
  it('NEGATIVE: a direct Nd6+ (the checker moved) is NOT a discovered check', () => {
    const before = '4k3/8/8/8/4N3/8/8/6K1 w - - 0 1';
    const { motifs } = findDiscoveredCheck(before, after(before, 'Nd6+'));
    expect(has(motifs, 'discovered_check')).toBe(false);
  });
});

// ── RANKER INTEGRATION: a confirmed fork outranks a bare material change ──────
describe('M5 — a confirmed fork becomes the topExplanation over a bare material change', () => {
  const ev = (cp: number, pv: string[]): Eval => ({ cp, depth: 14, pv });
  // Black just played …c6 (quiet); White now has the Nc7+ royal fork (refutation).
  const fenBefore = 'r3k3/2p5/8/1N6/8/8/8/4K3 b - - 0 1';
  const fenAfter = 'r3k3/8/2p5/1N6/8/8/8/4K3 w - - 0 1';

  // A competing bare material change (a small hung piece) injected as a candidate.
  const bareChange: ChangedRelation = {
    id: 'bare-1',
    kind: 'changed_relation',
    type: 'now_see_losing',
    side: 'black',
    squares: ['c6'],
    arrows: [],
    source: 'played_move',
    materialSwing: 1,
    kingSafetyDelta: 0,
    inPV: false,
    saliency: 0,
    templateId: 'now_see_losing',
    evidence: ['c6 pawn loose'],
  };

  const result = analyzeMove(
    {
      fenBefore,
      fenAfter,
      san: 'c6',
      evalBefore: ev(-20, ['Nc7+']),
      evalAfter: ev(500, ['Nc7+', 'Kf8', 'Nxa8']), // white wins the rook
    },
    [bareChange],
  );

  it('the fork is ranked #1', () => {
    const top = result.rankedInsights[0];
    expect(top.kind).toBe('motif');
    expect(top.type).toBe('fork');
  });
  it('the bare material change is present but ranked below the fork', () => {
    const top = result.rankedInsights[0];
    const bare = result.rankedInsights.find(
      (r) => r.kind === 'changed_relation' && r.id === 'bare-1',
    );
    expect(bare).toBeDefined();
    expect(bare!.saliency).toBeLessThan(top.saliency);
  });
});
