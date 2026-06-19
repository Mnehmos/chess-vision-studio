// Arena pure-logic tests — no Stockfish, no search. The match flow, disagreement
// detection, and the @cvs/engine training-row bridge are all deterministic.
import { describe, it, expect } from 'vitest';
import { applyUci, scriptedPlayer } from '../players';
import { playGame } from '../match';
import { findDisagreements } from '../disagree';
import { reviewedToTraining } from '../dataset';
import type { ReviewedPly } from '../review';

const rev = (over: Partial<ReviewedPly>): ReviewedPly => ({
  ply: 1,
  by: 'white',
  player: 'cvs@3',
  fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  playedSan: 'e4',
  playedUci: 'e2e4',
  sfBestSan: 'e4',
  cpLoss: 0,
  classification: 'best',
  evalBeforeCp: 0.1,
  oracleDepth: 24,
  available: true,
  ...over,
});

describe('applyUci — UCI is the cross-repo boundary', () => {
  it('applies a legal UCI move and reports SAN + the resulting FEN', () => {
    const out = applyUci('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4');
    expect(out?.san).toBe('e4');
    expect(out?.fenAfter).toContain(' b '); // Black to move now
  });
  it('returns null for an illegal move', () => {
    expect(applyUci('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e5')).toBeNull();
  });
});

describe('playGame — runs two players to a real result', () => {
  it("scripted Fool's mate ends 0-1 by checkmate in 4 plies", async () => {
    const white = scriptedPlayer('w', ['f2f3', 'g2g4']);
    const black = scriptedPlayer('b', ['e7e5', 'd8h4']);
    const game = await playGame(white, black, { maxPlies: 10 });
    expect(game.plies).toHaveLength(4);
    expect(game.plies[3].san).toBe('Qh4#');
    expect(game.result).toBe('0-1');
    expect(game.termination).toBe('checkmate');
  });

  it('stops at the ply cap with result "*" when no mate occurs', async () => {
    // Two players that just shuffle knights back and forth.
    const w = scriptedPlayer('w', ['g1f3', 'f3g1', 'g1f3', 'f3g1']);
    const b = scriptedPlayer('b', ['g8f6', 'f6g8', 'g8f6', 'f6g8']);
    const game = await playGame(w, b, { maxPlies: 4 });
    expect(game.plies).toHaveLength(4);
    expect(game.result).toBe('*');
  });
});

describe('findDisagreements — only worse-than-Stockfish divergences count', () => {
  it('flags a CVS move that differs from SF best AND lost >= minCpLoss', () => {
    const out = findDisagreements(
      [
        rev({ playedSan: 'e4', sfBestSan: 'e4', cpLoss: 0 }), // agreed
        rev({ ply: 2, playedSan: 'Nf3', sfBestSan: 'd4', cpLoss: 0.2 }), // differs but cheap
        rev({ ply: 3, playedSan: 'Qh5', sfBestSan: 'Nf3', cpLoss: 1.8 }), // real blunder
      ],
      0.5,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ply: 3, cvsMove: 'Qh5', sfBest: 'Nf3' });
  });

  it('treats a SAN that differs only by check/!? glyphs as agreement', () => {
    const out = findDisagreements([rev({ playedSan: 'Qxf7+', sfBestSan: 'Qxf7', cpLoss: 2.0 })], 0.5);
    expect(out).toHaveLength(0);
  });
});

describe('reviewedToTraining — labels with Stockfish best, cpLoss in centipawns', () => {
  it('builds a TrainingPosition (played != best) with the engine feature block', () => {
    const row = reviewedToTraining(
      rev({ playedSan: 'Qh5', sfBestSan: 'Nf3', cpLoss: 1.8, classification: 'mistake' }),
    );
    expect(row).not.toBeNull();
    expect(row!.playedMove).toBe('Qh5');
    expect(row!.bestMove).toBe('Nf3');
    expect(row!.cpLoss).toBe(180); // pawns → centipawns
    expect(row!.classification).toBe('mistake');
    expect(row!.features).toBeTruthy(); // engine recomputed its own feature block
    expect(row!.legalMoves.length).toBeGreaterThan(0);
  });

  it('returns null when there is no Stockfish label', () => {
    expect(reviewedToTraining(rev({ sfBestSan: null }))).toBeNull();
  });
});
