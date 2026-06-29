import { describe, expect, it } from 'vitest';
import { isEngineResponseLine } from '../rust-engine';

// The serve bridge matches engine output to pending requests FIFO by line; a single
// stray line (banner/info/blank) would shift every future response by one and desync
// the engine permanently (the live bug: bot resigned games when the engine emitted an
// extra line). isEngineResponseLine is the guard that only treats JSON objects as
// responses, so anything else is ignored instead of consuming a request slot.
describe('isEngineResponseLine', () => {
  it('accepts JSON-object response lines (with or without leading whitespace)', () => {
    expect(isEngineResponseLine('{"uci":"e2e4","scoreCp":12}')).toBe(true);
    expect(isEngineResponseLine('   {"evalWhiteCp":-5}')).toBe(true);
  });

  it('ignores non-response lines that would desync the request queue', () => {
    expect(isEngineResponseLine('')).toBe(false);
    expect(isEngineResponseLine('readyok')).toBe(false);
    expect(isEngineResponseLine('info string loaded nnue matrix-raw.json')).toBe(false);
    expect(isEngineResponseLine('Stockfish 16 by the Stockfish developers')).toBe(false);
    expect(isEngineResponseLine('  warning: helper net missing')).toBe(false);
  });
});
