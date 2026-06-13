import {
  isTeachingFactBundleV1,
  type TeachingFactBundleV1,
  type TeachingFactsRequestV1,
} from '../engine/teaching/types';

export interface CvsEngineHealth {
  ok: boolean;
  available: boolean;
  exe?: string;
  depth?: number;
  flags?: string[];
  error?: string;
}

export interface CvsEngineTelemetry {
  qNodePct?: number;
  ttHitPct?: number;
  rfpCutoffPct?: number;
  futilitySkipPct?: number;
  firstMoveCutoffPct?: number;
  avgCutoffMoveIndex?: number;
  searchedEffectiveBranching?: number;
}

export interface CvsEngineAnalysis {
  fen: string;
  uci: string | null;
  scoreCp: number;
  mate: number | null;
  pv: string[];
  depth: number;
  nodes: number;
  qNodes: number;
  ttHits: number;
  timeMs: number;
  telemetry?: CvsEngineTelemetry;
  error?: string;
}

export async function getCvsEngineHealth(): Promise<CvsEngineHealth> {
  const response = await fetch('/api/cvs-engine/health');
  if (!response.ok) throw new Error(`CVS Engine health failed (${response.status})`);
  return (await response.json()) as CvsEngineHealth;
}

export async function analyzeWithCvsEngine(
  fen: string,
  depth?: number,
): Promise<CvsEngineAnalysis> {
  const response = await fetch('/api/cvs-engine/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen, depth }),
  });
  const body = (await response.json()) as CvsEngineAnalysis | { error?: string };
  if (!response.ok) throw new Error(body.error || `CVS Engine analyze failed (${response.status})`);
  return body as CvsEngineAnalysis;
}

export async function getTeachingFacts(
  request: TeachingFactsRequestV1,
): Promise<TeachingFactBundleV1> {
  const response = await fetch('/api/cvs-engine/facts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error?: unknown }).error)
        : `CVS Engine facts failed (${response.status})`;
    throw new Error(message);
  }
  if (!isTeachingFactBundleV1(body)) {
    throw new Error('CVS Engine facts schema mismatch');
  }
  return body;
}
