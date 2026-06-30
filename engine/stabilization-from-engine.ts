/**
 * Engine→policy stabilization adapter (#35 slice 2; consumes rust-engine #7 slice 2).
 *
 * The analyze binary (rust #7 slice 2) emits a `stabilization` block whose `status` is the kebab-case
 * `StabilizationStatus::as_str` string. This adapter is the SINGLE boundary where that emitted JSON
 * meets the shared stabilization policy: it reads the status out of an analyze result and maps it
 * through `stabilizationGate`, returning the gate DECISION every consumer keys on. Consumers call
 * this, never the raw field — so a MISSING stabilization block (older / partial analyze output) is
 * FAIL-SAFE quarantined (the policy's default), and no downstream action can rest on an absent verdict.
 *
 * Pure, additive; no I/O.
 */
import { stabilizationGate, type StabilizationDecision } from './stabilization-policy';

/**
 * The stabilization block the analyze binary emits (rust #7 slice 2: `stabilization_json`). Every
 * field is optional so an older analyze result, or a partial one, degrades gracefully rather than
 * throwing.
 */
export interface EngineStabilization {
  status?: string;
  window?: number;
  scoreRangeCp?: number;
  maxAdjacentSwingCp?: number;
  bestMoveChanges?: number;
  oddEvenOscillation?: boolean;
  mateFlip?: boolean;
  signFlips?: number;
  seePruneSkips?: number;
  reasons?: string[];
}

/** Any analyze result that may carry a stabilization block. */
export interface AnalyzeResultLike {
  stabilization?: EngineStabilization | null;
}

/**
 * Map the engine's emitted stabilization status into the shared policy decision. A missing
 * stabilization block or status (older analyze output) is quarantined — the policy's fail-safe
 * default via `normalizeStatus` — so a consumer can never act confidently on an absent verdict.
 */
export function stabilizationFromEngine(
  result: AnalyzeResultLike | null | undefined,
): StabilizationDecision {
  const status = result?.stabilization?.status;
  return stabilizationGate(status); // undefined / unknown -> quarantined (fail-safe)
}

/**
 * The raw engine stabilization block, or null when absent — for carrying the engine's evidence
 * (score range, swings, reasons) alongside the policy decision (e.g. to persist with a minted puzzle).
 */
export function engineStabilization(
  result: AnalyzeResultLike | null | undefined,
): EngineStabilization | null {
  return result?.stabilization ?? null;
}
