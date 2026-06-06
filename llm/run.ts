// Node-only commentary runner. Keeps OPENAI_API_KEY in .env/process, not Vite.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeGame, analyzeMoveLive } from '../engine/analyze';
import { UciEngine } from '../engine/evaluation';
import { gamesFromPgn, pliesFromPgn, splitPgnGames } from '../engine/position';
import { createNodeStockfishTransport } from '../engine/stockfish-node';
import { batchNarrate, type PlyInput } from './batch';
import { hasApiKey, loadEnv } from './env';
import { buildGameNarrationMessages, gameFactsBlock, narrateGame } from './game';
import { buildNarrationMessages, factsBlock, narrate } from './narrate';
import { createOpenAIClient } from './openai';

type Mode = 'game' | 'batch' | 'turn';

interface CliArgs {
  mode: Mode;
  pgnPath: string;
  gameIndex: number;
  ply: number;
  dryRun: boolean;
  outPath?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadEnv();
  const pgn = selectPgn(args.pgnPath, args.gameIndex);
  const label = labelFor(args.pgnPath, args.gameIndex, pgn);
  const engine = new UciEngine(await createNodeStockfishTransport());

  try {
    if (args.mode === 'turn') {
      const plies = pliesFromPgn(pgn);
      const target = plies[args.ply - 1];
      if (!target) throw new Error(`No ply ${args.ply}; game has ${plies.length} plies.`);
      const analysis = await analyzeMoveLive(engine, target.fenBefore, target.san, cfg.analysisDepth);
      if (args.dryRun) {
        writeResult(args.outPath, {
          mode: args.mode,
          model: cfg.model,
          ply: target.ply,
          move: analysis.move,
          facts: factsBlock(analysis),
          messages: buildNarrationMessages(analysis),
        });
        return;
      }
      assertApiKey(cfg);
      const client = createOpenAIClient({ apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl });
      writeResult(args.outPath, {
        mode: args.mode,
        model: cfg.model,
        ply: target.ply,
        move: analysis.move,
        narration: await narrate(client, analysis),
      });
      return;
    }

    const analyzed = await analyzeGame(engine, pgn, cfg.analysisDepth, (done, total) =>
      process.stderr.write(`\r  analyzing ${done}/${total}`),
    );
    process.stderr.write('\n');
    const capped = cfg.maxPlies > 0 ? analyzed.slice(0, cfg.maxPlies) : analyzed;
    const items: PlyInput[] = capped.map((p) => ({ ply: p.ply, analysis: p.analysis }));

    if (args.dryRun) {
      const messages =
        args.mode === 'game'
          ? buildGameNarrationMessages({ label, items })
          : items.map((item) => ({ ply: item.ply, messages: buildNarrationMessages(item.analysis) }));
      writeResult(args.outPath, {
        mode: args.mode,
        model: cfg.model,
        label,
        analyzedPlies: items.length,
        facts: args.mode === 'game' ? gameFactsBlock({ label, items }) : undefined,
        messages,
      });
      return;
    }

    assertApiKey(cfg);
    const client = createOpenAIClient({ apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl });
    if (args.mode === 'game') {
      writeResult(args.outPath, {
        mode: args.mode,
        model: cfg.model,
        label,
        analyzedPlies: items.length,
        narration: await narrateGame(client, { label, items }),
      });
      return;
    }

    const plies = await batchNarrate(client, items, cfg.concurrency, (done, total) =>
      process.stderr.write(`\r  narrating ${done}/${total}`),
    );
    process.stderr.write('\n');
    writeResult(args.outPath, { mode: args.mode, model: cfg.model, label, plies });
  } finally {
    engine.dispose();
  }
}

function parseArgs(argv: string[]): CliArgs {
  const read = (name: string, fallback = '') => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] ?? fallback : fallback;
  };
  const has = (name: string) => argv.includes(`--${name}`);
  const mode = (read('mode', 'game') as Mode) || 'game';
  if (!['game', 'batch', 'turn'].includes(mode)) throw new Error('--mode must be game, batch, or turn.');
  return {
    mode,
    pgnPath: read('pgn', join('fixtures', 'sample-game.pgn')),
    gameIndex: Number(read('game', read('game-index', '0'))) || 0,
    ply: Number(read('ply', '1')) || 1,
    dryRun: has('dry-run'),
    outPath: read('out') || undefined,
  };
}

function selectPgn(path: string, gameIndex: number): string {
  const text = readFileSync(path, 'utf8');
  const games = splitPgnGames(text);
  if (!games[gameIndex]) throw new Error(`No game index ${gameIndex}; file has ${games.length} games.`);
  return games[gameIndex];
}

function labelFor(path: string, gameIndex: number, pgn: string): string {
  const game = gamesFromPgn(pgn)[0];
  return game?.label ?? `${path} game ${gameIndex + 1}`;
}

function assertApiKey(cfg: ReturnType<typeof loadEnv>): void {
  if (!hasApiKey(cfg)) throw new Error('OPENAI_API_KEY is missing or still a placeholder. Use --dry-run to inspect prompts.');
}

function writeResult(path: string | undefined, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  if (!path) {
    console.log(json);
    return;
  }
  writeFileSync(path, json);
  console.log(`wrote ${path}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
