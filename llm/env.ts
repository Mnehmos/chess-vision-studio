// Minimal .env loader (no dependency). process.env always wins over the file.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATHS = [join(HERE, '..', '.env'), join(HERE, '..', '.env.local')];

export interface LlmConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  analysisDepth: number;
  concurrency: number;
  maxPlies: number; // 0 = whole game
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

export function loadEnv(): LlmConfig {
  const fileVars = ENV_PATHS.reduce<Record<string, string>>((acc, path) => {
    if (!existsSync(path)) return acc;
    return { ...acc, ...parseDotenv(readFileSync(path, 'utf8')) };
  }, {});
  const get = (k: string, d = '') => process.env[k] ?? fileVars[k] ?? d;
  return {
    apiKey: get('OPENAI_API_KEY'),
    model: get('OPENAI_MODEL', 'gpt-5.5'),
    baseUrl: get('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    analysisDepth: Number(get('LLM_ANALYSIS_DEPTH', '14')) || 14,
    concurrency: Number(get('LLM_CONCURRENCY', '4')) || 4,
    maxPlies: Number(get('LLM_MAX_PLIES', '0')) || 0,
  };
}

/** True when a usable API key is configured (not the placeholder). */
export function hasApiKey(cfg: LlmConfig): boolean {
  return !!cfg.apiKey && cfg.apiKey.startsWith('sk-') && !cfg.apiKey.includes('your-key');
}
