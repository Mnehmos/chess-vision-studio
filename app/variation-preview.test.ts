import { describe, expect, it } from 'vitest';
import type { AlternativeLine, AlternativeLineMove } from './arrow-analysis-store';
import {
  buildVariationPreviewArrows,
  buildVariationPreviewPositions,
  variationMoveUcis,
} from './variation-preview';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

function alt(overrides: Partial<AlternativeLine> = {}): AlternativeLine {
  return {
    id: 'alt-1',
    rootFen: START_FEN,
    moves: [
      {
        uci: 'e2e4',
        san: 'e4',
        origin: 'player',
        from: 'e2',
        to: 'e4',
        fenBefore: START_FEN,
        fenAfter: AFTER_E4,
        cpLoss: 12,
        moveQuality: 'equivalent',
      } satisfies AlternativeLineMove,
    ],
    source: 'manual',
    isAnalyzing: false,
    scoreCp: 0,
    mate: null,
    pv: ['e7e5', 'g1f3'],
    depth: 12,
    teachingNodes: [],
    pinned: false,
    revealed: false,
    ...overrides,
  };
}

describe('variation preview helpers', () => {
  it('flattens player moves plus engine PV in display order', () => {
    expect(variationMoveUcis(alt())).toEqual(['e2e4', 'e7e5', 'g1f3']);
  });

  it('builds App-style preview positions with root and terminal frames', () => {
    const positions = buildVariationPreviewPositions(alt(), { includeRootPosition: true });
    expect(positions).toHaveLength(4);
    expect(positions[0]).toMatchObject({ fen: START_FEN, san: 'e4', uci: 'e2e4' });
    expect(positions[1]).toMatchObject({ fen: AFTER_E4, san: 'e5', uci: 'e7e5' });
    expect(positions[3]).toMatchObject({ san: '', uci: '' });
  });

  it('builds PlayMode-style preview positions after each applied move', () => {
    const positions = buildVariationPreviewPositions(alt());
    expect(positions).toHaveLength(3);
    expect(positions[0]).toMatchObject({ fen: AFTER_E4, san: 'e4', uci: 'e2e4' });
    expect(positions[1]).toMatchObject({ fen: AFTER_E4_E5, san: 'e5', uci: 'e7e5' });
  });

  it('keeps current preview arrow semantics: future moves only, engine PV dashed', () => {
    const positions = buildVariationPreviewPositions(alt());
    const arrows = buildVariationPreviewArrows({
      alt: alt(),
      previewPositions: positions,
      currentIndex: 0,
    });
    expect(arrows).toHaveLength(2);
    expect(arrows[0]).toMatchObject({ from: 'e7', to: 'e5', dashed: true, pulse: true, label: '2' });
    expect(arrows[1]).toMatchObject({ from: 'g1', to: 'f3', dashed: true, pulse: false, label: '3' });
  });
});
