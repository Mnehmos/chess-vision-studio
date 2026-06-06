// M2 DoD — SEE is the highest test bar. Canonical cases:
//  (a) free hanging piece → correct positive swing
//  (b) defended but attackers-too-expensive → safe for owner
//  (c) x-ray battery (rook behind rook joins the exchange)
// Plus the g4-knight from the sample game (§12: SEE ≈ +3 for White).
// No engine call — pure arithmetic over the relation/board geometry.
import { describe, it, expect } from 'vitest';
import { seeOnSquare, seeCapture } from '../see';

describe('M2 — SEE (a) free hanging piece', () => {
  it('a knight attacked once, undefended → swing +3, owner is losing', () => {
    const fen = '4k3/8/8/4n3/8/8/4R3/4K3 w - - 0 1'; // bN e5, wR e2
    const r = seeOnSquare(fen, 'e5');
    expect(r.swing).toBe(3);
    expect(r.losingSideToMove).toBe(true);
  });
});

describe('M2 — SEE (b) defended but the attackers are too expensive', () => {
  it('knight guarded by one pawn, attacked by two (independent) rooks → SAFE', () => {
    // bN e5 defended by bP d6; attacked by wR e1 (file) and wR a5 (rank).
    const fen = '4k3/8/3p4/R3n3/8/8/8/4R1K1 w - - 0 1';
    const r = seeOnSquare(fen, 'e5');
    // Two rooks (5+5) cannot profitably win a knight (3) guarded by a pawn (1).
    expect(r.swing).toBe(0);
    expect(r.losingSideToMove).toBe(false);
  });
});

describe('M2 — SEE (c) x-ray battery', () => {
  it('a rook behind a rook joins the exchange → pawn is actually winnable', () => {
    // bP e5 (target), defended by bR e8; attacked by wR e2 with wR e1 behind it.
    const battery = '4r1k1/8/8/4p3/8/8/4R3/4R1K1 w - - 0 1';
    expect(seeOnSquare(battery, 'e5').swing).toBe(1); // +pawn −rook +rook = +1

    // Same position WITHOUT the back rook: the single rook is too expensive,
    // so the pawn is safe. This pair proves the x-ray actually mattered.
    const noBattery = '4r1k1/8/8/4p3/8/8/4R3/6K1 w - - 0 1';
    expect(seeOnSquare(noBattery, 'e5').swing).toBe(0);
  });
});

describe('M2 — SEE on the sample-game g4 knight (§12)', () => {
  const fen = 'r3r1k1/ppp2ppp/5q2/3p4/3N2n1/3BP3/PPP2PPP/R2Q1RK1 w - - 4 15';
  it('the loose g4 knight is SEE ≈ +3 for White', () => {
    const r = seeOnSquare(fen, 'g4');
    expect(r.swing).toBe(3);
    expect(r.losingSideToMove).toBe(true);
  });
  it('seeCapture(d1→g4) wins the knight cleanly', () => {
    expect(seeCapture(fen, 'd1', 'g4')).toBe(3);
  });
});

describe('M2 — seeCapture scores a losing capture negatively', () => {
  it('grabbing a rook-defended pawn with a rook loses material', () => {
    const fen = '4r1k1/8/8/4p3/8/8/4R3/6K1 w - - 0 1'; // bP e5 defended by bR e8
    expect(seeCapture(fen, 'e2', 'e5')).toBe(-4); // +pawn(1) − rook(5) = −4
  });
});

describe('M2 — empty / unattacked squares', () => {
  it('an unattacked piece has swing 0', () => {
    const fen = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    expect(seeOnSquare(fen, 'e1').swing).toBe(0);
    expect(seeOnSquare(fen, 'e1').losingSideToMove).toBe(false);
  });
});
