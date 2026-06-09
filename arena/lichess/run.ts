// The Lichess bot runner: connect, optionally seed games vs Lichess AI, then
// stream incoming events — accept/decline challenges per policy and play each
// game with CvsEngine. Finished games are (optionally) harvested into the OODA
// dataset. Live games are the diversity the deterministic self-play loop lacked.
//
// Run: `npm run lichess:bot` (needs LICHESS_BOT_TOKEN in .env, scope bot:play,
// on an account already upgraded to BOT). See arena/lichess/README.md.
import { existsSync, readFileSync } from 'node:fs';
import { CvsEngine, type PolicyWeights } from '@cvs/engine';
import { LichessClient, type LichessEvent } from './client';
import { loadLichessConfig, hasToken, type LichessConfig } from './env';
import { shouldAccept } from './policy';
import { playSession, cvsPicker } from './session';
import { harvestGame } from './harvest';

export interface RunBotOptions {
  client?: LichessClient;
  picker?: ReturnType<typeof cvsPicker>;
  /** Test hook: undefined means keep reconnecting forever. */
  maxEventStreamRestarts?: number;
  reconnectDelayMs?: number;
}

export async function runBot(
  cfg: LichessConfig = loadLichessConfig(),
  log: (m: string) => void = (m) => console.log(m),
  opts: RunBotOptions = {},
): Promise<void> {
  const client = opts.client ?? new LichessClient({ token: cfg.token });
  const me = await client.account();
  const botId = me.id.toLowerCase();
  log(`Connected as ${me.username}${me.title ? ` (${me.title})` : ''} [id=${botId}]`);
  if (me.title !== 'BOT') {
    log('WARNING: this account is NOT a BOT yet — moves will be rejected. Run the one-off upgrade:');
    log('  curl -d "" https://lichess.org/api/bot/account/upgrade -H "Authorization: Bearer <TOKEN>"');
  }

  const weights = loadWeights(cfg.weightsPath, log);
  const picker = opts.picker ?? cvsPicker(new CvsEngine(weights ? { weights } : undefined), { depth: cfg.depth });
  const active = new Set<string>();

  if (cfg.seedAi) {
    for (const level of cfg.seedAiLevels) {
      try {
        const g = await client.challengeAi({
          level,
          color: 'random',
          clockLimitSec: cfg.seedAiClockLimitSec,
          clockIncrementSec: cfg.seedAiClockIncrementSec,
        });
        log(`seeded vs Lichess AI L${level} -> ${g.id ?? '(pending gameStart)'}`);
      } catch (e) {
        log(`seed L${level} failed: ${String(e)}`);
      }
    }
  }

  log('listening on /api/stream/event …');
  let restarts = 0;
  for (;;) {
    try {
      for await (const ev of client.streamEvents<LichessEvent>()) {
        if (ev.type === 'challenge' && ev.challenge) {
          const ch = ev.challenge;
          if ((ch.challenger?.id ?? '').toLowerCase() === botId) continue; // echo of our own challenge
          const verdict = shouldAccept(ch, cfg);
          if (verdict.accept && active.size < cfg.maxConcurrentGames) {
            const ok = await client.acceptChallenge(ch.id);
            log(`${ok ? 'accepted' : 'accept-failed'} ${ch.id} (${ch.speed ?? '?'}, ${ch.rated ? 'rated' : 'casual'})`);
          } else {
            const reason = verdict.accept ? 'later' : verdict.reason;
            await client.declineChallenge(ch.id, reason);
            log(`declined ${ch.id}: ${reason ?? 'busy'}`);
          }
        } else if (ev.type === 'gameStart' && ev.game) {
          const gameId = ev.game.gameId ?? ev.game.id ?? ev.game.fullId;
          if (!gameId || active.has(gameId)) continue;
          active.add(gameId);
          log(`game start ${gameId}`);
          void playSession(client, gameId, botId, picker, { maxMoveMs: 4000 })
            .then(async (res) => {
              active.delete(gameId);
              log(`game ${gameId} done: ${res.record.result} (${res.record.termination}, ${res.record.plies.length} plies, CVS=${res.cvsColor})`);
              if (cfg.review) {
                try {
                  await harvestGame(res, cfg, log);
                } catch (e) {
                  log(`harvest ${gameId} failed: ${String(e)}`);
                }
              }
            })
            .catch((e) => {
              active.delete(gameId);
              log(`game ${gameId} error: ${String(e)}`);
            });
        }
        // 'gameFinish' needs no handling: the per-game stream ends on its own.
      }
      log('event stream ended; reconnecting');
    } catch (e) {
      log(`event stream error: ${String(e)}; reconnecting`);
    }
    if (opts.maxEventStreamRestarts !== undefined && restarts >= opts.maxEventStreamRestarts) return;
    restarts += 1;
    await sleep(opts.reconnectDelayMs ?? 1000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadWeights(path: string, log: (m: string) => void): PolicyWeights | undefined {
  if (!path || !existsSync(path)) return undefined;
  try {
    const weights = JSON.parse(readFileSync(path, 'utf8')) as PolicyWeights;
    log(`loaded trained weights: ${path}`);
    return weights;
  } catch (e) {
    log(`could not load weights ${path}: ${String(e)}; using default policy`);
    return undefined;
  }
}

// Auto-run as a script, never under Vitest. Refuses to start without a token.
if (!process.env.VITEST) {
  const cfg = loadLichessConfig();
  if (!hasToken(cfg)) {
    console.error('No LICHESS_BOT_TOKEN configured (personal token, scope bot:play). See arena/lichess/README.md.');
    process.exit(1);
  }
  runBot(cfg).catch((e) => {
    console.error('lichess bot failed:', e);
    process.exit(1);
  });
}
