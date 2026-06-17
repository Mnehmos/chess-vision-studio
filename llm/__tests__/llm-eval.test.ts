// Live LLM eval (gated on OPENAI_API_KEY plus LLM_LIVE_EVAL=1). Analyzes the sample game with
// Stockfish, then narrates EACH ply as a batched, clamped LLM call, and writes
// fixtures/llm-eval-output.json. Run:  npm run llm:eval
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, hasApiKey } from '../env';
import { createOpenAIClient } from '../openai';
import { batchNarrate, type PlyInput } from '../batch';
import { UciEngine } from '../../engine/evaluation';
import { createNodeStockfishTransport } from '../../engine/stockfish-node';
import { analyzeGame } from '../../engine/analyze';

const cfg = loadEnv();
const ENABLED = hasApiKey(cfg) && cfg.liveEval;

describe.skipIf(!ENABLED)('LLM eval (live OpenAI batch)', () => {
  it(
    `analyzes the sample game and narrates each ply via ${cfg.model}`,
    async () => {
      const pgn = readFileSync(join(__dirname, '../../fixtures/sample-game.pgn'), 'utf8');
      const engine = new UciEngine(await createNodeStockfishTransport());
      try {
        let plies = await analyzeGame(engine, pgn, cfg.analysisDepth, (d, t) =>
          process.stdout.write(`\r  analyzing ${d}/${t}`),
        );
        if (cfg.maxPlies > 0) plies = plies.slice(0, cfg.maxPlies);

        const items: PlyInput[] = plies.map((p) => ({ ply: p.ply, analysis: p.analysis }));
        const client = createOpenAIClient({ apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl });
        const narrated = await batchNarrate(client, items, cfg.concurrency, (d, t) =>
          process.stdout.write(`\r  narrating ${d}/${t}`),
        );

        const outPath = join(__dirname, '../../fixtures/llm-eval-output.json');
        writeFileSync(outPath, JSON.stringify({ model: cfg.model, plies: narrated }, null, 2));
        console.log(`\n  wrote ${narrated.length} narrated plies → ${outPath}`);

        expect(narrated.length).toBe(items.length);
        // most plies should produce non-empty narration (allow a few transient errors)
        expect(narrated.filter((r) => r.narration).length).toBeGreaterThan(items.length * 0.8);
      } finally {
        engine.dispose();
      }
    },
    10 * 60 * 1000,
  );
});

describe.skipIf(ENABLED)('LLM eval (disabled)', () => {
  it('is skipped until OPENAI_API_KEY and LLM_LIVE_EVAL=1 are set', () => {
    expect(true).toBe(true);
  });
});
