// The JSON export must capture the literal on-screen view (current ply) AND the full
// analysis for EVERY ply — analyzed plies carry their classification/insights/features
// and coach note; un-analyzed plies are present with null analysis.
import { describe, it, expect } from 'vitest';
import { buildBoardExport, boardExportFilename } from './exportState';
import { ARROW } from './BoardArrows';
import type { ParsedGame, PlyRecord } from '../engine/position';
import type { LedMap, MoveAnalysis } from '../engine/types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';

const ply = (over: Partial<PlyRecord>): PlyRecord =>
  ({ moveNumber: 1, san: 'e4', color: 'w', from: 'e2', to: 'e4', fenBefore: START, fenAfter: AFTER_E4, ...over } as PlyRecord);

const analysisE4: MoveAnalysis = {
  positionId: `${AFTER_E4}|e4`,
  positionBefore: START,
  positionAfter: AFTER_E4,
  move: '1. e4', // FORMATTED label (like the real app) — must NOT be fed to extractPlyFeatures
  classification: 'mistake',
  evalBefore: { depth: 14, pv: [] },
  evalAfter: { depth: 14, pv: [] },
  cpLoss: 1.5,
  rankedInsights: [],
  topExplanation: 'A test explanation.',
};

const ledMap: LedMap = { mode: 'legal', squares: { e4: 'green' } };

const game = { headers: { White: 'Alice', Black: 'Bob' }, plies: [] } as unknown as ParsedGame;

const baseInput = {
  game,
  plies: [ply({}), ply({ moveNumber: 1, san: 'e5', color: 'b', from: 'e7', to: 'e5', fenBefore: AFTER_E4, fenAfter: AFTER_E5 })],
  view: 1,
  fen: AFTER_E4,
  modeId: 'legal',
  selected: 'e4' as const,
  focused: null,
  moveLabel: '1. e4',
  ledMap,
  arrows: [{ from: 'd1' as const, to: 'e2' as const, color: ARROW.defend, dashed: true }],
  analyses: new Map([[0, analysisE4]]),
  commentary: new Map([[0, 'a coach note']]),
  annotations: { showThreats: true, showAllThreats: false, cascade: true, followMove: true },
  exportedAt: '2026-06-08T00:00:00.000Z',
};

describe('buildBoardExport', () => {
  const out = buildBoardExport(baseInput);

  it('captures game metadata and analysis coverage', () => {
    expect(out.game.headers.White).toBe('Alice');
    expect(out.game.plyCount).toBe(2);
    expect(out.game.analyzedPlies).toBe(1);
    expect(out.game.commentedPlies).toBe(1);
  });

  it('captures the literal on-screen current view', () => {
    expect(out.current.ply).toBe(1);
    expect(out.current.fen).toBe(AFTER_E4);
    expect(out.current.sideToMove).toBe('black');
    expect(out.current.move?.classification).toBe('mistake');
    expect(out.current.move?.cpLoss).toBe(1.5);
    expect(out.current.mode.id).toBe('legal');
    expect(out.current.mode.ledMap).toEqual(ledMap);
    expect(out.current.selectedSquare?.square).toBe('e4');
    expect(out.current.selectedSquare?.report.occupied).toBe(true); // e4 = white pawn
    expect(out.current.coachCommentary).toBe('a coach note');
    expect(out.current.annotations.arrows[0]).toMatchObject({ from: 'd1', to: 'e2', kind: 'defend', dashed: true });
  });

  it('includes EVERY ply with its analysis / features / coach', () => {
    expect(out.plies).toHaveLength(2);
    // Analyzed ply: features REALLY computed (via the bare SAN, not the "1. e4" label).
    expect(out.plies[0].analysis?.classification).toBe('mistake');
    expect(out.plies[0].coachCommentary).toBe('a coach note');
    expect(out.plies[0].features.computed).toBe(true);
    const bc = (out.plies[0].features as { boardControl: { neutralPct: number } }).boardControl;
    expect(bc).toBeTruthy();
    expect(bc.neutralPct).toBeLessThan(100); // REAL control after 1.e4, not the 100%-neutral placeholder
    // Un-analyzed ply: explicit "unknown", never zeros-as-truth.
    expect(out.plies[1].analysis).toBeNull();
    expect(out.plies[1].features.computed).toBe(false);
    expect((out.plies[1].features as { reason?: string }).reason).toBe('not_analyzed');
    expect(out.plies[1].coachCommentary).toBeNull();
    expect(out.plies[1].san).toBe('e5');
  });

  it('flags a quarantined extraction as computed:false, never zeros-as-truth', () => {
    const bad = buildBoardExport({
      ...baseInput,
      plies: [ply({})],
      analyses: new Map([[0, { ...analysisE4, positionBefore: 'not-a-valid-fen' }]]),
    });
    expect(bad.plies[0].features.computed).toBe(false);
    expect((bad.plies[0].features as { reason?: string }).reason).toBe('feature_extraction_failed');
  });

  it('serializes to JSON without throwing', () => {
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});

describe('boardExportFilename', () => {
  it('slugifies the player names', () => {
    expect(boardExportFilename(game)).toBe('cvs-alice-vs-bob.json');
  });
  it('falls back when no game', () => {
    expect(boardExportFilename(undefined)).toBe('cvs-white-vs-black.json');
  });
});
