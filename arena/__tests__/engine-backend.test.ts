// R5 integration tests — the Rust backend through the app-side backend seam.
// Requires the release binary (cargo build --release in the rust repo); the
// whole suite is skipped with a notice if it's missing.
import { describe, expect, it, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { Chess } from 'chess.js';
import { createEngineBackend, resolveBackendKind, RustBackend, TsLegacyBackend } from '../engine-backend';
import { DEFAULT_RUST_EXE, rustBackendExtraArgs } from '../engine-backend/rust-backend';
import { lichessRustExtraArgs } from '../lichess/run';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FORENSIC_549 = '5r2/pp5R/1kp3p1/6b1/4P1b1/1BNP2P1/PPP4P/1K6 w - - 1 22';
const haveExe = existsSync(DEFAULT_RUST_EXE);

const disposables: { dispose(): void }[] = [];
afterAll(() => {
  for (const d of disposables) d.dispose();
});

describe('backend selector', () => {
  it('maps neural and search environment settings to Rust CLI flags', () => {
    expect(rustBackendExtraArgs({
      CVS_RUST_NNUE: 'main.json',
      CVS_RUST_HELPER_NNUE: 'helper.json',
      CVS_RUST_ALLOW_UNVERIFIED: '1',
      CVS_RUST_FUTILITY: '1',
      CVS_RUST_RFP: '1',
      CVS_RUST_TTPS: '1',
      CVS_RUST_QTT: '1',
      CVS_RUST_HISTMALUS: '1',
      CVS_RUST_HISTLMR: '1',
    })).toEqual([
      '--nnue', 'main.json',
      '--helper-nnue', 'helper.json',
      '--allow-unverified-net',
      '--futility',
      '--rfp',
      '--tt-prune-store',
      '--qtt',
      '--histmalus',
      '--histlmr',
    ]);
  });

  it('keeps the analysis helper out of Lichess unless explicitly opted in', () => {
    const baseEnv = {
      CVS_RUST_NNUE: 'main.json',
      CVS_RUST_HELPER_NNUE: 'analysis-helper.json',
      CVS_RUST_FUTILITY: '1',
    };
    expect(lichessRustExtraArgs(baseEnv)).toEqual([
      '--nnue', 'main.json',
      '--futility',
    ]);
    expect(lichessRustExtraArgs({
      ...baseEnv,
      CVS_LICHESS_RUST_HELPER_NNUE: 'live-helper.json',
    })).toEqual([
      '--nnue', 'main.json',
      '--helper-nnue', 'live-helper.json',
      '--futility',
    ]);
  });

  it('resolves rust by default and ts on request', () => {
    expect(resolveBackendKind(undefined)).toBe(process.env.CVS_ENGINE_BACKEND === 'ts' ? 'ts' : 'rust');
    expect(resolveBackendKind('ts')).toBe('ts');
    expect(resolveBackendKind('rust')).toBe('rust');
    expect(resolveBackendKind('legacy')).toBe('ts');
  });

  it('constructs the right backend classes', () => {
    const ts = createEngineBackend('ts');
    disposables.push(ts);
    expect(ts).toBeInstanceOf(TsLegacyBackend);
    if (haveExe) {
      const rust = createEngineBackend('rust');
      disposables.push(rust);
      expect(rust).toBeInstanceOf(RustBackend);
    }
  });
});

describe.skipIf(!haveExe)('RustBackend (CLI subprocess)', () => {
  const rust = new RustBackend();
  const ts = createEngineBackend('ts');
  disposables.push(rust, ts);

  it('evaluates startpos with exact TS parity', async () => {
    const r = await rust.evaluate(START);
    const t = await ts.evaluate(START);
    expect(r.evalWhiteCp).toBe(t.evalWhiteCp);
  });

  it('returns a legal best move for startpos', async () => {
    const r = await rust.bestMove(START, { depth: 3 });
    expect(r.uci).toBeTruthy();
    const c = new Chess(START);
    const m = c.move({ from: r.uci!.slice(0, 2), to: r.uci!.slice(2, 4), promotion: r.uci!.slice(4) || undefined });
    expect(m).toBeTruthy();
  });

  it('analyzes the d4/d5 forensic FEN (d4 avoids the quiet-refuted b3f7)', async () => {
    const r = await rust.analyze(FORENSIC_549, { depth: 4 });
    expect(r.uci).not.toBe('b3f7');
    expect(r.nodes).toBeGreaterThan(0);
    expect(r.qNodes).toBeGreaterThan(0);
  });

  it('JSON protocol is stable across sequential requests', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await rust.analyze(START, { depth: 2 });
      expect(r.uci).toBeTruthy();
      expect(Number.isFinite(r.scoreCp)).toBe(true);
    }
  });

  it('never returns an illegal move on a battery', async () => {
    const fens = [
      START,
      FORENSIC_549,
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
      '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
      '4r1k1/1p3pp1/p1p3rp/P1Qnq3/1PB5/4P3/5PPP/3R1RK1 b - - 5 27',
    ];
    for (const fen of fens) {
      const r = await rust.bestMove(fen, { depth: 3 });
      const c = new Chess(fen);
      const legal = !!c.move({ from: r.uci!.slice(0, 2), to: r.uci!.slice(2, 4), promotion: r.uci!.slice(4) || undefined });
      expect(legal, `illegal move ${r.uci} on ${fen}`).toBe(true);
    }
  });

  it('reports identity (engine version + weights id)', () => {
    const id = rust.id();
    expect(id.backend).toBe('rust');
    expect(id.engine).toContain('cvs-bitboard-core');
    expect(id.weightsId).toContain('value-weights-mixed');
  });
});
