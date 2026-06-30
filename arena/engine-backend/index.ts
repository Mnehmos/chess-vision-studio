// Engine backend selector (R5). Choose with CVS_ENGINE_BACKEND=rust|ts (or the
// explicit argument). Per the R4 gate verdict (R4_GATE_REPORT.md: parity at
// d2–d4, Rust d6 beats TS d4 by 27% avg cpLoss at 32× speed, illegal=0,
// mate-missed=0), the DEFAULT is the Rust backend. The TS legacy backend stays
// available — explicitly, not hidden — via CVS_ENGINE_BACKEND=ts.
import { DEFAULT_POLICY_WEIGHTS } from '@cvs/engine';
import type { CvsEngineBackend } from './types';
import { TsLegacyBackend } from './ts-legacy';
import { RustBackend, type RustBackendOptions } from './rust-backend';

export type BackendKind = 'rust' | 'ts';

export function resolveBackendKind(explicit?: string): BackendKind {
  const k = (explicit ?? process.env.CVS_ENGINE_BACKEND ?? 'rust').toLowerCase();
  if (k === 'ts' || k === 'ts-legacy' || k === 'legacy') return 'ts';
  return 'rust';
}

export function createEngineBackend(kind?: string, rustOptions?: RustBackendOptions): CvsEngineBackend {
  if (resolveBackendKind(kind) === 'ts') {
    // TS legacy reference backend. @cvs/engine's value head is fixed now (the tunable value/rung2
    // weights moved to the Rust engine), so the legacy engine runs on the default policy weights as
    // a frozen reference — engine-vs-engine, not weights-vs-weights.
    return new TsLegacyBackend(DEFAULT_POLICY_WEIGHTS, 'policy-default');
  }
  return new RustBackend(rustOptions);
}

export type { CvsEngineBackend, MoveResult, EvalResult, PositionContext, SearchOpts, BackendId } from './types';
export { TsLegacyBackend } from './ts-legacy';
export { RustBackend, RUST_DEFAULT_DEPTH } from './rust-backend';
