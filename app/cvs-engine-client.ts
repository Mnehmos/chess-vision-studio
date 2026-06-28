import {
  isTeachingFactBundleV1,
  type TeachingFactBundleV1,
  type TeachingFactsRequestV1,
} from '../engine/teaching/types';
import { type SearchBudget, searchBudgetToRequestFields } from '../engine/analysis-frame';

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

export interface CvsEngineAnalyzeRequest {
  fen: string;
  /** Preferred: explicit resource budget (movetime or depth). */
  budget?: SearchBudget;
  /** Legacy depth fallback when no budget is supplied. */
  depth?: number;
  forcedMove?: string;
}

// Request-object form (plan §6 PR-02). Serializes the budget to the proxy's
// `movetimeMs`/`depth` fields. History fields (initialFen/moves) arrive in PR-04.
export async function analyzeWithCvsEngineRequest(
  request: CvsEngineAnalyzeRequest,
): Promise<CvsEngineAnalysis> {
  const body = {
    fen: request.fen,
    forcedMove: request.forcedMove,
    ...searchBudgetToRequestFields(request.budget, request.depth),
  };
  const response = await fetch('/api/cvs-engine/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json()) as CvsEngineAnalysis | { error?: string };
  if (!response.ok) throw new Error(parsed.error || `CVS Engine analyze failed (${response.status})`);
  return parsed as CvsEngineAnalysis;
}

// Positional compatibility wrapper (existing callers).
export async function analyzeWithCvsEngine(
  fen: string,
  depth?: number,
  forcedMove?: string,
): Promise<CvsEngineAnalysis> {
  return analyzeWithCvsEngineRequest({ fen, depth, forcedMove });
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
