import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PositionFacts, TeachingFactBundleV1 } from '../teaching/types';
import {
  forkOpportunityView,
  hangingPieceView,
  moveHazardDeltaView,
  occupiedPieceDefenseView,
  occupiedPieceThreatView,
  pawnFeatureView,
  pawnStructureView,
  pieceFactForSquare,
  pinOpportunityView,
} from '../facts-adapters';

// The golden Rust fact corpus shipped with the app — covers the PR-06 parity
// categories (fork, pin, defended/only-defender, SEE-losing, doubled, isolated).
const CORPUS = [
  'allowed-fork',
  'allowed-pin',
  'failed-defense',
  'missed-hanging-piece',
  'pawn-structure-damage',
] as const;

function load(name: string): TeachingFactBundleV1 {
  return JSON.parse(
    readFileSync(new URL(`../../fixtures/teaching-facts/v1/${name}.json`, import.meta.url), 'utf8'),
  ) as TeachingFactBundleV1;
}

function branches(b: TeachingFactBundleV1): PositionFacts[] {
  const out = [b.before, b.played.position];
  if (b.best) out.push(b.best.position);
  if (b.refutation) out.push(b.refutation.position);
  return out;
}

function someBranch(name: string, pred: (p: PositionFacts) => boolean): boolean {
  return branches(load(name)).some(pred);
}

describe('Rust fact adapters (PR-06)', () => {
  it('fork opportunities prefer Rust validators (allowed-fork)', () => {
    const found = someBranch('allowed-fork', (p) => {
      const v = forkOpportunityView(p);
      expect(v.source).toBe('rust');
      return v.status === 'computed' && v.data.length > 0 && v.provenance.includes('fork_validation');
    });
    expect(found).toBe(true);
  });

  it('pin opportunities prefer Rust validators (allowed-pin)', () => {
    const found = someBranch('allowed-pin', (p) => {
      const v = pinOpportunityView(p);
      return v.status === 'computed' && v.data.length > 0 && v.provenance.includes('pin_validation');
    });
    expect(found).toBe(true);
  });

  it('hanging lens uses computed SEE-losing pieces', () => {
    for (const name of ['allowed-pin', 'failed-defense', 'missed-hanging-piece', 'pawn-structure-damage']) {
      expect(someBranch(name, (p) => hangingPieceView(p).data.length > 0), name).toBe(true);
    }
  });

  it('defense view surfaces only-defender relations', () => {
    expect(
      someBranch('allowed-fork', (p) =>
        occupiedPieceDefenseView(p).data.some((d) => d.onlyDefenderOf.length > 0),
      ),
    ).toBe(true);
  });

  it('threat view surfaces attacked occupied pieces', () => {
    expect(someBranch('pawn-structure-damage', (p) => occupiedPieceThreatView(p).data.length > 0)).toBe(
      true,
    );
  });

  it('pawn-structure computed fields (doubled / isolated)', () => {
    expect(someBranch('pawn-structure-damage', (p) => pawnStructureView(p).data.doubled.length > 0)).toBe(
      true,
    );
    expect(someBranch('pawn-structure-damage', (p) => pawnStructureView(p).data.isolated.length > 0)).toBe(
      true,
    );
  });

  it('uncomputed Rust fields stay tagged — never an empty "none" claim', () => {
    for (const name of CORPUS) {
      for (const p of branches(load(name))) {
        const view = pawnFeatureView(p.pawnStructure.backward, 'pawn_structure');
        expect(view.status).not.toBe('computed'); // uncomputed (or unavailable)
        expect(view.data).toEqual([]); // empty, but the STATUS tells the consumer not to render "none"
      }
    }
  });

  it('move hazard-delta view exposes all five delta sections with provenance', () => {
    const view = moveHazardDeltaView(load('pawn-structure-damage').played);
    expect(view.source).toBe('rust');
    expect(view.provenance.length).toBeGreaterThan(0);
    for (const key of [
      'createdHazards',
      'removedHazards',
      'worsenedHazards',
      'createdStructures',
      'removedStructures',
    ]) {
      expect(key in view.data).toBe(true);
    }
  });

  it('pieceFactForSquare resolves a real piece', () => {
    const before = load('allowed-fork').before;
    const square = before.pieces[0]?.square;
    expect(square).toBeTruthy();
    expect(pieceFactForSquare(before, square)?.square).toBe(square);
    expect(pieceFactForSquare(before, 'z9')).toBeUndefined();
  });
});
