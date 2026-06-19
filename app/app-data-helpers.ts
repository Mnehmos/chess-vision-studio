import { extractPlyFeatures, type FeatureEntry } from '../engine/features';
import type { PlyRecord, ParsedGame } from '../engine/position';
import type { MoveAnalysis } from '../engine/types';
import { plyRecordToUci } from '../engine/adapters/uci-line';

export interface CachedFeatureEntry {
  analysis: MoveAnalysis;
  entry: FeatureEntry;
}

export function safePlyUci(ply: PlyRecord | undefined): string | undefined {
  if (!ply) return undefined;
  try {
    return plyRecordToUci(ply);
  } catch {
    return undefined;
  }
}

export function gameCacheKey(game: ParsedGame | undefined): string {
  if (!game) return 'no-game';
  const first = game.plies[0]?.fenBefore ?? game.initialFen ?? '';
  const last = game.plies[game.plies.length - 1]?.fenAfter ?? game.initialFen ?? '';
  return [
    game.headers.White ?? '?',
    game.headers.Black ?? '?',
    game.headers.Result ?? '*',
    game.headers.Date ?? '?',
    game.plies.length,
    first,
    last,
  ].join('|');
}

export function getFeatureEntry(
  cacheRoot: Map<string, Map<number, CachedFeatureEntry>>,
  gameKey: string,
  ply: PlyRecord,
  plyIndex: number,
  analysis: MoveAnalysis,
): FeatureEntry {
  let gameCache = cacheRoot.get(gameKey);
  if (!gameCache) {
    gameCache = new Map();
    cacheRoot.set(gameKey, gameCache);
  }
  const cached = gameCache.get(plyIndex);
  if (cached?.analysis === analysis) return cached.entry;

  const entry: FeatureEntry = {
    ply: ply.ply,
    color: ply.color,
    analysis,
    features: extractPlyFeatures(ply.fenBefore, ply.fenAfter, ply.san, analysis),
  };
  gameCache.set(plyIndex, { analysis, entry });
  return entry;
}
