import { describe, expect, it } from 'vitest';
import { hangingNote, whiteEvalText, whiteEvalCp } from './TeachingLog';
import type { TeachingAnalysis, TeachingFactBundleV1 } from '../engine/teaching/types';
import type { MoveAnalysis } from '../engine/types';

// Minimal bundle carrying only the fields hangingNote reads — robust against the
// incidental shape of any one fixture.
type Piece = {
  side: 'white' | 'black';
  pieceType: string;
  square: string;
  scoreCp?: number;
  losing: boolean;
  attackers?: { pieceType: string; square: string }[];
};

function bundle(pieces: Piece[], mover: 'white' | 'black' = 'white'): TeachingFactBundleV1 {
  return {
    before: { sideToMove: mover },
    played: {
      position: {
        pieces: pieces.map((p) => ({
          side: p.side,
          pieceType: p.pieceType,
          square: p.square,
          attackers: p.attackers ?? [],
          see: { status: 'computed', value: { losing: p.losing, scoreCp: p.scoreCp } },
        })),
      },
    },
  } as unknown as TeachingFactBundleV1;
}

const committed = (topicId: string): TeachingAnalysis =>
  ({ computed: true, schemaVersion: 1, events: [{ topicId }] }) as unknown as TeachingAnalysis;

describe('hangingNote', () => {
  it('names the piece, the magnitude, and who attacks it', () => {
    const note = hangingNote(
      bundle([{ side: 'white', pieceType: 'bishop', square: 'c4', scoreCp: -300, losing: true, attackers: [{ pieceType: 'knight', square: 'd6' }] }]),
      null,
    );
    expect(note).toBe('Leaves the bishop on c4 hanging (~3 pawns) — attacked by the knight on d6. The opponent can win it.');
  });

  it('pluralizes correctly for a one-pawn loss (no "1 pawns")', () => {
    const note = hangingNote(
      bundle([{ side: 'white', pieceType: 'pawn', square: 'e5', scoreCp: -100, losing: true, attackers: [{ pieceType: 'bishop', square: 'g3' }] }]),
      null,
    );
    expect(note).toContain('(~1 pawn)');
    expect(note).not.toContain('1 pawns');
  });

  it('joins multiple attackers with "and"', () => {
    const note = hangingNote(
      bundle([
        {
          side: 'white',
          pieceType: 'pawn',
          square: 'e5',
          scoreCp: -100,
          losing: true,
          attackers: [
            { pieceType: 'bishop', square: 'g3' },
            { pieceType: 'knight', square: 'f3' },
          ],
        },
      ]),
      null,
    );
    expect(note).toContain('attacked by the bishop on g3 and knight on f3');
  });

  it('returns undefined when no mover-side piece is SEE-losing', () => {
    expect(hangingNote(bundle([{ side: 'white', pieceType: 'rook', square: 'a1', losing: false }]), null)).toBeUndefined();
  });

  it('ignores the opponent’s hanging piece (only flags the mover’s own)', () => {
    const note = hangingNote(
      bundle([{ side: 'black', pieceType: 'queen', square: 'd8', scoreCp: -900, losing: true }], 'white'),
      null,
    );
    expect(note).toBeUndefined();
  });

  it('defers to the compiler when a hanging/defense topic was already committed', () => {
    const facts = bundle([{ side: 'white', pieceType: 'bishop', square: 'c4', scoreCp: -300, losing: true }]);
    expect(hangingNote(facts, committed('failed_defense'))).toBeUndefined();
    expect(hangingNote(facts, committed('missed_hanging_piece'))).toBeUndefined();
  });
});

const evalA = (e: { cp?: number; mate?: number }): MoveAnalysis =>
  ({ evalAfter: { depth: 1, pv: [], ...e } }) as unknown as MoveAnalysis;

describe('whiteEvalText / whiteEvalCp (eval bar normalization)', () => {
  it('flips evalAfter (side-to-move) into White’s perspective', () => {
    // After White moves it is Black to move, so evalAfter is Black-POV; White view negates it.
    expect(whiteEvalText(evalA({ cp: 120 }), 'w')).toBe('-1.2');
    expect(whiteEvalText(evalA({ cp: 120 }), 'b')).toBe('+1.2');
    expect(whiteEvalCp(evalA({ cp: 120 }), 'w')).toBe(-120);
  });

  it('formats mate from White’s perspective and saturates the bar', () => {
    expect(whiteEvalText(evalA({ mate: 3 }), 'b')).toBe('#3');
    expect(whiteEvalText(evalA({ mate: 3 }), 'w')).toBe('#-3');
    expect(whiteEvalCp(evalA({ mate: 3 }), 'b')).toBe(10000);
    expect(whiteEvalCp(evalA({ mate: -2 }), 'b')).toBe(-10000);
  });
});
