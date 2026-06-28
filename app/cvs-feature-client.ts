// CVS feature-inspection client (plan §6 PR-12). One function returns the full
// CvsFeatureInspectionV1 for a position (classical + optional NNUE eval + active
// CVS-NNUE registry features). Developer-only; active features are model inputs,
// not a causal explanation.
import {
  type CvsFeatureInspectionV1,
  isCvsFeatureInspectionV1,
} from '../engine/analysis-frame';

export async function getCvsFeatureInspection(fen: string): Promise<CvsFeatureInspectionV1> {
  const response = await fetch('/api/cvs-engine/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen }),
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error?: unknown }).error)
        : `CVS feature inspect failed (${response.status})`;
    throw new Error(message);
  }
  if (!isCvsFeatureInspectionV1(body)) {
    throw new Error('CVS feature inspection schema mismatch');
  }
  return body;
}
