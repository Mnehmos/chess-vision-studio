import { describe, it, expect } from 'vitest';
import { formatEval } from './PreviewTeachingCard';
import type { AlternativeLineMove } from './arrow-analysis-store';

// scoreCp / mate come from the MOVER's POV, so the raw numbers flip sign every
// ply. formatEval must normalize to White so a steady "Black is winning ~-2.8"
// line reads as a stable negative number instead of flip-flopping +2.9 / -2.8.
const move = (over: Partial<AlternativeLineMove>): AlternativeLineMove =>
  ({
    uci: 'e2e4',
    san: 'e4',
    from: 'e2',
    to: 'e4',
    fenBefore: 'startpos w',
    fenAfter: 'startpos b',
    origin: 'engine',
    ...over,
  }) as AlternativeLineMove;

describe('PreviewTeachingCard formatEval — White-normalized eval', () => {
  it('keeps a steady sign across alternating movers (no flip-flop)', () => {
    // Black is winning by ~2.9. From each MOVER's POV the engine reports it
    // positive for Black, negative for White — White-normalized both are ~-2.9.
    const blackMove = move({ fenBefore: 'r... b - - 0 1', scoreCp: 293 });
    const whiteMove = move({ fenBefore: 'r... w - - 0 1', scoreCp: -283 });
    expect(formatEval(blackMove)).toBe('-2.93'); // Black's +2.93 → White -2.93
    expect(formatEval(whiteMove)).toBe('-2.83'); // White's -2.83 → White -2.83
  });

  it('does not flip a White mover and shows + for White advantage', () => {
    expect(formatEval(move({ fenBefore: 'x w - - 0 1', scoreCp: 150 }))).toBe('+1.50');
  });

  it('normalizes mate by the mover side', () => {
    // Black to move with mate-in-2 (for Black) → White perspective is M-2.
    expect(formatEval(move({ fenBefore: 'x b - - 0 1', mate: 2 }))).toBe('M-2');
    expect(formatEval(move({ fenBefore: 'x w - - 0 1', mate: 2 }))).toBe('M2');
  });
});
