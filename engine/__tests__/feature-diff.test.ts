import { describe, expect, it } from 'vitest';
import { buildFeatureInspection, type CvsFeatureInspectionV1 } from '../analysis-frame/inspection';
import { diffFeatureInspections, nnueEvalComparison } from '../feature-diff';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function inspection(
  ids: number[],
  names: string[],
  over: Partial<Pick<CvsFeatureInspectionV1, 'registryVersion' | 'registryHash'>> = {},
  nnueStmCp: number | null = 20,
): CvsFeatureInspectionV1 {
  return buildFeatureInspection({
    fen: FEN,
    evalWhiteCp: 10,
    nnueStmCp,
    registryVersion: over.registryVersion ?? 1,
    registryHash: over.registryHash ?? 'hash-1',
    inputDim: 168,
    activeIds: ids,
    activeNames: names,
  });
}

describe('diffFeatureInspections (PR-12)', () => {
  it('computes activated/deactivated deterministically (sorted by id)', () => {
    const before = inspection([9, 30, 66], ['A', 'B', 'C']);
    const after = inspection([9, 30, 93, 81], ['A', 'B', 'Z', 'Y']);
    const diff = diffFeatureInspections(before, after);
    expect(diff.status).toBe('computed');
    expect(diff.activated.map((r) => r.id)).toEqual([81, 93]); // sorted
    expect(diff.deactivated.map((r) => r.id)).toEqual([66]);
    expect(diff.activated.find((r) => r.id === 81)?.name).toBe('Y');
  });

  it('handles duplicate ids (dedup, first name wins)', () => {
    const before = inspection([9, 9, 30], ['A', 'dup', 'B']);
    const after = inspection([30], ['B']);
    const diff = diffFeatureInspections(before, after);
    expect(diff.deactivated.map((r) => r.id)).toEqual([9]);
    expect(diff.deactivated[0].name).toBe('A');
  });

  it('blocks the diff on a registry-version mismatch', () => {
    const before = inspection([9], ['A'], { registryVersion: 1 });
    const after = inspection([9], ['A'], { registryVersion: 2 });
    const diff = diffFeatureInspections(before, after);
    expect(diff.status).toBe('registry_mismatch');
    expect(diff.activated).toEqual([]);
    expect(diff.deactivated).toEqual([]);
  });

  it('blocks the diff on a registry-hash mismatch', () => {
    const before = inspection([9], ['A'], { registryHash: 'h1' });
    const after = inspection([9], ['A'], { registryHash: 'h2' });
    expect(diffFeatureInspections(before, after).status).toBe('registry_mismatch');
  });
});

describe('nnueEvalComparison (PR-12)', () => {
  it('computes a White-normalized delta when both have NNUE', () => {
    const before = inspection([], [], {}, 20);
    const after = inspection([], [], {}, 50);
    const cmp = nnueEvalComparison(before, after);
    expect(cmp.status).toBe('computed');
    expect(cmp.deltaWhiteCp).toBe(30);
  });

  it('reports unavailable when NNUE is missing on either side', () => {
    const before = inspection([], [], {}, null);
    const after = inspection([], [], {}, 50);
    const cmp = nnueEvalComparison(before, after);
    expect(cmp.status).toBe('unavailable');
    expect(cmp.deltaWhiteCp).toBeNull();
  });
});
