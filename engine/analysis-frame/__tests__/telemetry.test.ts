import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CVS_TELEMETRY_NUMBER_FIELDS,
  type CvsSearchTelemetryV2,
  isCvsSearchTelemetryV2,
} from '../telemetry';

function loadTelemetry(): unknown {
  const fixture = JSON.parse(
    readFileSync(new URL('../../../fixtures/cvs-engine/search-v1.json', import.meta.url), 'utf8'),
  ) as { telemetry: unknown };
  return fixture.telemetry;
}

describe('CvsSearchTelemetryV2 contract (PR-11)', () => {
  const telemetry = loadTelemetry();

  it('the golden fixture telemetry parses through the guard', () => {
    expect(isCvsSearchTelemetryV2(telemetry)).toBe(true);
  });

  it('every typed number field is present and a number', () => {
    const t = telemetry as Record<string, unknown>;
    for (const field of CVS_TELEMETRY_NUMBER_FIELDS) {
      expect(field in t, `missing telemetry field "${field}"`).toBe(true);
      expect(typeof t[field], `telemetry.${field} should be number`).toBe('number');
    }
  });

  it('array fields have the documented shapes', () => {
    const t = telemetry as CvsSearchTelemetryV2;
    expect(Array.isArray(t.foreignHints)).toBe(true);
    expect(Array.isArray(t.foreignCutoffs)).toBe(true);
    expect(Array.isArray(t.branchingByPly)).toBe(true);
    for (const row of t.branchingByPly) {
      for (const key of ['ply', 'nodes', 'childSearches', 'effectiveBranching']) {
        expect(typeof (row as unknown as Record<string, unknown>)[key]).toBe('number');
      }
    }
  });

  it('rejects non-telemetry objects', () => {
    expect(isCvsSearchTelemetryV2(null)).toBe(false);
    expect(isCvsSearchTelemetryV2({ nodes: 1 })).toBe(false);
    expect(isCvsSearchTelemetryV2({ ...(telemetry as object), nodes: 'x' })).toBe(false);
  });
});
