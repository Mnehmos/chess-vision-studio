// Verifies the CLAMP (Invariant 8): the LLM is shown only validated MoveAnalysis
// facts — never the raw board — and the system prompt forbids inventing tactics.
import { describe, it, expect } from 'vitest';
import { factsBlock, buildNarrationMessages } from '../narrate';
import { batchNarrate } from '../batch';
import type { ChatClient } from '../openai';
import type { MoveAnalysis } from '../../engine/types';

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
    };
    const items = [1, 2, 3].map((ply) => ({ ply, analysis: { ...ANALYSIS, move: `${ply}. Nd4` } }));
    const out = await batchNarrate(mock, items, 2);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.ply)).toEqual([1, 2, 3]); // order preserved
    expect(out.filter((r) => r.narration).length).toBe(2);
    expect(out.find((r) => r.error)?.error).toContain('rate limit');
  });
});
