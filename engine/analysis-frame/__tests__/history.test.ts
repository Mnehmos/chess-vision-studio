import { describe, expect, it } from 'vitest';
import {
  buildHistoryHash,
  replayReachesFen,
  replayUciHistory,
  STARTPOS_FEN,
} from '../index';

describe('replayUciHistory', () => {
  it('replays from the standard start position', () => {
    const fen = replayUciHistory('startpos', ['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    expect(fen).not.toBeNull();
    // After 1.e4 e5 2.Nf3 Nc6 it is White to move.
    expect(fen!.split(' ')[1]).toBe('w');
  });

  it('replays from a custom initial FEN', () => {
    const initial = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const fen = replayUciHistory(initial, ['f1b5']); // Ruy Lopez bishop move
    expect(fen).not.toBeNull();
    expect(fen!.split(' ')[1]).toBe('b');
  });

  it('returns null on an illegal move', () => {
    expect(replayUciHistory('startpos', ['e2e5'])).toBeNull();
  });

  it('returns null on a malformed uci', () => {
    expect(replayUciHistory('startpos', ['e2'])).toBeNull();
  });
});

describe('replayReachesFen (PR-04 fail-closed guard)', () => {
  const afterE4E5Nf3Nc6 = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

  it('accepts a matching replay from startpos', () => {
    expect(replayReachesFen('startpos', ['e2e4', 'e7e5', 'g1f3', 'b8c6'], afterE4E5Nf3Nc6)).toBe(
      true,
    );
  });

  it('accepts when only the clocks differ (legal-position-key match)', () => {
    const sameClocksTweaked = afterE4E5Nf3Nc6.replace(/\s+\d+\s+\d+$/, ' 9 42');
    expect(
      replayReachesFen('startpos', ['e2e4', 'e7e5', 'g1f3', 'b8c6'], sameClocksTweaked),
    ).toBe(true);
  });

  it('rejects a FEN/history mismatch (fail closed)', () => {
    // Replaying a different line must NOT validate against this FEN.
    expect(replayReachesFen('startpos', ['d2d4', 'd7d5'], afterE4E5Nf3Nc6)).toBe(false);
  });

  it('rejects when an undo would leave the wrong suffix', () => {
    // Full line reaches the target; dropping the last ply (undo) must not.
    const full = ['e2e4', 'e7e5', 'g1f3', 'b8c6'];
    expect(replayReachesFen('startpos', full, afterE4E5Nf3Nc6)).toBe(true);
    expect(replayReachesFen('startpos', full.slice(0, 3), afterE4E5Nf3Nc6)).toBe(false);
  });

  it('bare startpos with empty history matches the start FEN', () => {
    expect(replayReachesFen('startpos', [], STARTPOS_FEN)).toBe(true);
  });
});

describe('history identity hashing', () => {
  it('same FEN reached by different histories yields different hashes', () => {
    // Both transpositions return to the start position, but via different moves.
    const a = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    const b = ['b1c3', 'b8c6', 'c3b1', 'c6b8'];
    expect(replayReachesFen('startpos', a, STARTPOS_FEN)).toBe(true);
    expect(replayReachesFen('startpos', b, STARTPOS_FEN)).toBe(true);
    expect(buildHistoryHash(a)).not.toBe(buildHistoryHash(b));
  });
});
