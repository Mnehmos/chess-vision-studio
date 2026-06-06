// Mate proof turns a forcing line into obligation facts (the mate-line card data).
import { describe, it, expect } from 'vitest';
import { buildMateProof } from '../mateproof';

describe('buildMateProof', () => {
  it('explains R1e7# — mating piece, checking line, support, escapes', () => {
    // White to move, mate in 1 (the sample-game finish, one ply before R1e7#).
    const fen = '4R3/3N1kpp/p1r3p1/3p4/2p2PrP/8/P1P3P1/4R1K1 w - - 0 31';
    const proof = buildMateProof(fen, ['R1e7#'], 1)!;
    expect(proof).toBeDefined();
    expect(proof.mateInMoves).toBe(1);
    expect(proof.matingSide).toBe('white');
    expect(proof.matingMove).toBe('R1e7#');
    expect(proof.matingPiece).toBe('Rook e7');
    expect(proof.checkingLine).toBe('rank 7'); // Re7 checks the f7 king along rank 7
    expect(proof.supportPiece).toBe('Rook e8'); // the second rook backs up e7
    expect(proof.trappedKing).toBe('f7');
    expect(typeof proof.kingEscapesAtStart).toBe('number');
    expect(proof.line).toEqual(['R1e7#']);
  });

  it('truncates the line at the mating move and counts full moves', () => {
    // Back-rank mate in 1.
    const proof = buildMateProof('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', ['Re8#', 'Kh7'], 1)!;
    expect(proof.line).toEqual(['Re8#']); // stops at the mate, ignores trailing PV
    expect(proof.matingPiece).toBe('Rook e8');
  });

  it('returns null if the line never actually mates', () => {
    expect(buildMateProof('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', ['Re7', 'Kf8'], 1)).toBeNull();
  });
});
