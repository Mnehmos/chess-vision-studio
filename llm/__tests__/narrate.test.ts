// Verifies the CLAMP (Invariant 8): the LLM is shown only validated MoveAnalysis
// facts — never the raw board — and the system prompt forbids inventing tactics.
import { describe, it, expect } from 'vitest';
import { factsBlock, buildNarrationMessages } from '../narrate';
import { batchNarrate } from '../batch';
import type { ChatClient } from '../openai';
import type { MoveAnalysis } from '../../engine/types';
import type {
  PlyFeatures,
  LegalFeatureSummary,
  ThreatFeatureSummary,
  DefenseFeatureSummary,
  PawnFeatureSummary,
} from '../../engine/features';

const ANALYSIS: MoveAnalysis = {
  positionBefore: 'r2q1rk1/ppp2ppp/2np1n2/4P3/8/5N2/PPP1BPPP/R2Q1RK1 w - - 0 1',
  positionAfter: 'r2q1rk1/ppp2ppp/2np1n2/4P3/3N4/8/PPP1BPPP/R2Q1RK1 b - - 1 1',
  move: '1. Nd4',
  classification: 'mistake',
  evalBefore: { cp: 20, depth: 14, pv: [] },
  evalAfter: { cp: 80, depth: 14, pv: [] },
  cpLoss: 1.0,
  rankedInsights: [
    {
      id: 'x',
      kind: 'changed_relation',
      type: 'now_see_losing',
      side: 'white',
      squares: ['e5'],
      arrows: [],
      source: 'played_move',
      materialSwing: 1,
      kingSafetyDelta: 0,
      inPV: false,
      saliency: 0.4,
      templateId: 'now_see_losing',
      evidence: ['wP on e5 is now losing material (SEE +1)'],
    },
  ],
  topExplanation: "White's pawn on e5 is losing material — it hangs for a pawn (SEE +1).",
};

describe('narrate — clamped facts', () => {
  it('factsBlock includes the validated facts and the engine summary', () => {
    const b = factsBlock(ANALYSIS);
    expect(b).toContain('1. Nd4');
    expect(b).toContain('mistake');
    expect(b).toContain('e5');
    expect(b).toContain('losing material');
  });

  it('does NOT leak the raw board / FEN to the model (clamp)', () => {
    const msgs = buildNarrationMessages(ANALYSIS);
    const userContent = msgs.find((m) => m.role === 'user')!.content;
    expect(userContent).not.toContain(ANALYSIS.positionBefore);
    expect(userContent).not.toContain(ANALYSIS.positionAfter);
  });

  it('the system prompt forbids inventing tactics', () => {
    const sys = buildNarrationMessages(ANALYSIS).find((m) => m.role === 'system')!.content;
    expect(sys.toLowerCase()).toContain('only the facts');
    expect(sys.toLowerCase()).toContain('do not invent');
  });
});

// ── obligation layer ──────────────────────────────────────────────────────────
const L = (over: Partial<LegalFeatureSummary> = {}): LegalFeatureSummary => ({
  total: 0, safe: 0, captures: 0, checks: 0, forcing: 0, tacticalCandidates: 0,
  byPiece: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }, kingEscapes: 0, ...over,
});
const T = (over: Partial<ThreatFeatureSummary> = {}): ThreatFeatureSummary => ({
  whiteControl: 0, blackControl: 0, contested: 0, centerWhite: 0, centerBlack: 0,
  whiteKingPressure: 0, blackKingPressure: 0, checksAvailable: { w: 0, b: 0 }, initiative: { w: 0, b: 0 }, ...over,
});
const D = (over: Partial<DefenseFeatureSummary> = {}): DefenseFeatureSummary => ({
  loosePieces: { w: 0, b: 0 }, undefendedHighValue: { w: 0, b: 0 }, hangingPieces: { w: 0, b: 0 },
  hangingValue: { w: 0, b: 0 }, overDefended: { w: 0, b: 0 }, ...over,
});
const P = (over: Partial<PawnFeatureSummary> = {}): PawnFeatureSummary => ({
  isolated: { w: 0, b: 0 }, doubled: { w: 0, b: 0 }, passed: { w: 0, b: 0 }, islands: { w: 0, b: 0 },
  openFiles: 0, semiOpenFiles: { w: 0, b: 0 }, kingShieldMissing: { w: 0, b: 0 }, ...over,
});
const FEATURES: PlyFeatures = {
  phase: 'middlegame', mover: 'b', move: '13... Qb6',
  legalBefore: L(), opponentLegalAfter: L({ kingEscapes: 1 }),
  mobilityDelta: 0, safeMoveDelta: 0,
  threatBefore: T(),
  threatAfter: T({ whiteControl: 30, blackControl: 18, contested: 6, centerWhite: 3, centerBlack: 1, whiteKingPressure: 0, blackKingPressure: 5 }),
  threatVolatility: 0,
  defenseBefore: D(),
  defenseAfter: D({ loosePieces: { w: 0, b: 2 }, hangingValue: { w: 0, b: 3 } }),
  see: { bestWin: { w: 3, b: 0 }, poisonedCaptures: { w: 0, b: 0 }, playedCaptureSee: null, missedFreeMaterial: false },
  pawnBefore: P(), pawnAfter: P({ kingShieldMissing: { w: 0, b: 2 } }),
  motifs: { availableBefore: {}, createdAfter: {}, missedByMover: {}, refutation: {} },
  patterns: [], badges: [],
};

describe('obligation layer — territory + king pressure + loose/hanging facts', () => {
  it('adds an obligation section with board control, king pressure, loose & hanging', () => {
    const b = factsBlock(ANALYSIS, FEATURES);
    expect(b).toContain('Obligation facts');
    expect(b).toMatch(/Board control: White attacks ~\d+%/);
    expect(b).toContain('Black king 5'); // king-pressure asymmetry (the Tal signal)
    expect(b).toContain('Loose pieces (no defender): White 0, Black 2');
    expect(b).toContain('Best safe capture available: White +3');
  });

  it('omits the obligation section when no features are provided (back-compat)', () => {
    expect(factsBlock(ANALYSIS)).not.toContain('Obligation facts');
  });

  it('still never leaks the FEN, even with features', () => {
    const user = buildNarrationMessages(ANALYSIS, FEATURES).find((m) => m.role === 'user')!.content;
    expect(user).not.toContain(ANALYSIS.positionBefore);
    expect(user).not.toContain(ANALYSIS.positionAfter);
  });
});

describe('batchNarrate — concurrent per-ply calls', () => {
  it('returns one narrated row per ply and tolerates a failing call', async () => {
    let calls = 0;
    const mock: ChatClient = {
      model: 'mock',
      async chat(messages) {
        calls++;
        if (calls === 2) throw new Error('rate limit');
        return `narrated: ${messages[1].content.split('\n')[0]}`;
      },
      async ping() {
        return 'OK';
      },
    };
    const items = [1, 2, 3].map((ply) => ({ ply, analysis: { ...ANALYSIS, move: `${ply}. Nd4` } }));
    const out = await batchNarrate(mock, items, 2);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.ply)).toEqual([1, 2, 3]); // order preserved
    expect(out.filter((r) => r.narration).length).toBe(2);
    expect(out.find((r) => r.error)?.error).toContain('rate limit');
  });
});
