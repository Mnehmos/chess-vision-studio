// A failed or stalled Stockfish search must resolve an explicit 'unavailable' Eval —
// never hang, and never masquerade as a genuine 0.00 (which would read as 'best').
import { describe, it, expect } from 'vitest';
import { UciEngine, type EngineTransport } from '../evaluation';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Minimal UCI stub: replies 'readyok' to the handshake; on 'go' it runs `onGo`.
function stub(onGo: (emit: (line: string) => void) => void): EngineTransport {
  let emit: (line: string) => void = () => {};
  return {
    send(cmd: string) {
      if (cmd === 'isready') emit('readyok');
      else if (cmd.startsWith('go')) onGo(emit);
    },
    onLine(h) {
      emit = h;
    },
    dispose() {},
  };
}

describe('UciEngine — a failed/stalled search is "unavailable", never a fake 0.00', () => {
  it('marks an empty (no usable info line) result unavailable', async () => {
    const engine = new UciEngine(stub((emit) => emit('bestmove (none)')));
    const e = await engine.evaluate({ fen: START, depth: 12, timeoutMs: 1000 });
    expect(e.status).toBe('unavailable');
    expect(e.cp).toBeUndefined();
    expect(e.mate).toBeUndefined();
  });

  it('times out a stalled search instead of hanging forever', async () => {
    const engine = new UciEngine(stub(() => {/* never replies to `go` */}));
    const e = await engine.evaluate({ fen: START, depth: 12, timeoutMs: 30 });
    expect(e.status).toBe('unavailable');
  });
});
