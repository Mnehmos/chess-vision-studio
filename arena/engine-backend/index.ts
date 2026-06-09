// Engine backend selector (R5). Choose with CVS_ENGINE_BACKEND=rust|ts (or the
// explicit argument). Per the R4 gate verdict (R4_GATE_REPORT.md: parity at
// d2–d4, Rust d6 beats TS d4 by 27% avg cpLoss at 32× speed, illegal=0,
// mate-missed=0), the DEFAULT is the Rust backend. The TS legacy backend stays
// available — explicitly, not hidden — via CVS_ENGINE_BACKEND=ts.
import { readFileSync } from 'node:fs';
import type { Rung2Weights, ValueWeights } from '@cvs/engine';
import type { CvsEngineBackend } from './types';
import { TsLegacyBackend } from './ts-legacy';
import { DEFAULT_BASE_WEIGHTS, DEFAULT_RUNG2_WEIGHTS, RustBackend, type RustBackendOptions } from './rust-backend';

export type BackendKind = 'rust' | 'ts';

export function resolveBackendKind(explicit?: string): BackendKind {
  const k = (explicit ?? process.env.CVS_ENGINE_BACKEND ?? 'rust').toLowerCase();
  if (k === 'ts' || k === 'ts-legacy' || k === 'legacy') return 'ts';
  return 'rust';
}

export function createEngineBackend(kind?: string, rustOptions?: RustBackendOptions): CvsEngineBackend {
  if (resolveBackendKind(kind) === 'ts') {
    // Load the same trained weights the rust backend uses, so the comparison is
    // engine-vs-engine, not weights-vs-weights.
    let base: ValueWeights | undefined;
    let rung2: Rung2Weights | undefined;
    let weightsId = 'default';
    try {
      base = JSON.parse(readFileSync(DEFAULT_BASE_WEIGHTS, 'utf8'));
      rung2 = JSON.parse(readFileSync(DEFAULT_RUNG2_WEIGHTS, 'utf8'));
      weightsId = 'mixed+rung2';
    } catch {
      /* fall back to handcrafted defaults */
    }
    return new TsLegacyBackend(base, rung2, weightsId);
  }
  return new RustBackend(rustOptions);
}

export type { CvsEngineBackend, MoveResult, EvalResult, SearchOpts, BackendId } from './types';
export { TsLegacyBackend } from './ts-legacy';
export { RustBackend, RUST_DEFAULT_DEPTH } from './rust-backend';
