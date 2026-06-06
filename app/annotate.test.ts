// Cascade annotation: selecting a piece surfaces the next hop in the chain.
import { describe, it, expect } from 'vitest';
import { selectionArrows } from './annotate';
import { ARROW } from './BoardArrows';

// After 1.d4 d5 2.Bf4 Nc6 3.Nf3 Nf6 4.e3 — the d4 pawn is the contested hub:
// attacked by Nc6, defended by Qd1, Pe3, Nf3.
const FEN = 'r1bqkb1r/ppp1pppp/2n2n2/3p4/3P1B2/4PN2/PPP2PPP/RN1QKB1R b KQkq - 0 4';

const has = (arr: { from: string; to: string; color: string }[], from: string, to: string, color: string) =>
  arr.some((a) => a.from === from && a.to === to && a.color === color);

describe('cascade — selecting the queen surfaces the contested pawn it defends', () => {
  const arrows = selectionArrows(FEN, 'd1', true);
  it('draws the queen defending the contested d4 pawn (green outgoing)', () => {
    expect(has(arrows, 'd1', 'd4', ARROW.defend)).toBe(true);
  });
  it('cascades to d4’s attacker (Nc6, red) and co-defenders (e3, f3, green)', () => {
    expect(has(arrows, 'c6', 'd4', ARROW.attack)).toBe(true);
    expect(has(arrows, 'e3', 'd4', ARROW.defend)).toBe(true);
    expect(has(arrows, 'f3', 'd4', ARROW.defend)).toBe(true);
  });
});

describe('cascade — selecting the attacking knight shows the defense response', () => {
  const arrows = selectionArrows(FEN, 'c6', true);
  it('draws the knight attacking d4 (red outgoing)', () => {
    expect(has(arrows, 'c6', 'd4', ARROW.attack)).toBe(true);
  });
  it('cascades to reveal d4 is defended (Qd1, e3, Nf3 — green)', () => {
    expect(has(arrows, 'd1', 'd4', ARROW.defend)).toBe(true);
    expect(has(arrows, 'e3', 'd4', ARROW.defend)).toBe(true);
    expect(has(arrows, 'f3', 'd4', ARROW.defend)).toBe(true);
  });
});

describe('cascade off — only direct relations', () => {
  it('does not surface the second hop', () => {
    const arrows = selectionArrows(FEN, 'c6', false);
    expect(has(arrows, 'c6', 'd4', ARROW.attack)).toBe(true); // direct outgoing
    expect(has(arrows, 'd1', 'd4', ARROW.defend)).toBe(false); // no cascade
  });
});
