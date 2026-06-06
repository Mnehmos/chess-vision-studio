import { describe, it, expect } from 'vitest';
import { findThreatenedPieces, findShields, threatLines, shieldLines } from '../threats';

describe('findThreatenedPieces — a man losing material by SEE', () => {
  it('detects an undefended bishop on the rook’s file', () => {
    // White rook e1 sees the undefended black bishop e7 up the open e-file.
    const fen = 'k7/4b3/8/8/8/8/8/K3R3 w - - 0 1';
    const t = findThreatenedPieces(fen);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ square: 'e7', piece: 'b', owner: 'b', threatenedBy: 'w', gain: 3 });
    expect(threatLines(fen)[0]).toBe('White threatens to win the black bishop on e7 (+3)');
  });

  it('says nothing when the attacked piece is safely defended', () => {
    // Rook eyes the bishop on g1, but the h2 pawn defends it → SEE not winning.
    const fen = 'k7/8/8/8/8/8/7p/K3R1b1 w - - 0 1';
    expect(findThreatenedPieces(fen)).toHaveLength(0);
  });
});

describe('findShields — a friendly piece blocking a slider’s line to a friendly man', () => {
  it('detects a knight shielding the rook from the long-diagonal bishop', () => {
    // White bishop a1 → d4 (black knight, the shield) → g7 (black rook, shielded).
    const fen = 'k7/6r1/8/8/3n4/8/8/B6K w - - 0 1';
    const s = findShields(fen);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      blocker: 'd4',
      blockerPiece: 'n',
      shielded: 'g7',
      shieldedPiece: 'r',
      attacker: 'a1',
      attackerPiece: 'b',
      side: 'b',
    });
    expect(shieldLines(fen)[0]).toBe(
      "Black's knight on d4 shields the rook on g7 from the bishop on a1",
    );
  });

  it('no shield when the slider’s line is not blocked toward a friendly man', () => {
    const fen = '8/8/8/8/8/8/4k3/K6B w - - 0 1';
    expect(findShields(fen)).toHaveLength(0);
  });
});
