import { describe, expect, it } from 'vitest';
import { detectOpening } from '../openings';

describe('opening detection', () => {
  it('names the London System from 1.d4 d5 2.Bf4 (the empty-teaching case)', () => {
    const found = detectOpening(['d4', 'd5', 'Bf4']);
    expect(found?.info.name).toBe('London System');
    expect(found?.info.ideas.length).toBeGreaterThan(0);
    expect(found?.inBook).toBe(true);
  });

  it('keeps the London name after the line continues past book', () => {
    expect(detectOpening(['d4', 'd5', 'Bf4', 'e6', 'e3', 'Bd6'])?.info.name).toBe('London System');
  });

  it('recognizes the London via the 1.d4 Nf6 2.Bf4 move order', () => {
    expect(detectOpening(['d4', 'Nf6', 'Bf4'])?.info.name).toBe('London System');
  });

  it('prefers the most specific (longest-prefix) opening', () => {
    // e4 e5 Nf3 Nc6 Bb5 must resolve to Ruy Lopez, not the generic King's Pawn.
    expect(detectOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])?.info.name).toBe('Ruy Lopez');
    expect(detectOpening(['d4', 'Nf6', 'c4', 'g6'])?.info.name).toBe('King’s Indian Defense');
  });

  it('falls back to a generic first-move name when nothing specific matches', () => {
    expect(detectOpening(['e4'])?.info.name).toBe('King’s Pawn Opening');
    expect(detectOpening(['d4', 'g6'])?.info.name).toBe('Queen’s Pawn Opening');
  });

  it('normalizes check/annotation marks when matching', () => {
    expect(detectOpening(['e4', 'c5'])?.info.name).toBe('Sicilian Defense');
    expect(detectOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5+'])?.info.name).toBe('Ruy Lopez');
  });

  it('returns null for an empty game', () => {
    expect(detectOpening([])).toBeNull();
  });
});
