import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TeachingFactBundleV1 } from '../../teaching/types';
import {
  artifactValueOrNull,
  computed,
  errored,
  idle,
  isComputed,
  pending,
  unavailable,
} from '../artifact';
import {
  type AnalysisIdentityV2,
  buildHistoryHash,
  describeIdentityMismatch,
  sameAnalysisIdentity,
} from '../identity';
import {
  artifactMatchesFrame,
  assertArtifactMatchesFrame,
  buildAnalysisFrameV2,
  deserializeAnalysisFrame,
  serializeAnalysisFrame,
} from '../frame';
import { legalPositionKey, matchPositionFacts } from '../match';

// White to move; after the played move it is Black to move. Distinct full FENs so
// every identity-significant field can be varied independently.
const FEN_W = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FEN_AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

function baseIdentity(over: Partial<AnalysisIdentityV2> = {}): AnalysisIdentityV2 {
  const historyUci = over.historyUci ?? [];
  return {
    schemaVersion: 2,
    gameKey: 'game-A',
    ply: 1,
    initialFen: FEN_W,
    historyUci,
    historyHash: buildHistoryHash(historyUci),
    fenBefore: FEN_W,
    playedMoveUci: 'e2e4',
    fenAfter: FEN_AFTER_E4,
    branch: { role: 'played', source: 'game' },
    ...over,
    // keep historyHash consistent with historyUci unless explicitly overridden
    ...(over.historyHash ? { historyHash: over.historyHash } : {}),
  };
}

describe('buildHistoryHash', () => {
  it('is deterministic for the same input', () => {
    expect(buildHistoryHash(['e2e4', 'e7e5'])).toBe(buildHistoryHash(['e2e4', 'e7e5']));
  });
  it('differs for different histories', () => {
    expect(buildHistoryHash(['e2e4', 'e7e5'])).not.toBe(buildHistoryHash(['d2d4', 'd7d5']));
  });
  it('is length-sensitive (a prefix differs from the full line)', () => {
    expect(buildHistoryHash(['e2e4'])).not.toBe(buildHistoryHash(['e2e4', 'e7e5']));
  });
  it('returns 8 hex digits', () => {
    expect(buildHistoryHash(['e2e4'])).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('sameAnalysisIdentity — the required identity matrix (plan §6 PR-01)', () => {
  it('same placement, different side to move: NOT equal', () => {
    const a = baseIdentity({ fenBefore: 'k7/8/8/8/8/8/8/K7 w - - 0 1' });
    const b = baseIdentity({ fenBefore: 'k7/8/8/8/8/8/8/K7 b - - 0 1' });
    expect(sameAnalysisIdentity(a, b)).toBe(false);
  });

  it('same placement and side, different castling rights: NOT equal', () => {
    const a = baseIdentity({ fenBefore: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' });
    const b = baseIdentity({ fenBefore: 'r3k2r/8/8/8/8/8/8/R3K2R w Kkq - 0 1' });
    expect(sameAnalysisIdentity(a, b)).toBe(false);
  });

  it('same full FEN, different repetition history: NOT equal', () => {
    const a = baseIdentity({ historyUci: ['g1f3', 'g8f6', 'f3g1', 'f6g8'] });
    const b = baseIdentity({ historyUci: ['b1c3', 'b8c6', 'c3b1', 'c6b8'] });
    expect(a.fenBefore).toBe(b.fenBefore); // identical board
    expect(sameAnalysisIdentity(a, b)).toBe(false); // but different history
  });

  it('same root, different reviewed move: NOT equal', () => {
    const a = baseIdentity({ playedMoveUci: 'e2e4' });
    const b = baseIdentity({ playedMoveUci: 'd2d4' });
    expect(sameAnalysisIdentity(a, b)).toBe(false);
  });

  it('same branch move, different source engine: NOT equal', () => {
    const a = baseIdentity({ branch: { role: 'best', source: 'stockfish' } });
    const b = baseIdentity({ branch: { role: 'best', source: 'cvs' } });
    expect(sameAnalysisIdentity(a, b)).toBe(false);
  });

  it('exactly matching identity: equal', () => {
    expect(sameAnalysisIdentity(baseIdentity(), baseIdentity())).toBe(true);
  });
});

describe('frame identity guard — late responses fail closed', () => {
  const frame = buildAnalysisFrameV2(baseIdentity({ ply: 5 }), { createdAt: '2026-01-01T00:00:00Z' });

  it('late facts response after undo is rejected (different ply/position)', () => {
    const stale = baseIdentity({ ply: 4, fenBefore: FEN_AFTER_E4 });
    expect(artifactMatchesFrame(frame, stale)).toBe(false);
    expect(() => assertArtifactMatchesFrame(frame, stale)).toThrow(/stale artifact/);
  });

  it('late facts response after game switch is rejected (different gameKey)', () => {
    const stale = baseIdentity({ ply: 5, gameKey: 'game-B' });
    expect(artifactMatchesFrame(frame, stale)).toBe(false);
    expect(() => assertArtifactMatchesFrame(frame, stale)).toThrow(/stale artifact/);
  });

  it('a matching artifact is accepted', () => {
    expect(artifactMatchesFrame(frame, baseIdentity({ ply: 5 }))).toBe(true);
    expect(() => assertArtifactMatchesFrame(frame, baseIdentity({ ply: 5 }))).not.toThrow();
  });

  it('describeIdentityMismatch names the differing field', () => {
    expect(describeIdentityMismatch(baseIdentity(), baseIdentity())).toBeNull();
    expect(describeIdentityMismatch(baseIdentity({ gameKey: 'x' }), baseIdentity())).toContain(
      'gameKey',
    );
  });
});

describe('ArtifactState', () => {
  it('keeps absence states distinct', () => {
    expect(idle().status).toBe('idle');
    expect(pending('t').status).toBe('pending');
    expect(unavailable('r').status).toBe('unavailable');
    expect(errored('m').status).toBe('error');
    const c = computed(42, 't');
    expect(isComputed(c)).toBe(true);
    expect(artifactValueOrNull(c)).toBe(42);
    expect(artifactValueOrNull(idle())).toBeNull();
  });
});

describe('frame serialization', () => {
  it('is deterministic and key-order independent', () => {
    const id = baseIdentity();
    const a = buildAnalysisFrameV2(id, {
      createdAt: '2026-01-01T00:00:00Z',
      facts: pending('2026-01-01T00:00:00Z'),
      validators: ['see', 'attack_map'],
    });
    const b = buildAnalysisFrameV2(id, {
      validators: ['see', 'attack_map'],
      facts: pending('2026-01-01T00:00:00Z'),
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(serializeAnalysisFrame(a)).toBe(serializeAnalysisFrame(b));
  });

  it('round-trips through deserialize', () => {
    const frame = buildAnalysisFrameV2(baseIdentity(), { createdAt: '2026-01-01T00:00:00Z' });
    const restored = deserializeAnalysisFrame(serializeAnalysisFrame(frame));
    expect(restored.identity).toEqual(frame.identity);
    expect(restored.schemaVersion).toBe(2);
    expect(restored.provenance.frameBuilderVersion).toBe(1);
  });
});

describe('matchPositionFacts (replaces piece-placement-only matching)', () => {
  const facts = JSON.parse(
    readFileSync(new URL('../../../fixtures/cvs-engine/facts-v1.json', import.meta.url), 'utf8'),
  ) as TeachingFactBundleV1;

  it('matches the played branch by full position key', () => {
    const m = matchPositionFacts(facts, facts.played.fenAfter);
    expect(m?.role).toBe('played');
    expect(m?.position).toBe(facts.played.position);
  });

  it('matches the pre-move position', () => {
    const m = matchPositionFacts(facts, facts.fenBefore);
    expect(m?.role).toBe('before');
    expect(m?.position).toBe(facts.before);
  });

  it('fails closed on a non-matching position', () => {
    expect(matchPositionFacts(facts, '8/8/8/8/8/8/8/K6k w - - 0 1')).toBeNull();
  });

  it('legalPositionKey ignores halfmove/fullmove clocks', () => {
    const withClocks = facts.played.fenAfter.replace(/\s+\d+\s+\d+$/, ' 9 42');
    expect(legalPositionKey(withClocks)).toBe(legalPositionKey(facts.played.fenAfter));
    expect(matchPositionFacts(facts, withClocks)?.role).toBe('played');
  });
});
