// The Lichess bot runner: connect, optionally seed games vs Lichess AI, then
// stream incoming events — accept/decline challenges per policy and play each
// game with the ACTIVE engine backend (Rust by default; CVS_ENGINE_BACKEND=ts
// selects the frozen legacy reference). Finished games are (optionally)
// harvested into the OODA dataset.
//
// Run: `npm run lichess:bot` (needs LICHESS_BOT_TOKEN in .env, scope bot:play,
// on an account already upgraded to BOT). See arena/lichess/README.md.
import { existsSync, readFileSync } from 'node:fs';
import { CvsEngine, type PolicyWeights } from '@cvs/engine';
import { resolveBackendKind } from '../engine-backend';
import { rustPicker } from './rust-picker';
import { LichessClient, type LichessEvent } from './client';
import { loadLichessConfig, hasToken, type LichessConfig } from './env';
import { shouldAccept } from './policy';
import { playSession, cvsPicker, type MovePicker } from './session';
import { harvestGame } from './harvest';

export interface RunBotOptions {
  client?: LichessClient;
  picker?: MovePicker;
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

  // Engine backend: Rust is the active default (R5); CVS_ENGINE_BACKEND=ts
  // selects the frozen legacy reference for comparison runs.
  const backendKind = resolveBackendKind();
  let picker: MovePicker;
  if (opts.picker) {
    picker = opts.picker;
  } else if (backendKind === 'rust') {
    picker = rustPicker();
  } else {
    const weights = loadWeights(cfg.weightsPath, log);
    picker = cvsPicker(new CvsEngine(weights ? { weights } : undefined), { depth: cfg.depth });
  }
  log(`engine backend: ${backendKind} (picker ${picker.name})`);
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

  // Bot-ladder mode: when idle, challenge an online bot for a RATED game — this
  // is what builds the public Lichess rating. Paced (cooldown + only-when-idle)
  // to stay well inside Lichess rate limits. Disable with CVS_CHALLENGE_BOTS=0.
  const ladder = {
    enabled: process.env.CVS_CHALLENGE_BOTS !== '0',
    band: Number(process.env.CVS_CHALLENGE_BAND ?? 600),
    anchor: Number(process.env.CVS_CHALLENGE_ANCHOR ?? 2000), // target rating center until we have our own
    cooldownMs: Number(process.env.CVS_CHALLENGE_COOLDOWN_MS ?? 90_000), // pace between attempts; the pending/active caps + 429 pause are the real guardrails
    lastAttempt: 0,
    maxPending: 1,
    pausedUntil: 0, // any 429 pauses ALL outbound challenges for 5 minutes
  };
  // Outbound challenges we sent that nobody has answered yet. Without this the
  // ladder saw "no active games" and kept stacking challenges — which all got
  // accepted at once (the 7-game pileup).
  const pendingOutbound = new Set<string>();
  const maybeChallengeBot = async (): Promise<void> => {
    if (!ladder.enabled || active.size >= cfg.maxConcurrentGames) return;
    if (pendingOutbound.size >= ladder.maxPending) return;
    if (Date.now() < ladder.pausedUntil) return;
    if (Date.now() - ladder.lastAttempt < ladder.cooldownMs) return;
    ladder.lastAttempt = Date.now();
    try {
      const bots = await client.onlineBots(50);
      const candidates = bots
        .filter((b) => b.id.toLowerCase() !== botId)
        .map((b) => ({ b, rating: b.perfs?.blitz?.rating ?? b.perfs?.rapid?.rating ?? 0 }))
        .filter((x) => x.rating > 0 && Math.abs(x.rating - ladder.anchor) <= ladder.band);
      if (candidates.length === 0) {
        log('bot-ladder: no online bots in band');
        return;
      }
      const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
      const res = await client.challengeUser(pick.b.username, { rated: true, clockLimitSec: 180, clockIncrementSec: 2 });
      if (res.id) pendingOutbound.add(res.id);
      log(`bot-ladder: challenged ${pick.b.username} (blitz ${pick.rating}) rated 3+2 -> ${res.id ?? res.status ?? 'sent'}`);
    } catch (e) {
      if (String(e).includes('429')) ladder.pausedUntil = Date.now() + 300_000;
      log(`bot-ladder challenge failed: ${String(e)}`);
    }
  };
  void maybeChallengeBot();
  // Retry tick: a never-accepted challenge used to strand the ladder (it only
  // re-fired on game end). Tick once a minute; the caps above make it a no-op
  // unless we are genuinely idle with nothing pending.
  const ladderTick = setInterval(() => void maybeChallengeBot(), 60_000);
  ladderTick.unref?.();

  log('listening on /api/stream/event …');
  let restarts = 0;
  let consecutiveFailures = 0;
  for (;;) {
    try {
      for await (const ev of client.streamEvents<LichessEvent>()) {
        consecutiveFailures = 0; // any event proves the connection is healthy
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
        } else if (ev.type === 'challengeDeclined' || ev.type === 'challengeCanceled') {
          const chId = (ev as { challenge?: { id?: string } }).challenge?.id;
          if (chId && pendingOutbound.delete(chId)) log(`outbound challenge ${chId} ${ev.type === 'challengeDeclined' ? 'declined' : 'canceled'}`);
        } else if (ev.type === 'gameStart' && ev.game) {
          const gameId = ev.game.gameId ?? ev.game.id ?? ev.game.fullId;
          if (!gameId || active.has(gameId)) continue;
          pendingOutbound.delete(gameId); // an accepted challenge keeps its id as the game id
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
              void maybeChallengeBot(); // back on the ladder once idle
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
      if (String(e).includes('429')) ladder.pausedUntil = Date.now() + 300_000;
      log(`event stream error: ${String(e)}; reconnecting`);
    }
    if (opts.maxEventStreamRestarts !== undefined && restarts >= opts.maxEventStreamRestarts) return;
    restarts += 1;
    consecutiveFailures += 1;
    // Exponential backoff with jitter, capped at 60s. Lichess throttles IPs that
    // hammer it during outages — a fixed 1s retry loop is exactly that pattern.
    const base = opts.reconnectDelayMs ?? 1000;
    const backoff = Math.min(60_000, base * 2 ** Math.min(consecutiveFailures - 1, 6));
    const jittered = backoff + Math.floor(Math.random() * (backoff / 4));
    if (consecutiveFailures > 1) log(`backoff ${Math.round(jittered / 1000)}s (failure #${consecutiveFailures})`);
    await sleep(jittered);
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
