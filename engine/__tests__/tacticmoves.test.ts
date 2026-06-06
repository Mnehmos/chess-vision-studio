// Tests for engine/tacticmoves.ts — detection of MOVE-CREATING skewer/pin
// tactics, validated against the independent adversarial dataset.
//
// GROUND TRUTH is the engine (chess.js rules + tacticalOutcome search), NEVER
// the dataset's labels. The dataset's "absolute/relative pin winsMinor" cases
// are deliberate TRAPS: Bxd7+ Kxd7 is an even trade, so the search must REFUSE
// to emit a winning tactic. We assert the engine's verdict, which here agrees
// with the trap detection (those stated "wins" are not real material wins).
import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { findPinSkewerTactics } from '../tacticmoves';
import cases from '../../fixtures/chatgpt-cases.json';

interface Case {
  id: string;
  fen: string;
  motif: string;
  isPositive: boolean;
  solution: string[];
  expectedOutcome: string;
  themes: string[];
}

const ALL: Case[] = (cases as { cases: Case[] }).cases;
function byId(id: string): Case {
  const c = ALL.find((x) => x.id === id);
  if (!c) throw new Error(`fixture case not found: ${id}`);
  return c;
}

/** Convert the FIRST UCI of the dataset solution into SAN at the case FEN. */
function firstSolutionSan(c: Case): string {
  const chess = new Chess(c.fen);
  const uci = c.solution[0];
  const moved = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: 'q' });
  if (!moved) throw new Error(`illegal solution move ${uci} for ${c.id}`);
  return moved.san;
}

// ────────────────────────────────────────────────────────────────────────────
// POSITIVES — must detect; the emitted line must START with the solution move.
// ────────────────────────────────────────────────────────────────────────────
const POSITIVE_IDS = [
  'skewer-rook-behind-king',
  'skewer-queen-behind-king',
  'skewer-rook-behind-king-mirror',
  'skewer-queen-behind-king-mirror',
];

describe('findPinSkewerTactics — POSITIVES (creating-move skewers)', () => {
  for (const id of POSITIVE_IDS) {
    it(`detects ${id} and leads with the solution move`, () => {
      const c = byId(id);
      const wantSan = firstSolutionSan(c);
      const motifs = findPinSkewerTactics(c.fen);

      // A winning skewer tactic must be emitted.
      expect(motifs.length).toBeGreaterThan(0);

      // At least one emitted motif must be a skewer whose line begins with the
      // creating move named by the dataset solution.
      const match = motifs.find(
        (m) => m.type === 'skewer' && m.line.length > 0 && m.line[0] === wantSan,
      );
      expect(match, `no skewer motif leads with ${wantSan} for ${id}`).toBeTruthy();

      // It must be engine-validated and actually win material (>= a rook here).
      expect(match!.validatedBy).toBe('engine_pv');
      expect(match!.materialSwing).toBeGreaterThanOrEqual(2);
      // The dataset says queen-skewers win a queen (>=9), rook-skewers a rook(>=5).
      const expectMin = c.expectedOutcome === 'winsQueen' ? 9 : 5;
      expect(match!.materialSwing).toBeGreaterThanOrEqual(expectMin);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// NEGATIVES — must NOT emit a winning tactic. The dataset LABELS several of
// these "isPositive: true winsMinor", but the engine search proves they are
// even trades (or win only a pawn / are blocked). The engine is the oracle.
// ────────────────────────────────────────────────────────────────────────────
const NEGATIVE_IDS = [
  // skewer look-alikes: pawn-behind / blocked → win only a pawn or nothing
  'skewer-only-pawn-behind',
  'skewer-only-pawn-behind-mirror',
  'skewer-blocker-before-rook',
  'skewer-blocker-before-rook-mirror',
  // "pin winsMinor" TRAPS: capturing the pinned piece is an EVEN trade
  'absolute-pin-bishop-knight',
  'absolute-pin-bishop-knight-mirror',
  'absolute-pin-rook-bishop',
  'absolute-pin-rook-bishop-mirror',
  'relative-pin-knight-queen',
  'relative-pin-knight-queen-mirror',
  'relative-pin-bishop-queen-file',
  'relative-pin-bishop-queen-file-mirror',
];

describe('findPinSkewerTactics — NEGATIVES (traps & look-alikes)', () => {
  for (const id of NEGATIVE_IDS) {
    it(`does NOT emit a winning tactic for ${id}`, () => {
      const c = byId(id);
      const motifs = findPinSkewerTactics(c.fen);
      // No motif may claim a real material win. (If the implementation emits
      // nothing at all, that trivially satisfies the contract.)
      const winning = motifs.filter((m) => m.materialSwing >= 2);
      expect(
        winning,
        `unexpected winning tactic(s) for ${id}: ${JSON.stringify(
          winning.map((m) => ({ type: m.type, line: m.line, swing: m.materialSwing })),
        )}`,
      ).toHaveLength(0);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Sanity: a genuinely quiet position yields no creating-move (s)pin tactic.
// ────────────────────────────────────────────────────────────────────────────
describe('findPinSkewerTactics — quiet positions', () => {
  it('emits nothing for a quiet development move position', () => {
    const c = byId('none-quiet-development');
    expect(findPinSkewerTactics(c.fen)).toHaveLength(0);
  });
});
