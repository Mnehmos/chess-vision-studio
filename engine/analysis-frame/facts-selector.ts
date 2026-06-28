/**
 * Shared occupied-square facts selector for Analyze and Play (plan §6 PR-05).
 * One helper decides where a FactsPanel gets its PositionFacts so both modes
 * behave identically:
 *   - pending      → no facts yet; the panel shows a loading state and must NOT
 *                    fall back to the TypeScript report while a matching Rust
 *                    request is in flight.
 *   - rust         → the bundle matches the board (via the PR-01 legal-position
 *                    key); use the Rust PositionFacts.
 *   - fallback     → Rust is unavailable/failed, or ran but does not cover this
 *                    board; the panel uses its TypeScript report.
 */
import type { PositionFacts, TeachingFactBundleV1 } from '../teaching/types';
import { matchPositionFacts } from './match';

export type FactsArtifactStatus = 'idle' | 'pending' | 'computed' | 'unavailable' | 'error';
export type FactsSource = 'rust' | 'pending' | 'fallback';

export interface SelectedPositionFacts {
  source: FactsSource;
  position: PositionFacts | null;
}

export function selectPositionFacts(
  status: FactsArtifactStatus,
  bundle: TeachingFactBundleV1 | null | undefined,
  fen: string,
): SelectedPositionFacts {
  if (status === 'pending') return { source: 'pending', position: null };
  if (status === 'computed' && bundle) {
    const matched = matchPositionFacts(bundle, fen);
    if (matched) return { source: 'rust', position: matched.position };
  }
  return { source: 'fallback', position: null };
}
