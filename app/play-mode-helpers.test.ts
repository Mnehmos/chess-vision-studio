import { describe, expect, it } from 'vitest';
import type { MoveAnalysis } from '../engine/types';
import type { TeachingNode } from '../engine/teaching/node';
import {
  legalDotsFor,
  legalMovesFrom,
  teachingLedMap,
  teachingNodeArrows,
  teachingRequestForLiveMove,
} from './play-mode-helpers';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('play mode helpers', () => {
  it('returns legal click targets for a selected piece', () => {
    expect(legalMovesFrom(START_FEN, 'e2').map((m) => m.to)).toEqual(['e3', 'e4']);
    expect(legalDotsFor(START_FEN, 'e2')).toEqual(['e3', 'e4']);
  });

  it('builds a Rust facts request from analyzed live-move PVs', () => {
    const request = teachingRequestForLiveMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4', {
      positionAfter: AFTER_E4,
      evalBefore: { pv: ['e4', 'e5'] },
      evalAfter: { pv: ['e5'] },
    } as unknown as MoveAnalysis);
    expect(request).toMatchObject({
      schemaVersion: 1,
      playedMoveUci: 'e2e4',
      bestMoveUci: 'e2e4',
      refutationUci: 'e7e5',
      principalVariationUci: ['e2e4', 'e7e5'],
    });
  });

  it('refuses a facts request when SAN cannot be converted to UCI', () => {
    const request = teachingRequestForLiveMove(START_FEN, 'e2e4', {
      positionAfter: AFTER_E4,
      evalBefore: { pv: ['not-a-move'] },
      evalAfter: { pv: [] },
    } as unknown as MoveAnalysis);
    expect(request).toBeNull();
  });

  it('derives board arrows and LEDs from teaching node payloads', () => {
    const node = {
      subjectMove: 'e2e4',
      involvedSquares: ['e4'],
      verification: { expectedMove: 'e7e5' },
      boardPayload: {
        arrows: [{ from: 'e7', to: 'e5', color: 'red', style: 'dashed' }],
        squares: [
          { square: 'e4', color: 'orange' },
          { square: 'e5', color: 'red' },
        ],
      },
    } as unknown as TeachingNode;

    expect(teachingNodeArrows(node)).toMatchObject([
      { from: 'e2', to: 'e4', move: true },
      { from: 'e7', to: 'e5', dashed: true },
    ]);
    const ledMap = teachingLedMap(node);
    expect(ledMap.mode).toBe('teaching');
    expect(ledMap.squares.e4).toBe('orange');
    expect(ledMap.squares.e5).toBe('red');
  });
});
