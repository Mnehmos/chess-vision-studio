import { describe, expect, it } from 'vitest';
import {
  buildPlayModeExportPayload,
  playHistoryToPlyRecords,
  playModeCommentary,
  playModePlayers,
  type PlayHistoryEntry,
} from './play-mode-export';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const HISTORY: PlayHistoryEntry[] = [
  { san: 'e4', fen: AFTER_E4, from: 'e2', to: 'e4', uci: 'e2e4' },
  { san: 'e5', fen: AFTER_E4_E5, from: 'e7', to: 'e5', uci: 'e7e5' },
];

describe('play mode export helpers', () => {
  it('converts play history into PlyRecord rows with correct before/after FENs', () => {
    expect(playHistoryToPlyRecords(HISTORY, START_FEN)).toEqual([
      {
        ply: 1,
        moveNumber: 1,
        color: 'w',
        san: 'e4',
        from: 'e2',
        to: 'e4',
        fenBefore: START_FEN,
        fenAfter: AFTER_E4,
      },
      {
        ply: 2,
        moveNumber: 1,
        color: 'b',
        san: 'e5',
        from: 'e7',
        to: 'e5',
        fenBefore: AFTER_E4,
        fenAfter: AFTER_E4_E5,
      },
    ]);
  });

  it('derives player labels for hot-seat and engine games', () => {
    expect(playModePlayers('w', 'none')).toEqual({ White: 'You', Black: 'Player 2' });
    expect(playModePlayers('b', 'stockfish')).toEqual({ White: 'stockfish', Black: 'You' });
  });

  it('keeps only non-empty coach summaries in commentary', () => {
    expect([...playModeCommentary([{ ply: 0, summary: 'good move' }, { ply: 1, summary: '' }])]).toEqual([
      [0, 'good move'],
    ]);
  });

  it('builds one payload shape for normal and review exports', () => {
    const payload = buildPlayModeExportPayload({
      history: HISTORY,
      startFen: START_FEN,
      fen: AFTER_E4_E5,
      modeId: 'legal',
      selected: 'e4',
      analyses: new Map(),
      coachLog: [{ ply: 0, summary: 'played e4' }],
      annotations: { showThreats: true, showAllThreats: false, cascade: true, followMove: true },
      playerSide: 'w',
      opponent: 'stockfish',
      reviewMoments: [{ id: 'r1', ply: 1 } as any],
      exportedAt: '2026-06-17T12:34:56.000Z',
    });

    expect(payload.game.headers).toMatchObject({
      Event: 'CVS Play Mode Game',
      Date: '2026-06-17',
      White: 'You',
      Black: 'stockfish',
    });
    expect(payload.game.plyCount).toBe(2);
    expect(payload.current.coachCommentary).toBeNull();
    expect(payload.plies[0].coachCommentary).toBe('played e4');
    expect(payload.reviewMoments).toEqual([{ id: 'r1', ply: 1 }]);
  });
});
