import { describe, expect, it } from 'vitest';
import { gamesFromPgn } from '../engine/position';
import type { MoveAnalysis } from '../engine/types';
import { factsRequestForPly } from './teaching-facts-request';

function analysisWithPv(evalBeforePv: string[], evalAfterPv: string[]): MoveAnalysis {
  return {
    evalBefore: { depth: 24, pv: evalBeforePv },
    evalAfter: { depth: 24, pv: evalAfterPv },
  } as unknown as MoveAnalysis;
}

describe('factsRequestForPly', () => {
  it('converts the played move, best line, and refutation line to UCI', () => {
    const [ply] = gamesFromPgn('1. e4 e5 *')[0].plies;
    const request = factsRequestForPly(ply, analysisWithPv(['e4', 'e5'], ['e5']));

    expect(request).toEqual({
      schemaVersion: 1,
      fenBefore: ply.fenBefore,
      playedMoveUci: 'e2e4',
      bestMoveUci: 'e2e4',
      refutationUci: 'e7e5',
      principalVariationUci: ['e2e4', 'e7e5'],
      options: { includeMotifOpportunities: true, includeCounterfactual: true },
    });
  });

  it('returns null when the best PV cannot be replayed completely', () => {
    const [ply] = gamesFromPgn('1. e4 e5 *')[0].plies;

    expect(factsRequestForPly(ply, analysisWithPv(['NotAMove'], []))).toBeNull();
  });
});
