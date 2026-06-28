/**
 * ArtifactState<T> — the canonical status wrapper for every analysis-derived
 * artifact in AnalysisFrameV2 (plan §4.1). It keeps the absence states the plan
 * requires distinct (§3.4): "not requested" (idle), "in flight" (pending),
 * "ran and produced a value" (computed), "cannot answer / not supported"
 * (unavailable), and "failed" (error). `null` must not be used to mean any of
 * these once a component is migrated onto the frame.
 */
export type ArtifactState<T> =
  | { status: 'idle' }
  | { status: 'pending'; requestedAt: string }
  | { status: 'computed'; value: T; completedAt: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; message: string };

export const idle = (): ArtifactState<never> => ({ status: 'idle' });

export const pending = (requestedAt: string): ArtifactState<never> => ({
  status: 'pending',
  requestedAt,
});

export const computed = <T>(value: T, completedAt: string): ArtifactState<T> => ({
  status: 'computed',
  value,
  completedAt,
});

export const unavailable = (reason: string): ArtifactState<never> => ({
  status: 'unavailable',
  reason,
});

export const errored = (message: string): ArtifactState<never> => ({
  status: 'error',
  message,
});

export function isComputed<T>(
  state: ArtifactState<T>,
): state is { status: 'computed'; value: T; completedAt: string } {
  return state.status === 'computed';
}

/** The computed value, or a fallback for every non-computed status. */
export function artifactValue<T>(state: ArtifactState<T>, fallback: T): T {
  return state.status === 'computed' ? state.value : fallback;
}

/** The computed value, or `null` — for legacy boundaries that still expect null. */
export function artifactValueOrNull<T>(state: ArtifactState<T>): T | null {
  return state.status === 'computed' ? state.value : null;
}
