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
      expect(bundle.provenance.factsRegistryVersion).toBe(1);
      expect(bundle.before.pieces.every((piece) => /^[a-h][1-8]$/.test(piece.square))).toBe(true);
      expect(bundle.played.move.uci).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
    }
  });

  it('preserves unknown versus false semantics in the contract fixtures', () => {
    const bundle = allowedFork as TeachingFactBundleV1;
    expect(bundle.before.availableMotifs.status).toBe('uncomputed');
    const opponentPiece = bundle.played.position.pieces.find(
      (piece) => piece.side === bundle.played.position.sideToMove,
    );
    expect(opponentPiece?.see.status).toBe('unavailable');
  });
});
