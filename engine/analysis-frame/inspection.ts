/**
 * CvsFeatureInspectionV1 — the combined evaluator + active-feature snapshot for a
 * position (plan §6 PR-12), assembled from the engine's existing `eval` and `cvs`
 * serve commands (no rust change). Active feature NAMES are model inputs, NOT a
 * causal explanation of the evaluation.
 */
import { normalizeEngineScore, rootSideFromFen, type RootSide } from './score';

export interface CvsFeatureInspectionV1 {
  fen: string;
  sideToMove: RootSide;

  classicalWhiteCp: number;
  nnueRawCp: number | null;
  nnueRawPov: 'side_to_move' | null;
  nnueWhiteCp: number | null;

  activeFeatureIds: number[];
  activeFeatureNames: string[];

  registryVersion: number;
  registryHash: string;
  inputDim: number;

  modelKind?: string;
  modelId?: string;
}

/** Raw pieces from the `eval` + `cvs` serve responses. */
export interface FeatureInspectionInput {
  fen: string;
  evalWhiteCp: number;
  nnueStmCp?: number | null; // present only when the engine ran with --nnue
  registryVersion: number;
  registryHash: string;
  inputDim: number;
  activeIds: number[];
  activeNames: string[];
  modelKind?: string;
  modelId?: string;
}

/**
 * Assemble a CvsFeatureInspectionV1, deriving side-to-move and the White-normalized
 * NNUE eval (the NNUE raw value is side-to-move POV). Missing NNUE → nulls (never 0).
 */
export function buildFeatureInspection(input: FeatureInspectionInput): CvsFeatureInspectionV1 {
  const sideToMove = rootSideFromFen(input.fen);
  const nnueRawCp = input.nnueStmCp ?? null;
  const nnueWhiteCp =
    nnueRawCp === null
      ? null
      : normalizeEngineScore({
          rawCp: nnueRawCp,
          rawMate: null,
          rawPov: 'side_to_move',
          rootSide: sideToMove,
        }).whiteCp;
  return {
    fen: input.fen,
    sideToMove,
    classicalWhiteCp: input.evalWhiteCp,
    nnueRawCp,
    nnueRawPov: nnueRawCp === null ? null : 'side_to_move',
    nnueWhiteCp,
    activeFeatureIds: input.activeIds,
    activeFeatureNames: input.activeNames,
    registryVersion: input.registryVersion,
    registryHash: input.registryHash,
    inputDim: input.inputDim,
    modelKind: input.modelKind,
    modelId: input.modelId,
  };
}

export function isCvsFeatureInspectionV1(value: unknown): value is CvsFeatureInspectionV1 {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.fen === 'string' &&
    (v.sideToMove === 'white' || v.sideToMove === 'black') &&
    typeof v.classicalWhiteCp === 'number' &&
    (v.nnueRawCp === null || typeof v.nnueRawCp === 'number') &&
    Array.isArray(v.activeFeatureIds) &&
    Array.isArray(v.activeFeatureNames) &&
    typeof v.registryVersion === 'number' &&
    typeof v.registryHash === 'string' &&
    typeof v.inputDim === 'number'
  );
}
