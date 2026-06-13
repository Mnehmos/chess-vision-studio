import { describe, expect, it } from 'vitest';
import allowedFork from '../../fixtures/teaching-facts/v1/allowed-fork.json';
import allowedPin from '../../fixtures/teaching-facts/v1/allowed-pin.json';
import failedDefense from '../../fixtures/teaching-facts/v1/failed-defense.json';
import missedHangingPiece from '../../fixtures/teaching-facts/v1/missed-hanging-piece.json';
import pawnStructureDamage from '../../fixtures/teaching-facts/v1/pawn-structure-damage.json';
import { isTeachingFactBundleV1, type TeachingFactBundleV1 } from './types';

const fixtures = [allowedFork, allowedPin, missedHangingPiece, failedDefense, pawnStructureDamage];

describe('TeachingFactBundleV1 Rust fixtures', () => {
  it('consumes every mirrored Rust fixture with stable schema and conventions', () => {
    for (const fixture of fixtures) {
      expect(isTeachingFactBundleV1(fixture)).toBe(true);
      const bundle = fixture as TeachingFactBundleV1;
      expect(bundle.provenance.engine).toBe('cvs-bitboard-core');
      expect(bundle.provenance.factsRegistryVersion).toBe(5);
      expect(bundle.before.pieces.every((piece) => /^[a-h][1-8]$/.test(piece.square))).toBe(true);
      expect(bundle.played.move.uci).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
    }
  });

  it('preserves unknown versus false semantics in the contract fixtures', () => {
    // pawn-structure-damage requested no motifs → uncomputed, never an empty list.
    const psd = pawnStructureDamage as TeachingFactBundleV1;
    expect(psd.before.availableMotifs.status).toBe('uncomputed');
    const bundle = allowedFork as TeachingFactBundleV1;
    const opponentPiece = bundle.played.position.pieces.find(
      (piece) => piece.side === bundle.played.position.sideToMove,
    );
    expect(opponentPiece?.see.status).toBe('unavailable');
  });

  it('exposes the validated fork the played move allowed (registry v2)', () => {
    const bundle = allowedFork as TeachingFactBundleV1;
    const motifs = bundle.played.position.availableMotifs;
    expect(motifs.status).toBe('computed');
    if (motifs.status !== 'computed') return;
    const fork = motifs.items.find((m) => m.moveUci === 'g5f3');
    expect(fork?.kind).toBe('fork');
    expect(fork?.kingTarget).toBe(true);
    expect(fork?.targets.map((t) => t.id).sort()).toEqual(['white-king-g1', 'white-rook-e1']);
    expect(bundle.before.opponentAvailableMotifs).toEqual({ status: 'computed', items: [] });
    // the best move's counterfactual avoids it
    expect(bundle.best?.position.availableMotifs.status).toBe('computed');
  });

  it('exposes the validated pin the played move allowed (registry v3)', () => {
    const bundle = allowedPin as TeachingFactBundleV1;
    const pins = bundle.played.position.availablePins;
    expect(pins.status).toBe('computed');
    if (pins.status !== 'computed') return;
    const pin = pins.items.find((p) => p.moveUci === 'c8g4');
    expect(pin?.kind).toBe('absolute');
    expect(pin?.pinned.id).toBe('white-knight-f3');
    expect(pin?.anchor.id).toBe('white-king-d1');
    expect(pin?.pinnedImmobile).toBe(true);
    expect(bundle.before.opponentAvailablePins).toEqual({ status: 'computed', items: [] });
    expect(bundle.best?.position.availablePins.status).toBe('computed');
  });
});
