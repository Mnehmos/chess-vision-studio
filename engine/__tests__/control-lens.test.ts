// The Control Lens names the control problem of a move from VALIDATED hazards only
// (SEE-losing pieces, king pressure, proven mate) — never an invented tactic. These
// tests pin the action/verdict classification and the must-answer vs safely-ignored
// obligation split (the "ignore the loose piece because mate ends it" case).
import { describe, it, expect } from 'vitest';
import { computeControlLens } from '../control-lens';
import type {
  PlyFeatures,
  LegalFeatureSummary,
  ThreatFeatureSummary,
  DefenseFeatureSummary,
  PawnFeatureSummary,
} from '../features';
import type { MoveAnalysis } from '../types';
import type { Color } from '../board';

// Kings only — no piece is losing material.
const KINGS = 'k7/8/8/8/8/8/8/K7 w - - 0 1';
// Rooks facing off on the open e-file — BOTH rooks are SEE-losing.
const BOTH_ROOKS = 'k3r3/8/8/8/8/8/8/K3R3 b - - 0 1';

const L = (): LegalFeatureSummary => ({
  total: 0, safe: 0, captures: 0, checks: 0, forcing: 0, tacticalCandidates: 0,
  byPiece: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }, kingEscapes: 0,
});
const T = (): ThreatFeatureSummary => ({
  whiteControl: 0, blackControl: 0, contested: 0, centerWhite: 0, centerBlack: 0,
  whiteKingPressure: 0, blackKingPressure: 0, checksAvailable: { w: 0, b: 0 }, initiative: { w: 0, b: 0 },
});
const D = (): DefenseFeatureSummary => ({
  loosePieces: { w: 0, b: 0 }, undefendedHighValue: { w: 0, b: 0 }, hangingPieces: { w: 0, b: 0 },
  hangingValue: { w: 0, b: 0 }, overDefended: { w: 0, b: 0 },
});
const P = (): PawnFeatureSummary => ({
  isolated: { w: 0, b: 0 }, doubled: { w: 0, b: 0 }, passed: { w: 0, b: 0 }, islands: { w: 0, b: 0 },
  openFiles: 0, semiOpenFiles: { w: 0, b: 0 }, kingShieldMissing: { w: 0, b: 0 },
});
const mkFeatures = (mover: Color): PlyFeatures => ({
  phase: 'middlegame', mover, move: 'Rxe1',
  legalBefore: L(), opponentLegalAfter: L(), mobilityDelta: 0, safeMoveDelta: 0,
  threatBefore: T(), threatAfter: T(), threatVolatility: 0,
  defenseBefore: D(), defenseAfter: D(),
  see: { bestWin: { w: 0, b: 0 }, poisonedCaptures: { w: 0, b: 0 }, playedCaptureSee: null, missedFreeMaterial: false },
  pawnBefore: P(), pawnAfter: P(),
  motifs: { availableBefore: {}, createdAfter: {}, missedByMover: {}, refutation: {} },
  patterns: [], badges: [],
});
const mkMate = (matingSide: 'white' | 'black', mateInMoves: number): MoveAnalysis['mateProof'] => ({
  mateInMoves, matingSide, line: ['Qxf7#'], matingMove: 'Qxf7#', matingPiece: 'Queen f7',
  checkingLine: 'a diagonal', trappedKing: 'e8', kingEscapesAtStart: 0,
});
const mkAnalysis = (over: Partial<MoveAnalysis>): MoveAnalysis => ({
  positionBefore: KINGS, positionAfter: KINGS, move: 'Rxe1', classification: 'good',
  evalBefore: { depth: 14, pv: [] }, evalAfter: { depth: 14, pv: [] }, cpLoss: 0,
  rankedInsights: [], topExplanation: '', ...over,
});

describe('computeControlLens — action classification', () => {
  it('violate_constraint: a move that hangs material with a big eval drop', () => {
    const lens = computeControlLens(
      mkFeatures('w'),
      mkAnalysis({ positionBefore: KINGS, positionAfter: BOTH_ROOKS, classification: 'blunder', cpLoss: 5 }),
    );
    expect(lens.action).toBe('violate_constraint');
    expect(lens.verdict).toBe('violated');
    expect(lens.created.some((h) => h.side === 'w' && h.kind === 'losing_material')).toBe(true);
    expect(lens.teachingLine.toLowerCase()).toContain('violates');
  });

  it('eliminate: clearing the mover’s own hazard (the piece is gone after)', () => {
    const lens = computeControlLens(
      mkFeatures('w'),
      mkAnalysis({ positionBefore: BOTH_ROOKS, positionAfter: KINGS, classification: 'good', cpLoss: 0 }),
    );
    expect(lens.action).toBe('eliminate');
    expect(lens.verdict).toBe('satisfied');
    expect(lens.removed.some((h) => h.side === 'w')).toBe(true);
    expect(lens.teachingLine.toLowerCase()).toContain('eliminates');
  });

  it('fail_to_control: a hazard present before AND after is unanswered', () => {
    const lens = computeControlLens(
      mkFeatures('w'),
      mkAnalysis({ positionBefore: BOTH_ROOKS, positionAfter: BOTH_ROOKS, classification: 'good', cpLoss: 0.2 }),
    );
    expect(lens.action).toBe('fail_to_control');
    expect(lens.verdict).toBe('failed');
    expect(lens.teachingLine.toLowerCase()).toContain('fails to control');
  });

  it('maintain: a quiet move with no hazard change', () => {
    const lens = computeControlLens(mkFeatures('w'), mkAnalysis({ positionBefore: KINGS, positionAfter: KINGS }));
    expect(lens.action).toBe('maintain');
    expect(lens.verdict).toBe('satisfied');
    expect(lens.obligations).toHaveLength(0);
  });
});

describe('computeControlLens — obligations (must-answer vs safely-ignored)', () => {
  it('marks a loose piece SAFELY IGNORED when the mover has a forced mate', () => {
    const lens = computeControlLens(
      mkFeatures('w'),
      mkAnalysis({
        positionBefore: KINGS,
        positionAfter: BOTH_ROOKS, // white rook on e1 is technically loose…
        mateProof: mkMate('white', 1), // …but white mates first
        cpLoss: 0,
      }),
    );
    expect(lens.action).toBe('eliminate'); // delivering mate ends the game
    const ignored = lens.obligations.filter((o) => o.status === 'safely_ignored');
    expect(ignored.length).toBeGreaterThanOrEqual(1);
    expect(lens.teachingLine.toLowerCase()).toContain('mate');
  });

  it('marks the mover’s standing hazard MUST-ANSWER when there is no saving line', () => {
    const lens = computeControlLens(
      mkFeatures('w'),
      mkAnalysis({ positionBefore: KINGS, positionAfter: BOTH_ROOKS, classification: 'blunder', cpLoss: 5 }),
    );
    expect(lens.obligations.some((o) => o.status === 'must_answer')).toBe(true);
  });
});
