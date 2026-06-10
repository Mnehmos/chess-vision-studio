// No-dependency .env loader for the Lichess bot runner (mirrors llm/env.ts).
// The token NEVER leaves the server side: it is read from .env / .env.local or
// the process env, used only for Authorization headers, and never logged.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATHS = [join(HERE, '..', '..', '.env'), join(HERE, '..', '..', '.env.local')];

export interface LichessConfig {
  token: string;
  /** Optional username hint; the runtime /api/account id is authoritative. */
  username: string;
  /** CVS search depth per move. */
  depth: number;
  acceptCasual: boolean;
  acceptRated: boolean;
  /** Only accept/issue challenges to other BOT accounts. */
  botsOnly: boolean;
  /** Decline real-time games whose initial clock is below this (seconds): engines want thinking time. */
  minClockInitialSec: number;
  allowCorrespondence: boolean;
  /** Seed games by challenging Lichess AI (Stockfish levels) at startup. */
  seedAi: boolean;
  seedAiLevels: number[];
  seedAiClockLimitSec: number;
  seedAiClockIncrementSec: number;
  maxConcurrentGames: number;
  /** Run Stockfish review -> OODA dataset on each finished game. */
  review: boolean;
  reviewDepth: number;
  /** Optional trained @cvs/engine policy weights JSON. */
  weightsPath: string;
  outDir: string;
}

function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

export function loadLichessConfig(): LichessConfig {
  const fileVars = ENV_PATHS.reduce<Record<string, string>>((acc, path) => {
    if (!existsSync(path)) return acc;
    return { ...acc, ...parseDotenv(readFileSync(path, 'utf8')) };
  }, {});
  const get = (k: string, d = '') => process.env[k] ?? fileVars[k] ?? d;
  const bool = (k: string, d: boolean) => {
    const v = get(k, d ? '1' : '0').toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  };
  const num = (k: string, d: number) => Number(get(k, String(d))) || d;
  return {
    token: get('LICHESS_BOT_TOKEN'),
    username: get('LICHESS_BOT_USERNAME'),
    depth: num('LICHESS_BOT_DEPTH', 3),
    acceptCasual: bool('LICHESS_ACCEPT_CASUAL', true),
    acceptRated: bool('LICHESS_ACCEPT_RATED', true),
    botsOnly: bool('LICHESS_BOTS_ONLY', false),
    // 60s opens the bullet pool — the engine budgets ~1/30 of remaining clock
    // per move (≥50ms floor), so even 1+0 is comfortably playable.
    minClockInitialSec: num('LICHESS_MIN_CLOCK_SEC', 60),
    allowCorrespondence: bool('LICHESS_ALLOW_CORRESPONDENCE', true),
    seedAi: bool('LICHESS_SEED_AI', false),
    seedAiLevels: get('LICHESS_SEED_AI_LEVELS', '3,5,7')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 8),
    seedAiClockLimitSec: num('LICHESS_SEED_AI_CLOCK_SEC', 300),
    seedAiClockIncrementSec: num('LICHESS_SEED_AI_INC_SEC', 3),
    maxConcurrentGames: num('LICHESS_MAX_GAMES', 1),
    review: bool('LICHESS_REVIEW', false),
    reviewDepth: num('LICHESS_REVIEW_DEPTH', 10),
    weightsPath: get('LICHESS_WEIGHTS', 'arena/out/weights.json'),
    outDir: get('LICHESS_OUT_DIR', 'arena/out'),
  };
}

/** True when a plausibly-real token is configured (not blank / the placeholder). */
export function hasToken(cfg: LichessConfig): boolean {
  return !!cfg.token && cfg.token.length >= 12 && !cfg.token.includes('your-token');
}
