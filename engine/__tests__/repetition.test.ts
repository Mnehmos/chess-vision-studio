// The IUBKTvjF fixture: CVS (two pieces up) drew vs Boris-Trapsky by checking
// forever. The per-move explainer said "Black improves piece mobility" while
// the game repeated into 1/2-1/2. These plies are the real game's final
// shuffle (plies 59–68); the warning must own the headline on the repetition
// and stay silent everywhere it should.
import { describe, expect, it } from 'vitest';
import { repetitionConversionWarning, type PlyFens } from '../repetition';

const SHUFFLE: PlyFens[] = [
  { san: 'Re7+', fenBefore: '1r6/3k1pp1/p6n/2B1R3/1NP5/8/PP3PPP/6K1 w - - 3 30', fenAfter: '1r6/3kRpp1/p6n/2B5/1NP5/8/PP3PPP/6K1 b - - 4 30' },
  { san: 'Kc8', fenBefore: '1r6/3kRpp1/p6n/2B5/1NP5/8/PP3PPP/6K1 b - - 4 30', fenAfter: '1rk5/4Rpp1/p6n/2B5/1NP5/8/PP3PPP/6K1 w - - 5 31' },
  { san: 'Re8+', fenBefore: '1rk5/4Rpp1/p6n/2B5/1NP5/8/PP3PPP/6K1 w - - 5 31', fenAfter: '1rk1R3/5pp1/p6n/2B5/1NP5/8/PP3PPP/6K1 b - - 6 31' },
  { san: 'Kb7', fenBefore: '1rk1R3/5pp1/p6n/2B5/1NP5/8/PP3PPP/6K1 b - - 6 31', fenAfter: '1r2R3/1k3pp1/p6n/2B5/1NP5/8/PP3PPP/6K1 w - - 7 32' },
  { san: 'Re7+', fenBefore: '1r2R3/1k3pp1/p6n/2B5/1NP5/8/PP3PPP/6K1 w - - 7 32', fenAfter: '1r6/1k2Rpp1/p6n/2B5/1NP5/8/PP3PPP/6K1 b - - 8 32' },
  { san: 'Kc8', fenBefore: '1r6/1k2Rpp1/p6n/2B5/1NP5/8/PP3PPP/6K1 b - - 8 32', fenAfter: '1rk5/4Rpp1/p6n/2B5/1NP5/8/PP3PPP/6K1 w - - 9 33' },
  { san: 'Re8+', fenBefore: '1rk5/4Rpp1/p6n/2B5/1NP5/8/PP3PPP/6K1 w - - 9 33', fenAfter: '1rk1R3/5pp1/p6n/2B5/1NP5/8/PP3PPP/6K1 b - - 10 33' },
  { san: 'Kb7', fenBefore: '1rk1R3/5pp1/p6n/2B5/1NP5/8/PP3PPP/6K1 b - - 10 33', fenAfter: '1r2R3/1k3pp1/p6n/2B5/1NP5/8/PP3PPP/6K1 w - - 11 34' },
  { san: 'Re7+', fenBefore: '1r2R3/1k3pp1/p6n/2B5/1NP5/8/PP3PPP/6K1 w - - 11 34', fenAfter: '1r6/1k2Rpp1/p6n/2B5/1NP5/8/PP3PPP/6K1 b - - 12 34' },
  { san: 'Kc8', fenBefore: '1r6/1k2Rpp1/p6n/2B5/1NP5/8/PP3PPP/6K1 b - - 12 34', fenAfter: '1rk5/4Rpp1/p6n/2B5/1NP5/8/PP3PPP/6K1 w - - 13 35' },
];

const WINNING = { evalAfter: { cp: 598, depth: 14, pv: ['b3', 'Rb7', 'Re8+'] } };

describe('repetitionConversionWarning (the IUBKTvjF lesson)', () => {
  it('fires on the final repetition with the winning side to move', () => {
    const w = repetitionConversionWarning(SHUFFLE, 9, WINNING);
    expect(w).not.toBeNull();
    expect(w!.templateId).toBe('repetition_conversion_warning');
    expect(w!.side).toBe('white');
    expect(w!.evidence[0]).toContain('repeated');
    expect(w!.evidence[0]).toContain('b3'); // names the PV progress move
    expect(w!.evidence[0]).toContain('draw is not a success');
    expect(w!.saliency).toBe(1);
  });

  it('stays silent on the FIRST occurrence of a position', () => {
    expect(repetitionConversionWarning(SHUFFLE, 1, WINNING)).toBeNull();
  });

  it('stays silent when the side to move is not clearly winning', () => {
    expect(repetitionConversionWarning(SHUFFLE, 9, { evalAfter: { cp: 50, depth: 14, pv: ['b3'] } })).toBeNull();
  });

  it('stays silent when the PV itself wants to repeat (true perpetual)', () => {
    expect(repetitionConversionWarning(SHUFFLE, 9, { evalAfter: { cp: 598, depth: 14, pv: ['Re7+'] } })).toBeNull();
  });
});
