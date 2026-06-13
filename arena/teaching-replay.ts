import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { plyRecordToUci, sanLineToUci } from '../engine/adapters/uci-line';
import { classify, computeCpLoss } from '../engine/classify';
import { uciPvToSan, type UciEngine } from '../engine/evaluation';
import { gamesFromPgn, type ParsedGame } from '../engine/position';
import { buildTeachingRecord, type TeachingRecordV1 } from '../engine/teaching/record';
import type { TeachingFactBundleV1, TeachingFactsRequestV1 } from '../engine/teaching/types';
import type { Eval, MoveAnalysis } from '../engine/types';

interface Options {
  inputs: string[];
  hero: string;
  targetMistakes: number;
  targetGames: number;
  depth: number;
  baseUrl: string;
  out: string;
  cache?: string;
}

const MISTAKE_BAND = new Set(['inaccuracy', 'mistake', 'blunder']);

function parseArgs(argv: string[]): Options {
  const inputs: string[] = [];
  let hero = 'Mnehmos';
  let targetMistakes = 100;
  let targetGames = 100;
  let depth = 10;
  let baseUrl = 'http://localhost:5173';
  let out = 'arena/out/teaching-real-game-records.json';
  let cache = existsSync(resolve('arena/out/sf-eval-cache.jsonl'))
    ? 'arena/out/sf-eval-cache.jsonl'
    : undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) inputs.push(argv[++i]);
    else if (arg === '--hero' && argv[i + 1]) hero = argv[++i];
    else if (arg === '--target' && argv[i + 1]) targetMistakes = Number(argv[++i]);
    else if (arg === '--games' && argv[i + 1]) targetGames = Number(argv[++i]);
    else if (arg === '--depth' && argv[i + 1]) depth = Number(argv[++i]);
    else if (arg === '--base-url' && argv[i + 1]) baseUrl = argv[++i];
    else if (arg === '--out' && argv[i + 1]) out = argv[++i];
    else if (arg === '--cache' && argv[i + 1]) cache = argv[++i];
    else if (arg === '--no-cache') cache = undefined;
    else if (!arg.startsWith('--')) inputs.push(arg);
  }
  return { inputs, hero, targetMistakes, targetGames, depth, baseUrl: baseUrl.replace(/\/$/, ''), out, cache };
}

function loadEvalCache(path: string | undefined): Map<string, Eval> {
  const cache = new Map<string, Eval>();
  if (!path || !existsSync(resolve(path))) return cache;
  for (const line of readFileSync(resolve(path), 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { k?: unknown; e?: unknown };
      if (typeof row.k === 'string' && row.e && typeof row.e === 'object') {
        cache.set(row.k, row.e as Eval);
      }
    } catch {
      // A corrupt cache row is a miss, never a fabricated evaluation.
    }
  }
  return cache;
}

function httpStockfishEngine(
  baseUrl: string,
  defaultDepth: number,
  evalCache: Map<string, Eval>,
  stats: { hits: number; misses: number },
): UciEngine {
  const evaluate = async (request: { fen: string; depth?: number }) => {
    const depth = request.depth ?? defaultDepth;
    const cached = evalCache.get(`${request.fen}@${depth}`);
    if (cached) {
      stats.hits += 1;
      return structuredClone(cached);
    }
    stats.misses += 1;
    const response = await fetch(`${baseUrl}/api/stockfish/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: request.fen, depth }),
    });
    const body = (await response.json()) as {
      scoreCp?: number;
      mate?: number | null;
      depth?: number;
      pv?: string[];
      error?: string;
    };
    if (!response.ok) throw new Error(body.error || `Stockfish HTTP ${response.status}`);
    const pv = uciPvToSan(request.fen, body.pv ?? []);
    return body.mate !== null && body.mate !== undefined
      ? { mate: body.mate, depth: body.depth ?? depth, pv }
      : { cp: body.scoreCp ?? 0, depth: body.depth ?? depth, pv };
  };
  return {
    evaluate,
    evaluateMultiPV: async (request: { fen: string; depth?: number }) => [await evaluate(request)],
    dispose: () => undefined,
  } as unknown as UciEngine;
}

async function requestFacts(
  baseUrl: string,
  request: TeachingFactsRequestV1,
): Promise<TeachingFactBundleV1> {
  const response = await fetch(`${baseUrl}/api/cvs-engine/facts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = (await response.json()) as TeachingFactBundleV1 | { error?: string };
  if (!response.ok) throw new Error('error' in body ? body.error : `Rust facts HTTP ${response.status}`);
  return body as TeachingFactBundleV1;
}

function gameKey(game: ParsedGame): string {
  const first = game.plies[0]?.fenBefore ?? game.initialFen;
  const last = game.plies[game.plies.length - 1]?.fenAfter ?? game.initialFen;
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

function heroColor(game: ParsedGame, hero: string): 'w' | 'b' | null {
  if (game.headers.White?.toLowerCase() === hero.toLowerCase()) return 'w';
  if (game.headers.Black?.toLowerCase() === hero.toLowerCase()) return 'b';
  return null;
}

function pgnGameBlocks(text: string): string[] {
  const starts = [...text.matchAll(/^\[Event /gm)].map((match) => match.index ?? 0);
  if (starts.length === 0) return text.trim() ? [text] : [];
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length));
}

function teachingRequest(
  game: ParsedGame,
  plyIndex: number,
  analysis: MoveAnalysis,
): TeachingFactsRequestV1 | null {
  const ply = game.plies[plyIndex];
  const playedMoveUci = plyRecordToUci(ply);
  const bestLine = sanLineToUci(ply.fenBefore, analysis.evalBefore.pv);
  const refutationLine = sanLineToUci(ply.fenAfter, analysis.evalAfter.pv);
  if (!playedMoveUci) return null;
  if (analysis.evalBefore.pv.length !== bestLine.length) return null;
  if (analysis.evalAfter.pv.length !== refutationLine.length) return null;
  return {
    schemaVersion: 1,
    fenBefore: ply.fenBefore,
    playedMoveUci,
    ...(bestLine[0] ? { bestMoveUci: bestLine[0] } : {}),
    ...(refutationLine[0] ? { refutationUci: refutationLine[0] } : {}),
    ...(bestLine.length ? { principalVariationUci: bestLine } : {}),
    options: { includeMotifOpportunities: true, includeCounterfactual: true },
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.inputs.length === 0) throw new Error('at least one --input PGN is required');
  for (const input of options.inputs) {
    if (!existsSync(resolve(input))) throw new Error(`PGN not found: ${input}`);
  }

  // Parsing a thousand-game library through chess.js is substantial work by itself.
  // Read only enough complete PGN blocks to satisfy this replay plus a malformed/
  // non-hero buffer; additional files are consumed only when the earlier ones do
  // not provide enough candidates.
  const parseBudget = options.targetGames + 20;
  const selectedBlocks: string[] = [];
  for (const input of options.inputs) {
    if (selectedBlocks.length >= parseBudget) break;
    const blocks = pgnGameBlocks(readFileSync(resolve(input), 'utf8'));
    selectedBlocks.push(...blocks.slice(0, parseBudget - selectedBlocks.length));
  }
  const games = gamesFromPgn(selectedBlocks.join('\n\n'));
  const evalCache = loadEvalCache(options.cache);
  const cacheStats = { hits: 0, misses: 0 };
  const engine = httpStockfishEngine(options.baseUrl, options.depth, evalCache, cacheStats);
  const records: TeachingRecordV1[] = [];
  let analyzedHeroPlies = 0;
  let gamesReplayed = 0;
  let conversionFailures = 0;
  let factsFailures = 0;

  try {
    const heroGames = games.flatMap((game, order) => {
      const color = heroColor(game, options.hero);
      return color ? [{ game, color, order }] : [];
    });
    let cursor = 0;
    while (
      cursor < heroGames.length &&
      (gamesReplayed < options.targetGames || records.length < options.targetMistakes)
    ) {
      // Work in deterministic ten-game batches. Two games in flight consume all
      // four Stockfish workers because each ply evaluates before/after in parallel.
      const batch = heroGames.slice(cursor, cursor + 10);
      cursor += batch.length;
      let batchCursor = 0;
      const batchResults: Array<{
        order: number;
        records: TeachingRecordV1[];
        analyzedHeroPlies: number;
        conversionFailures: number;
        factsFailures: number;
      }> = [];
      const worker = async () => {
        while (batchCursor < batch.length) {
          const job = batch[batchCursor++];
          const gameRecords: TeachingRecordV1[] = [];
          let gamePlies = 0;
          let gameConversions = 0;
          let gameFactsFailures = 0;
          for (let index = 0; index < job.game.plies.length; index += 1) {
            const ply = job.game.plies[index];
            if (ply.color !== job.color) continue;
            gamePlies += 1;
            const evalBefore = await engine.evaluate({ fen: ply.fenBefore, depth: options.depth });
            // A delivered mate is always best and has no after-position oracle eval.
            if (ply.san.endsWith('#')) continue;
            const evalAfter = await engine.evaluate({ fen: ply.fenAfter, depth: options.depth });
            if (evalBefore.status === 'unavailable' || evalAfter.status === 'unavailable') continue;
            const cpLoss = computeCpLoss(evalBefore, evalAfter);
            const classification = classify(cpLoss);
            if (!MISTAKE_BAND.has(classification)) continue;
            const analysis: MoveAnalysis = {
              positionBefore: ply.fenBefore,
              positionAfter: ply.fenAfter,
              move: ply.san,
              classification,
              evalBefore,
              evalAfter,
              cpLoss,
              rankedInsights: [],
              topExplanation: '',
            };
            const request = teachingRequest(job.game, index, analysis);
            if (!request) {
              gameConversions += 1;
              continue;
            }
            try {
              const facts = await requestFacts(options.baseUrl, request);
              gameRecords.push(
                buildTeachingRecord({
                  gameKey: gameKey(job.game),
                  ply: ply.ply,
                  san: ply.san,
                  analysis,
                  facts,
                }),
              );
            } catch {
              gameFactsFailures += 1;
            }
          }
          batchResults.push({
            order: job.order,
            records: gameRecords,
            analyzedHeroPlies: gamePlies,
            conversionFailures: gameConversions,
            factsFailures: gameFactsFailures,
          });
        }
      };
      await Promise.all([worker(), worker()]);
      batchResults.sort((a, b) => a.order - b.order);
      for (const result of batchResults) {
        records.push(...result.records);
        analyzedHeroPlies += result.analyzedHeroPlies;
        conversionFailures += result.conversionFailures;
        factsFailures += result.factsFailures;
        gamesReplayed += 1;
      }
      console.log(
        `games ${gamesReplayed}/${options.targetGames}; mistakes ${records.length}/${options.targetMistakes}; hero plies ${analyzedHeroPlies}`,
      );
    }
  } finally {
    engine.dispose();
  }

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceFiles: options.inputs.map((input) => resolve(input)),
    settings: {
      hero: options.hero,
      targetMistakes: options.targetMistakes,
      targetGames: options.targetGames,
      stockfishDepth: options.depth,
      evalCache: options.cache ? resolve(options.cache) : null,
    },
    diagnostics: {
      gamesParsed: games.length,
      gamesReplayed,
      analyzedHeroPlies,
      conversionFailures,
      factsFailures,
      cacheHits: cacheStats.hits,
      cacheMisses: cacheStats.misses,
    },
    records,
  };
  const outPath = resolve(options.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`records: ${records.length}`);
  console.log(`output: ${outPath}`);
  if (records.length < options.targetMistakes || gamesReplayed < options.targetGames) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`teaching replay failed: ${String((error as Error)?.message ?? error)}`);
  process.exit(1);
});
