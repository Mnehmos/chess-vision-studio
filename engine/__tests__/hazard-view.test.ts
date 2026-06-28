import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PositionFacts, TeachingFactBundleV1 } from '../teaching/types';
import {
  hazardDeltaView,
  hazardSectionHasEvidence,
  positionHazardsView,
  structureSectionHasEvidence,
} from '../hazard-view';

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

describe('positionHazardsView (PR-10 evidence)', () => {
  it('groups a created fork threat by side + kind with squares + magnitude + move', () => {
    const view = positionHazardsView(load('allowed-fork').played.position);
    expect(view.status).toBe('computed');
    if (view.status !== 'computed') return;
    expect(view.hasHazards).toBe(true);
    const fork = view.groups.find((g) => g.kind === 'fork_threat');
    expect(fork).toBeDefined();
    expect(fork?.side).toBe('white');
    // squares are the deduped + sorted union of the group's hazard squares
    expect(fork?.squares).toEqual(['e1', 'f3', 'g1']);
    expect(fork?.magnitudeCp).toBe(500);
    expect(fork?.moveUcis).toEqual(['g5f3']);
    expect(view.provenance).toContain('hazard_deltas');
  });

  it('surfaces a pin_constraint hazard (magnitude optional)', () => {
    const view = positionHazardsView(load('allowed-pin').played.position);
    expect(view.status).toBe('computed');
    if (view.status !== 'computed') return;
    const pin = view.groups.find((g) => g.kind === 'pin_constraint');
    expect(pin).toBeDefined();
    expect(pin?.magnitudeCp).toBeUndefined(); // no magnitudeCp in the fixture
    expect(pin?.squares).toEqual(['d1', 'e2', 'f3', 'g4']);
  });

  it('computed-empty is hasHazards:false, NOT an uncomputed/unavailable claim', () => {
    const view = positionHazardsView(load('allowed-fork').before);
    expect(view.status).toBe('computed');
    if (view.status !== 'computed') return;
    expect(view.hasHazards).toBe(false);
    expect(view.groups).toEqual([]);
  });

  it('uncomputed hazards stay tagged with their reason — never silent "none"', () => {
    const view = positionHazardsView(load('missed-hanging-piece').before);
    expect(view.status).toBe('uncomputed');
    if (view.status === 'computed') return;
    expect(view.reason).toBe('motifs_not_requested');
  });

  it('preserves uncomputed/unavailable distinctly from computed-empty', () => {
    const damage = positionHazardsView(load('pawn-structure-damage').played.position);
    const fork = positionHazardsView(load('allowed-fork').before);
    expect(damage.status).toBe('uncomputed'); // not computed at all
    expect(fork.status).toBe('computed'); // computed, just empty
    if (fork.status === 'computed') expect(fork.hasHazards).toBe(false);
  });
});

describe('hazardDeltaView (PR-10 evidence)', () => {
  it('sections a created-hazard delta (fork) and reports the move', () => {
    const view = hazardDeltaView(load('allowed-fork').played);
    expect(view.moveUci).toBe('a1e1'); // the delta's own (played) move; the fork's realizing move (g5f3) lives on the hazard item
    expect(view.createdHazards.status).toBe('computed');
    if (view.createdHazards.status !== 'computed') return;
    expect(view.createdHazards.groups).toHaveLength(1);
    expect(view.createdHazards.groups[0].kind).toBe('fork_threat');
    // removed/worsened computed-but-empty (verified no change)
    expect(view.removedHazards.status).toBe('computed');
    expect(view.worsenedHazards.status).toBe('computed');
    if (view.removedHazards.status === 'computed') {
      expect(view.removedHazards.groups).toEqual([]);
    }
    expect(view.provenance).toContain('hazard_deltas');
    expect(view.provenance).toContain('pawn_structure');
  });

  it('sections created + removed structure deltas, grouped + stably ordered', () => {
    const view = hazardDeltaView(load('pawn-structure-damage').played);
    expect(view.createdStructures.status).toBe('computed');
    if (view.createdStructures.status !== 'computed') return;
    const kinds = view.createdStructures.groups.map((g) => `${g.side}:${g.kind}`);
    // deterministic order: doubled < isolated < passed (by STRUCTURE_KIND_RANK)
    expect(kinds).toEqual(['white:doubled_pawns', 'white:isolated_pawn', 'white:passed_pawn']);
    const isolated = view.createdStructures.groups.find((g) => g.kind === 'isolated_pawn');
    expect(isolated?.squares).toEqual(['c2', 'c4']); // grouped + deduped + sorted

    expect(view.removedStructures.status).toBe('computed');
    if (view.removedStructures.status === 'computed') {
      expect(view.removedStructures.groups).toHaveLength(1);
      expect(view.removedStructures.groups[0].side).toBe('black');
      expect(view.removedStructures.groups[0].kind).toBe('isolated_pawn');
    }
  });

  it('hazard delta sections preserve unavailable status (not computed-empty)', () => {
    const view = hazardDeltaView(load('pawn-structure-damage').played);
    expect(view.createdHazards.status).toBe('unavailable');
    if (view.createdHazards.status === 'computed') return;
    expect(view.createdHazards.reason).toBe('hazards_unavailable_for_delta');
    // structures ARE computed in this same move — sections are independent
    expect(view.createdStructures.status).toBe('computed');
  });

  it('unavailable != none: a non-computed section still carries evidence to surface', () => {
    const view = hazardDeltaView(load('missed-hanging-piece').played);
    expect(view.removedHazards.status).toBe('unavailable');
    // hazardSectionHasEvidence is true for non-computed (reason must be shown)…
    expect(hazardSectionHasEvidence(view.removedHazards)).toBe(true);
    // …and false for a computed-empty structure section (verified no change)
    expect(view.createdStructures.status).toBe('computed');
    if (view.createdStructures.status === 'computed') {
      expect(view.createdStructures.groups).toEqual([]);
    }
    expect(structureSectionHasEvidence(view.createdStructures)).toBe(false);
  });

  it('grouping + ordering is stable across every fixture branch (no throw, deterministic)', () => {
    for (const name of [
      'allowed-fork',
      'allowed-pin',
      'failed-defense',
      'missed-hanging-piece',
      'pawn-structure-damage',
    ]) {
      for (const position of branches(load(name))) {
        const a = positionHazardsView(position);
        const b = positionHazardsView(position);
        expect(a).toEqual(b); // pure + deterministic
        if (a.status === 'computed') {
          // groups sorted: white before black, then by kind rank/string
          const sideOrder = a.groups.map((g) => (g.side === 'white' ? 0 : 1));
          const sorted = [...sideOrder].sort((x, y) => x - y);
          expect(sideOrder).toEqual(sorted);
        }
      }
    }
  });
});
