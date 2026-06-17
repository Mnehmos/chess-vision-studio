import { describe, expect, it } from 'vitest';
import { buildTeachingNodes, type TeachingRequest, type VerificationPolicy } from '../node';
import type { TeachingFactBundleV1 } from '../types';

const defaultPolicy: VerificationPolicy = {
  tacticalClaims: 'required',
  counterfactualClaims: 'required',
  betterMoveClaims: 'required',
  structuralClaims: 'deterministic-or-engine',
  minimumDepth: 14,
  timeoutMs: 1000,
};

// Mock facts for the dxc4 allowed Qa4+ Queen Fork case
const mockFacts: TeachingFactBundleV1 = {
  schemaVersion: 1,
  fenBefore: 'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq - 0 2',
  before: {
    sideToMove: 'black',
    pieces: [
      { id: 'black-king-e8', side: 'black', pieceType: 'king', square: 'e8', attackers: [], defenders: [], attackerCount: 0, defenderCount: 0, attacked: false, loose: false, see: { status: 'unavailable', reason: '' }, onlyDefenderOf: [] },
      { id: 'black-pawn-a7', side: 'black', pieceType: 'pawn', square: 'a7', attackers: [], defenders: [], attackerCount: 0, defenderCount: 0, attacked: false, loose: false, see: { status: 'unavailable', reason: '' }, onlyDefenderOf: [] },
      { id: 'black-pawn-d5', side: 'black', pieceType: 'pawn', square: 'd5', attackers: [], defenders: [], attackerCount: 0, defenderCount: 0, attacked: false, loose: false, see: { status: 'unavailable', reason: '' }, onlyDefenderOf: [] },
    ],
    pawnStructure: { doubled: [], isolated: [], passed: [], islands: [], backward: { status: 'computed', items: [] }, connectedPassed: { status: 'computed', items: [] }, openFiles: { status: 'computed', items: [] }, semiOpenFiles: { status: 'computed', items: [] }, kingShieldMissing: { status: 'computed', items: [] }, pawnChains: { status: 'computed', items: [] } },
    kingSafety: { status: 'computed', items: [] },
    availableCaptures: { status: 'computed', items: [] },
    opponentAvailableCaptures: { status: 'computed', items: [] },
    availableMotifs: { status: 'computed', items: [] },
    availablePins: { status: 'computed', items: [] },
    opponentAvailableMotifs: { status: 'computed', items: [] }, // Qa4+ is NOT available before dxc4
    opponentAvailablePins: { status: 'computed', items: [] },
    hazards: { status: 'computed', items: [] },
  },
  played: {
    move: { uci: 'd5c4', from: 'd5', to: 'c4' },
    fenAfter: 'rnbqkbnr/ppp1pppp/8/8/2pP4/8/PP2PPPP/RNBQKBNR w KQkq - 0 3',
    position: {
      sideToMove: 'white',
      pieces: [
        { id: 'black-king-e8', side: 'black', pieceType: 'king', square: 'e8', attackers: [], defenders: [], attackerCount: 0, defenderCount: 0, attacked: false, loose: false, see: { status: 'unavailable', reason: '' }, onlyDefenderOf: [] },
        { id: 'black-pawn-a7', side: 'black', pieceType: 'pawn', square: 'a7', attackers: [], defenders: [], attackerCount: 0, defenderCount: 0, attacked: false, loose: false, see: { status: 'unavailable', reason: '' }, onlyDefenderOf: [] },
        { id: 'black-pawn-c4', side: 'black', pieceType: 'pawn', square: 'c4', attackers: [], defenders: [], attackerCount: 0, defenderCount: 0, attacked: false, loose: false, see: { status: 'unavailable', reason: '' }, onlyDefenderOf: [] },
      ],
      pawnStructure: { doubled: [], isolated: [], passed: [], islands: [], backward: { status: 'computed', items: [] }, connectedPassed: { status: 'computed', items: [] }, openFiles: { status: 'computed', items: [] }, semiOpenFiles: { status: 'computed', items: [] }, kingShieldMissing: { status: 'computed', items: [] }, pawnChains: { status: 'computed', items: [] } },
      kingSafety: { status: 'computed', items: [] },
      availableCaptures: { status: 'computed', items: [] },
      opponentAvailableCaptures: { status: 'computed', items: [] },
      availableMotifs: {
        status: 'computed',
        items: [
          {
            kind: 'fork',
            validator: 'fork_validation',
            moveUci: 'd1a4',
            forkingPiece: { id: 'white-queen-d1', side: 'white', pieceType: 'queen', square: 'a4' },
            targets: [
              { id: 'black-king-e8', side: 'black', pieceType: 'king', square: 'e8' },
              { id: 'black-pawn-a7', side: 'black', pieceType: 'pawn', square: 'a7' },
              { id: 'black-pawn-c4', side: 'black', pieceType: 'pawn', square: 'c4' },
            ],
            givesCheck: true,
            kingTarget: true,
            materialGain: 0, // doesn't win material
          },
        ],
      },
      availablePins: { status: 'computed', items: [] },
      opponentAvailableMotifs: { status: 'computed', items: [] },
      opponentAvailablePins: { status: 'computed', items: [] },
      hazards: { status: 'computed', items: [] },
    },
    deltas: { createdHazards: { status: 'computed', items: [] }, removedHazards: { status: 'computed', items: [] }, worsenedHazards: { status: 'computed', items: [] }, createdStructures: { status: 'computed', items: [] }, removedStructures: { status: 'computed', items: [] } },
  },
  best: {
    move: { uci: 'e7e6', from: 'e7', to: 'e6' },
    fenAfter: 'rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq - 0 3',
    position: {
      sideToMove: 'white',
      pieces: [],
      pawnStructure: { doubled: [], isolated: [], passed: [], islands: [], backward: { status: 'computed', items: [] }, connectedPassed: { status: 'computed', items: [] }, openFiles: { status: 'computed', items: [] }, semiOpenFiles: { status: 'computed', items: [] }, kingShieldMissing: { status: 'computed', items: [] }, pawnChains: { status: 'computed', items: [] } },
      kingSafety: { status: 'computed', items: [] },
      availableCaptures: { status: 'computed', items: [] },
      opponentAvailableCaptures: { status: 'computed', items: [] },
      availableMotifs: { status: 'computed', items: [] }, // no fork available
      availablePins: { status: 'computed', items: [] },
      opponentAvailableMotifs: { status: 'computed', items: [] },
      opponentAvailablePins: { status: 'computed', items: [] },
      hazards: { status: 'computed', items: [] },
    },
    deltas: { createdHazards: { status: 'computed', items: [] }, removedHazards: { status: 'computed', items: [] }, worsenedHazards: { status: 'computed', items: [] }, createdStructures: { status: 'computed', items: [] }, removedStructures: { status: 'computed', items: [] } },
  },
  refutation: {
    move: { uci: 'd1a4', from: 'd1', to: 'a4' },
    fenAfter: 'rnbqkbnr/ppp1pppp/8/8/Q1pP4/8/PP2PPPP/RNB1KBNR b KQkq - 1 3',
    position: {
      sideToMove: 'black',
      pieces: [],
      pawnStructure: { doubled: [], isolated: [], passed: [], islands: [], backward: { status: 'computed', items: [] }, connectedPassed: { status: 'computed', items: [] }, openFiles: { status: 'computed', items: [] }, semiOpenFiles: { status: 'computed', items: [] }, kingShieldMissing: { status: 'computed', items: [] }, pawnChains: { status: 'computed', items: [] } },
      kingSafety: { status: 'computed', items: [] },
      availableCaptures: { status: 'computed', items: [] },
      opponentAvailableCaptures: { status: 'computed', items: [] },
      availableMotifs: { status: 'computed', items: [] },
      availablePins: { status: 'computed', items: [] },
      opponentAvailableMotifs: { status: 'computed', items: [] },
      opponentAvailablePins: { status: 'computed', items: [] },
      hazards: { status: 'computed', items: [] },
    },
    deltas: { createdHazards: { status: 'computed', items: [] }, removedHazards: { status: 'computed', items: [] }, worsenedHazards: { status: 'computed', items: [] }, createdStructures: { status: 'computed', items: [] }, removedStructures: { status: 'computed', items: [] } },
  },
  provenance: { engine: 'cvs', factsRegistryVersion: 5, validators: [] },
  errors: [],
};

describe('Canonical Teaching Nodes Builder', () => {
  it('correctly constructs unverified nodes and allows engine verification', async () => {
    const request: TeachingRequest = {
      rootFen: mockFacts.fenBefore,
      subjectMove: 'd5c4',
      resultingFen: mockFacts.played.fenAfter,
      principalVariation: ['e7e6'],
      verificationPolicy: defaultPolicy,
      facts: mockFacts,
    };

    // 1. Propose and compile without engine (status is unverified / confirmed by refutation fallback depending on design)
    const nodes = await buildTeachingNodes(request);
    expect(nodes.length).toBe(1);
    expect(nodes[0].conceptCode).toBe('queen_multi_attack');
    expect(nodes[0].claimStatus).toBe('confirmed'); // falls back to confirmed by refutation match

    // 2. Propose with mock engine returning negative score (refuted)
    const refutedRequest: TeachingRequest = {
      ...request,
      engine: {
        evaluate: async () => ({ cp: 40 }), // +40 from victim perspective, so -40 for attacker (refuted)
      },
    };

    const verifiedNodes = await buildTeachingNodes(refutedRequest);
    expect(verifiedNodes.length).toBe(1);
    const node = verifiedNodes[0];
    expect(node.conceptCode).toBe('queen_multi_attack');
    expect(node.claimStatus).toBe('refuted');
    expect(node.title).toBe('Apparent Queen Fork');
    expect(node.summary).toBe(
      'dxc4 permitted Qa4+, creating a multi-attack on the king on e8, the pawn on a7, and the pawn on c4. After best defense, the sequence does not win material.'
    );
    expect(node.betterMove).toBe('e6');
    expect(node.betterExplanation).toBe('e6 prevents Qa4+ and avoids the pressure.');
    expect(node.verification.status).toBe('refuted');
    expect(node.verification.conclusionCode).toBe('does_not_win_material');
  });
});
