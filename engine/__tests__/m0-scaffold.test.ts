// M0 DoD — three checks:
//  1. `npm test` green on a trivial test.
//  2. the worker returns a `bestmove` for the start position at fixed depth.
//  3. chess.js parses the sample PGN (§12) into its full move list.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Chess } from 'chess.js';
import { pliesFromPgn } from '../position';
import { UciEngine } from '../evaluation';
import { createNodeStockfishTransport } from '../stockfish-node';

describe('M0.1 — trivial test', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});

describe('M0.3 — chess.js parses the sample game', () => {
  const pgn = readFileSync(join(__dirname, '../../fixtures/sample-game.pgn'), 'utf8');

  it('loads the PGN without throwing', () => {
    const chess = new Chess();
    expect(() => chess.loadPgn(pgn)).not.toThrow();
  });

  it("ends on White's 31st move (R1e7#) — 61 half-moves", () => {
    const plies = pliesFromPgn(pgn);
    // 30 full moves (60 half-moves) + White's 31st = 61 plies; last is mate.
    expect(plies).toHaveLength(61);
    expect(plies[plies.length - 1].san).toBe('R1e7#');
    expect(plies[plies.length - 1].moveNumber).toBe(31);
  });
});

describe('M0.2 — Stockfish worker returns a bestmove at fixed depth', () => {
  let engine: UciEngine;

  beforeAll(async () => {
    engine = new UciEngine(await createNodeStockfishTransport());
  }, 30000);

  afterAll(() => engine?.dispose());

  it('returns a legal bestmove for the start position', async () => {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const best = await engine.bestMove(startFen, 12);
    expect(best).toMatch(/^[a-h][1-8][a-h][1-8]/); // UCI long algebraic
    // confirm it's one of the 20 legal opening moves
    const chess = new Chess(startFen);
    const legalUci = chess.moves({ verbose: true }).map((m) => m.from + m.to);
    expect(legalUci).toContain(best.slice(0, 4));
  }, 25000);

  it('produces a fixed-depth Eval with cp score and PV for the start position', async () => {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const ev = await engine.evaluate({ fen: startFen, depth: 12 });
    expect(ev.depth).toBeGreaterThanOrEqual(12);
    expect(typeof ev.cp).toBe('number');
    expect(ev.pv.length).toBeGreaterThan(0);
  }, 25000);
});
