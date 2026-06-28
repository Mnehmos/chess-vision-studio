import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CvsSearchTelemetryV2 } from '../analysis-frame/telemetry';
import {
  deriveTelemetryMetrics,
  populatedBranchingPlies,
  safePct,
  safeRatio,
} from '../search-telemetry';

function loadTelemetry(): CvsSearchTelemetryV2 {
  const fixture = JSON.parse(
    readFileSync(new URL('../../fixtures/cvs-engine/search-v1.json', import.meta.url), 'utf8'),
  ) as { telemetry: CvsSearchTelemetryV2 };
  return fixture.telemetry;
}

function zeroTelemetry(): CvsSearchTelemetryV2 {
  const t = loadTelemetry();
  const zeroed = { ...t };
  for (const k of Object.keys(zeroed) as (keyof CvsSearchTelemetryV2)[]) {
    if (typeof zeroed[k] === 'number') (zeroed as Record<string, unknown>)[k] = 0;
  }
  zeroed.foreignHints = [0, 0, 0, 0];
  zeroed.foreignCutoffs = [0, 0, 0, 0];
  zeroed.branchingByPly = [];
  return zeroed;
}

describe('safeRatio / safePct (divide-by-zero guards)', () => {
  it('guards a zero denominator (no NaN/Infinity)', () => {
    expect(safeRatio(5, 0)).toBe(0);
    expect(safePct(5, 0)).toBe(0);
    expect(safeRatio(1, 2)).toBe(0.5);
    expect(safePct(1, 2)).toBe(50);
  });
});

describe('deriveTelemetryMetrics (PR-11)', () => {
  it('produces only finite numbers on the golden fixture', () => {
    const d = deriveTelemetryMetrics(loadTelemetry());
    for (const [key, value] of Object.entries(d)) {
      expect(Number.isFinite(value), `${key} should be finite`).toBe(true);
    }
    expect(d.qNodeShare).toBeGreaterThan(0);
    expect(d.qNodeShare).toBeLessThanOrEqual(1);
  });

  it('all-zero telemetry yields finite zeros (never NaN/Infinity)', () => {
    const d = deriveTelemetryMetrics(zeroTelemetry());
    for (const [key, value] of Object.entries(d)) {
      expect(Number.isFinite(value), `${key} should be finite`).toBe(true);
      expect(value).toBe(0);
    }
  });
});

describe('populatedBranchingPlies', () => {
  it('includes only plies with activity', () => {
    const rows = populatedBranchingPlies(loadTelemetry());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.nodes > 0 || r.childSearches > 0)).toBe(true);
  });
  it('returns empty for empty branching data', () => {
    expect(populatedBranchingPlies(zeroTelemetry())).toEqual([]);
  });
});
