// Selective deep re-search of forcing/sacrificial moves. The motivating case is
// Kasparov–Topalov 1999, 24.Rxd4 — a sound sacrifice depth-14 scores as an
// inaccuracy. We re-search such moves deeper and report the DEEPER oracle's
// verdict honestly: 'sound' if it lifts out of the adverse band, 'stands' (with a
// caution) if not. We never assert brilliance the engine hasn't validated, and a
// failed deep search must NEVER downgrade the good shallow verdict.
import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import {
  isForcingMove,
  isSacrifice,
  deepCheckTrigger,
  withDeepCheck,
} from '../deepcheck';
import { seeCapture } from '../see';
import { analyzeMoveLive } from '../analyze';
import { UciEngine, type EngineTransport } from '../evaluation';
import type { Classification, MoveAnalysis } from '../types';

// 24.Rxd4 from the game: Rd1xd4 nets −3 by SEE (cxd4 wins the rook).
const RXD4_BEFORE = 'b2r3r/k4p1p/p2q1np1/NppP4/3p1Q2/P4PPB/1PP4P/1K1RR3 w - - 1 24';

const mkAnalysis = (over: Partial<MoveAnalysis> & { classification: Classification }): MoveAnalysis => ({
  positionBefore: 'x',
  positionAfter: 'y',
  move: '24. Rxd4',
  cpLoss: 0,
  evalBefore: { depth: 14, pv: [] },
  evalAfter: { depth: 14, pv: [] },
  rankedInsights: [],
  topExplanation: '',
  ...over,
});

describe('isForcingMove — checks, captures, promotions, mates', () => {
  it('flags forcing SANs and ignores quiet ones', () => {
    expect(isForcingMove('Rxd4')).toBe(true); // capture
    expect(isForcingMove('Qf4+')).toBe(true); // check
    expect(isForcingMove('e8=Q')).toBe(true); // promotion
    expect(isForcingMove('Qxa6#')).toBe(true); // mate
    expect(isForcingMove('Bf1')).toBe(false);
    expect(isForcingMove('O-O-O')).toBe(false);
    expect(isForcingMove('Kb8')).toBe(false);
  });
});

describe('isSacrifice — gives up material on its own square', () => {
  it('a SEE-losing capture is a sacrifice (24.Rxd4 nets < 0)', () => {
    expect(seeCapture(RXD4_BEFORE, 'd1', 'd4')).toBeLessThan(0);
    expect(isSacrifice(RXD4_BEFORE, 'Rxd4')).toBe(true);
  });

  it('a quiet move that lands a piece en prise is a sacrifice', () => {
    // Black bishop on a8 rakes the long diagonal; Nd5 walks onto an attacked,
    // undefended square (SEE +3 for Black).
    const fen = 'b3k3/8/8/8/8/2N5/8/4K3 w - - 0 1';
    expect(isSacrifice(fen, 'Nd5')).toBe(true);
  });

  it('a safe quiet move is not a sacrifice (no king-sentinel false positive)', () => {
    const fen = 'b3k3/8/8/8/8/2N5/8/4K3 w - - 0 1';
    expect(isSacrifice(fen, 'Nb1')).toBe(false); // retreats to safety
    expect(isSacrifice(fen, 'Ke2')).toBe(false); // king move, never "en prise"
  });
});

describe('deepCheckTrigger — only adverse forcing/sacrificial moves qualify', () => {
  it('fires "sacrifice" for an adverse SEE-losing capture', () => {
    expect(deepCheckTrigger(RXD4_BEFORE, 'Rxd4', mkAnalysis({ classification: 'inaccuracy' }))).toBe('sacrifice');
  });

  it('does NOT fire when the shallow verdict is not adverse', () => {
    expect(deepCheckTrigger(RXD4_BEFORE, 'Rxd4', mkAnalysis({ classification: 'best' }))).toBeNull();
    expect(deepCheckTrigger(RXD4_BEFORE, 'Rxd4', mkAnalysis({ classification: 'good' }))).toBeNull();
  });

  it('fires "forcing" for an adverse check that is not a sacrifice', () => {
    const fen = '4k3/8/8/8/5Q2/8/8/4K3 w - - 0 1';
    expect(deepCheckTrigger(fen, 'Qe4+', mkAnalysis({ classification: 'mistake' }))).toBe('forcing');
  });

  it('does NOT fire for an adverse QUIET move (not the forcing-line case)', () => {
    const fen = '4k3/8/8/8/5Q2/8/8/4K3 w - - 0 1';
    expect(deepCheckTrigger(fen, 'Kd1', mkAnalysis({ classification: 'mistake' }))).toBeNull();
  });
});

describe('withDeepCheck — honest prose for each verdict', () => {
  const shallow = mkAnalysis({ classification: 'inaccuracy', cpLoss: 0.95 });

  it('"sound": surfaces a misjudged forcing line, never asserts unvalidated brilliance', () => {
    const deep = mkAnalysis({ classification: 'best', cpLoss: 0.05, topExplanation: 'capture; eval unchanged.' });
    const out = withDeepCheck(deep, shallow, 22, 'sacrifice');
    expect(out.deepCheck).toMatchObject({ verdict: 'sound', trigger: 'sacrifice', baseDepth: 14, depth: 22, shallowClassification: 'inaccuracy' });
    expect(out.topExplanation).toContain('sacrifice');
    expect(out.topExplanation).toContain('depth-22');
    expect(out.topExplanation.toLowerCase()).toContain('re-scores it best');
    expect(out.topExplanation.toLowerCase()).not.toContain('caution');
  });

  it('"stands": keeps the tactical explanation and adds a search-depth caution', () => {
    const deep = mkAnalysis({ classification: 'inaccuracy', cpLoss: 0.84, topExplanation: "White's pawn on d5 is losing material." });
    const out = withDeepCheck(deep, shallow, 22, 'sacrifice');
    expect(out.deepCheck).toMatchObject({ verdict: 'stands', trigger: 'sacrifice' });
    expect(out.topExplanation).toContain("White's pawn on d5 is losing material.");
    expect(out.topExplanation).toContain('Deep-checked to depth 22');
    expect(out.topExplanation.toLowerCase()).toContain('caution');
  });
});

// ── Orchestration: analyzeMoveLive drives the second pass through a scripted engine ──

const aLegalUci = (fen: string): string => {
  const ms = new Chess(fen).moves({ verbose: true }) as Array<{ from: string; to: string; promotion?: string }>;
  const m = ms[0];
  return m ? `${m.from}${m.to}${m.promotion ?? ''}` : '0000';
};

/** Scripted UCI transport: answers each `go depth N` from `script(fen, depth)`.
 *  Returning 'timeout' means it never replies (forces the wall-clock timeout). */
function scriptedEngine(script: (fen: string, depth: number) => { cp?: number; mate?: number } | 'timeout'): UciEngine {
  let emit: (line: string) => void = () => {};
  let fen = '';
  const transport: EngineTransport = {
    send(cmd: string) {
      if (cmd === 'isready') emit('readyok');
      else if (cmd.startsWith('position fen ')) fen = cmd.slice('position fen '.length).trim();
      else if (cmd.startsWith('go depth ')) {
        const depth = parseInt(cmd.slice('go depth '.length), 10);
        const r = script(fen, depth);
        if (r === 'timeout') return; // never reply → runMultiPV times out → 'unavailable'
        const score = r.mate !== undefined ? `mate ${r.mate}` : `cp ${r.cp ?? 0}`;
        emit(`info depth ${depth} multipv 1 score ${score} pv ${aLegalUci(fen)}`);
        emit(`bestmove ${aLegalUci(fen)}`);
      }
    },
    onLine(h) {
      emit = h;
    },
    dispose() {},
  };
  return new UciEngine(transport);
}

const FA = (() => {
  const c = new Chess(RXD4_BEFORE);
  c.move('Rxd4');
  return c.fen();
})();

describe('analyzeMoveLive — deepens a forcing sacrifice and reports the deeper oracle', () => {
  const opts = { depth: 22, timeoutMs: 2000 };

  it('shallow inaccuracy that the deep search rehabilitates → verdict "sound"', async () => {
    // depth 14: cpLoss = (-36 + 131)/100 = 0.95 (inaccuracy). depth 22: (20 + -15)/100 = 0.05 (best).
    const engine = scriptedEngine((fen, depth) => {
      const deep = depth >= 20;
      if (fen === RXD4_BEFORE) return { cp: deep ? 20 : -36 };
      if (fen === FA) return { cp: deep ? -15 : 131 };
      return { cp: 0 };
    });
    const out = await analyzeMoveLive(engine, RXD4_BEFORE, 'Rxd4', 14, opts);
    expect(out.deepCheck?.verdict).toBe('sound');
    expect(out.deepCheck?.shallowClassification).toBe('inaccuracy');
    expect(out.classification).toBe('best');
    expect(out.topExplanation.toLowerCase()).toContain('re-scores it best');
  });

  it('shallow inaccuracy the deep search still dislikes → verdict "stands" (with caution)', async () => {
    // depth 22: (-36 + 120)/100 = 0.84 → still inaccuracy.
    const engine = scriptedEngine((fen, depth) => {
      const deep = depth >= 20;
      if (fen === RXD4_BEFORE) return { cp: -36 };
      if (fen === FA) return { cp: deep ? 120 : 131 };
      return { cp: 0 };
    });
    const out = await analyzeMoveLive(engine, RXD4_BEFORE, 'Rxd4', 14, opts);
    expect(out.deepCheck?.verdict).toBe('stands');
    expect(out.classification).toBe('inaccuracy');
    expect(out.topExplanation).toContain('Deep-checked to depth 22');
  });

  it('a deep search that times out NEVER downgrades the shallow verdict', async () => {
    const engine = scriptedEngine((fen, depth) => {
      if (depth >= 20) return 'timeout'; // deep pass stalls
      if (fen === RXD4_BEFORE) return { cp: -36 };
      if (fen === FA) return { cp: 131 };
      return { cp: 0 };
    });
    const out = await analyzeMoveLive(engine, RXD4_BEFORE, 'Rxd4', 14, { depth: 22, timeoutMs: 50 });
    expect(out.deepCheck).toBeUndefined(); // shallow analysis kept intact
    expect(out.classification).toBe('inaccuracy');
    expect(out.topExplanation).not.toContain('Deep-checked');
  });

  it('does not deepen a quiet, non-hanging adverse move (no second pass)', async () => {
    // A quiet king move that hangs nothing but scores a mistake → not forcing,
    // not a sacrifice → the expensive deep pass is never issued.
    const before = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    let deepCalls = 0;
    const engine = scriptedEngine((fen, depth) => {
      if (depth >= 20) deepCalls++;
      return new Chess(fen).turn() === 'w' ? { cp: 160 } : { cp: 200 };
    });
    const out = await analyzeMoveLive(engine, before, 'Kd1', 14, opts);
    expect(deepCalls).toBe(0);
    expect(out.deepCheck).toBeUndefined();
  });
});
