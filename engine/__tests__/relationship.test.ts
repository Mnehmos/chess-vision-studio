// The relationship card's data layer — human names + derived status.
import { describe, it, expect } from 'vitest';
import { describePieceId, squareReport } from '../relationship';

describe('describePieceId', () => {
  it('turns a PieceId into a human label', () => {
    expect(describePieceId('wBf4')).toMatchObject({ label: 'Bishop f4', name: 'Bishop', square: 'f4', color: 'white' });
    expect(describePieceId('bQd8')).toMatchObject({ label: 'Queen d8', color: 'black' });
  });
});

describe('squareReport — the relationship card', () => {
  it('c7 pawn attacked by Bf4, defended by Qd8 & Bb6 → defended target', () => {
    const fen = '3qk3/2p5/1b6/8/5B2/8/8/4K3 w - - 0 1';
    const r = squareReport(fen, 'c7');
    expect(r.pieceName).toBe('Pawn');
    expect(r.color).toBe('black');
    expect(r.attackedBy.map((a) => a.label)).toEqual(['Bishop f4']);
    expect(r.defendedBy.map((d) => d.label).sort()).toEqual(['Bishop b6', 'Queen d8']);
    expect(r.safe).toBe(true);
    expect(r.status).toBe('defended_target');
  });

  it('f6 knight, no attackers, defended by pawns e7 & g7 → defended piece', () => {
    const fen = '4k3/4p1p1/5n2/8/8/8/8/4K3 b - - 0 1';
    const r = squareReport(fen, 'f6');
    expect(r.pieceName).toBe('Knight');
    expect(r.attackedBy).toEqual([]);
    expect(r.defendedBy.map((d) => d.label).sort()).toEqual(['Pawn e7', 'Pawn g7']);
    expect(r.status).toBe('defended');
    expect(r.statusLabel).toBe('defended piece');
  });

  it('the loose g4 knight is reported as hanging (SEE-losing)', () => {
    const fen = 'r3r1k1/ppp2ppp/5q2/3p4/3N2n1/3BP3/PPP2PPP/R2Q1RK1 w - - 4 15';
    const r = squareReport(fen, 'g4');
    expect(r.status).toBe('hanging');
    expect(r.see).toBe(3);
    expect(r.attackedBy.map((a) => a.label)).toEqual(['Queen d1']);
    expect(r.safe).toBe(false);
  });

  it('an empty square reports empty', () => {
    const r = squareReport('4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'd4');
    expect(r.occupied).toBe(false);
    expect(r.status).toBe('empty');
    expect(r.canMoveHere).toEqual([]);
    expect(r.controlledByWhite).toEqual([]);
    expect(r.controlledByBlack).toEqual([]);
  });

  it('an empty square surfaces who can move there and who controls it', () => {
    const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const r = squareReport(START, 'a3');
    expect(r.occupied).toBe(false);
    // White to move: the a2 pawn and b1 knight can both legally land on a3.
    expect(r.canMoveHere?.map((m) => m.label).sort()).toEqual(['Knight b1', 'Pawn a2']);
    // a3 is controlled (defended) by the b2 pawn and the b1 knight; Black controls nothing there.
    expect(r.controlledByWhite?.map((m) => m.label).sort()).toEqual(['Knight b1', 'Pawn b2']);
    expect(r.controlledByBlack).toEqual([]);
  });
});
