import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFeatureInspection, isCvsFeatureInspectionV1 } from '../inspection';

const FEN_W = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FEN_B = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';

describe('buildFeatureInspection (PR-12)', () => {
  it('White to move: NNUE white-normalized equals raw', () => {
    const insp = buildFeatureInspection({
      fen: FEN_W,
      evalWhiteCp: 12,
      nnueStmCp: 30,
      registryVersion: 1,
      registryHash: 'abcd',
      inputDim: 168,
      activeIds: [],
      activeNames: [],
    });
    expect(insp.sideToMove).toBe('white');
    expect(insp.nnueRawCp).toBe(30);
    expect(insp.nnueRawPov).toBe('side_to_move');
    expect(insp.nnueWhiteCp).toBe(30);
    expect(insp.classicalWhiteCp).toBe(12);
  });

  it('Black to move: NNUE white-normalized negates raw', () => {
    const insp = buildFeatureInspection({
      fen: FEN_B,
      evalWhiteCp: 12,
      nnueStmCp: 30,
      registryVersion: 1,
      registryHash: 'abcd',
      inputDim: 168,
      activeIds: [],
      activeNames: [],
    });
    expect(insp.sideToMove).toBe('black');
    expect(insp.nnueWhiteCp).toBe(-30);
  });

  it('missing NNUE → nulls, not zero', () => {
    const insp = buildFeatureInspection({
      fen: FEN_W,
      evalWhiteCp: 12,
      registryVersion: 1,
      registryHash: 'abcd',
      inputDim: 168,
      activeIds: [],
      activeNames: [],
    });
    expect(insp.nnueRawCp).toBeNull();
    expect(insp.nnueRawPov).toBeNull();
    expect(insp.nnueWhiteCp).toBeNull();
  });

  it('assembles a valid inspection from the cvs-features golden fixture', () => {
    const cvs = JSON.parse(
      readFileSync(new URL('../../../fixtures/cvs-engine/cvs-features-v1.json', import.meta.url), 'utf8'),
    ) as {
      fen: string;
      registryVersion: number;
      registryHash: string;
      inputDim: number;
      activeIds: number[];
      activeNames: string[];
    };
    const insp = buildFeatureInspection({
      fen: cvs.fen,
      evalWhiteCp: 5,
      registryVersion: cvs.registryVersion,
      registryHash: cvs.registryHash,
      inputDim: cvs.inputDim,
      activeIds: cvs.activeIds,
      activeNames: cvs.activeNames,
    });
    expect(isCvsFeatureInspectionV1(insp)).toBe(true);
    expect(insp.activeFeatureIds.length).toBe(cvs.activeIds.length);
    expect(insp.activeFeatureNames.length).toBe(cvs.activeNames.length);
    expect(insp.inputDim).toBe(168);
  });

  it('guard rejects malformed inspections', () => {
    expect(isCvsFeatureInspectionV1(null)).toBe(false);
    expect(isCvsFeatureInspectionV1({ fen: 'x' })).toBe(false);
  });
});
