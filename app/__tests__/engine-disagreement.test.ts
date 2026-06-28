import { describe, expect, it } from 'vitest';
import {
  type AnalysisIdentityV2,
  buildHistoryHash,
  DEFAULT_ENGINE_COMPARISON_BUDGET,
  normalizeEngineScore,
} from '../../engine/analysis-frame';
import {
  buildEngineDisagreement,
  type EngineRootResult,
  type EngineSlot,
} from '../engine-disagreement';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function rootIdentity(over: Partial<AnalysisIdentityV2> = {}): AnalysisIdentityV2 {
  return {
    schemaVersion: 2,
    gameKey: 'g',
    ply: 0,
    initialFen: FEN,
    historyUci: [],
    historyHash: buildHistoryHash([]),
    fenBefore: FEN,
    branch: { role: 'root', source: 'game' },
    ...over,
  };
}

function result(
  engine: 'stockfish' | 'cvs',
  bestMoveUci: string | null,
  whiteCp: number | null,
  identity = rootIdentity(),
): EngineRootResult {
  return {
    engine,
    identity,
    bestMoveUci,
    score: normalizeEngineScore({
      rawCp: whiteCp,
      rawMate: null,
      rawPov: 'white',
      rootSide: 'white',
    }),
    pvUci: bestMoveUci ? [bestMoveUci] : [],
    depth: 12,
  };
}

const computed = (r: EngineRootResult): EngineSlot => ({ status: 'computed', result: r });

describe('buildEngineDisagreement (plan §6 PR-03)', () => {
  const budget = DEFAULT_ENGINE_COMPARISON_BUDGET;

  it('recognizes agreement on the same root', () => {
    const view = buildEngineDisagreement({
      rootIdentity: rootIdentity(),
      budget,
      stockfish: computed(result('stockfish', 'e2e4', 30)),
      cvs: computed(result('cvs', 'e2e4', 24)),
    });
    expect(view.overall).toBe('ready');
    expect(view.comparison?.bestMovesAgree).toBe(true);
    expect(view.comparison?.comparable).toBe(true);
    expect(view.comparison?.whiteCpDiff).toBe(6);
  });

  it('recognizes disagreement', () => {
    const view = buildEngineDisagreement({
      rootIdentity: rootIdentity(),
      budget,
      stockfish: computed(result('stockfish', 'e2e4', 30)),
      cvs: computed(result('cvs', 'd2d4', 20)),
    });
    expect(view.comparison?.bestMovesAgree).toBe(false);
    expect(view.comparison?.whiteCpDiff).toBe(10);
  });

  it('fails closed when an engine result identity differs from the root', () => {
    const view = buildEngineDisagreement({
      rootIdentity: rootIdentity({ ply: 5 }),
      budget,
      stockfish: computed(result('stockfish', 'e2e4', 30, rootIdentity({ ply: 4 }))),
      cvs: computed(result('cvs', 'e2e4', 24, rootIdentity({ ply: 5 }))),
    });
    expect(view.stockfish.status).toBe('unavailable');
    expect(view.comparison).toBeNull();
    expect(view.overall).toBe('unavailable');
  });

  it('shows pending when one engine is pending', () => {
    const view = buildEngineDisagreement({
      rootIdentity: rootIdentity(),
      budget,
      stockfish: { status: 'pending' },
      cvs: computed(result('cvs', 'e2e4', 24)),
    });
    expect(view.overall).toBe('pending');
    expect(view.comparison).toBeNull();
  });

  it('shows unavailable when one engine is unavailable (move review independent)', () => {
    const view = buildEngineDisagreement({
      rootIdentity: rootIdentity(),
      budget,
      stockfish: computed(result('stockfish', 'e2e4', 30)),
      cvs: { status: 'unavailable', reason: 'engine off' },
    });
    expect(view.overall).toBe('unavailable');
    expect(view.stockfish.status).toBe('computed'); // SF side still usable
  });

  it('renders mate-vs-cp safely (not comparable, no NaN)', () => {
    const sf = result('stockfish', 'e2e4', null); // mate only
    sf.score = normalizeEngineScore({ rawCp: null, rawMate: 3, rawPov: 'white', rootSide: 'white' });
    const view = buildEngineDisagreement({
      rootIdentity: rootIdentity(),
      budget,
      stockfish: computed(sf),
      cvs: computed(result('cvs', 'e2e4', 24)),
    });
    expect(view.comparison?.comparable).toBe(false);
    expect(view.comparison?.whiteCpDiff).toBeNull();
    expect(view.comparison?.bestMovesAgree).toBe(true);
  });

  it('builds for a root with no played move (root position)', () => {
    const view = buildEngineDisagreement({
      rootIdentity: rootIdentity({ playedMoveUci: undefined }),
      budget,
      stockfish: computed(result('stockfish', 'e2e4', 30)),
      cvs: computed(result('cvs', 'e2e4', 30)),
    });
    expect(view.overall).toBe('ready');
  });
});
