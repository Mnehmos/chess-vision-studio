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
import { ponderPicker } from './ponder-picker';
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
    // Opponent-clock ponder cache (gated 2026-06-11): ~89% hit rate, banks
    // ~3/4 of the clock on agreed hits. CVS_PONDER=0 reverts to plain picks.
    picker = process.env.CVS_PONDER !== '0' ? ponderPicker(rustPicker()) : rustPicker();
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
    maxPending: Math.max(1, Number(process.env.CVS_CHALLENGE_PENDING ?? 2)),
    pausedUntil: 0, // any 429 pauses ALL outbound challenges for 5 minutes
    tcIndex: 0, // rotates through CVS_CHALLENGE_TCS
  };
  // Outbound challenges we sent that nobody has answered yet (id -> username).
  // Without this the ladder saw "no active games" and kept stacking challenges —
  // which all got accepted at once (the 7-game pileup).
  const pendingOutbound = new Map<string, string>();
  // Bots that declined us recently (username -> ts): skip them for an hour so
  // odds-only/picky bots don't eat every cooldown cycle.
  const declinedRecently = new Map<string, number>();
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
        .filter((x) => x.rating > 0 && Math.abs(x.rating - ladder.anchor) <= ladder.band)
        .filter((x) => Date.now() - (declinedRecently.get(x.b.username) ?? 0) > 3_600_000);
      if (candidates.length === 0) {
        log('bot-ladder: no online bots in band');
        return;
      }
      const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
      // Rotate time controls: many bots only accept their preferred speed, and
      // each speed is its own Lichess rating pool (bullet/blitz/rapid).
      const tcs = (process.env.CVS_CHALLENGE_TCS ?? '180+2,60+0,300+0,300+3,600+0')
        .split(',')
        .map((s) => s.trim().split('+').map(Number) as [number, number])
        .filter(([l, i]) => Number.isFinite(l) && l >= 60 && Number.isFinite(i) && i >= 0);
      const [limit, inc] = tcs[ladder.tcIndex % tcs.length] ?? [180, 2];
      // Alternate rated/casual: many bots decline rated vs new/provisional
      // accounts but happily play casual — casual keeps games (and harvest
      // data) flowing while the rated pool warms up to us.
      const rated = ladder.tcIndex % 2 === 0;
      ladder.tcIndex += 1;
      try {
        const res = await client.challengeUser(pick.b.username, { rated, clockLimitSec: limit, clockIncrementSec: inc });
        if (res.id) pendingOutbound.set(res.id, pick.b.username);
        log(`bot-ladder: challenged ${pick.b.username} (blitz ${pick.rating}) ${rated ? 'rated' : 'casual'} ${limit / 60}+${inc} -> ${res.id ?? res.status ?? 'sent'}`);
      } catch (e) {
        // 400 = their challenge prefs reject us — same as a decline, remember it.
        if (String(e).includes('400')) declinedRecently.set(pick.b.username, Date.now());
        throw e;
      }
    } catch (e) {
      // Challenge creation is one of Lichess's tightest budgets, and a 429
      // here can carry account-level penalty (post-storm 2026-06-12: two
      // 429s through 5-min pauses). Back off a full 30 minutes — incoming
      // challenges still flow; only outbound hunting pauses.
      if (String(e).includes('429')) ladder.pausedUntil = Date.now() + 1_800_000;
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
  // Minimum quiet period after any 429 — Lichess requires a FULL MINUTE of
  // silence; per-event counter resets let the old loop hammer every 1-2s
  // (observed death-spiral 2026-06-11: stream 429s with a live game stuck).
  let holdUntil = 0;
  for (;;) {
    const connectedAt = Date.now();
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
        } else if (ev.type === 'challengeDeclined' || ev.type === 'challengeCanceled') {
          const chId = (ev as { challenge?: { id?: string } }).challenge?.id;
          if (chId && pendingOutbound.has(chId)) {
            const who = pendingOutbound.get(chId)!;
            pendingOutbound.delete(chId);
            if (ev.type === 'challengeDeclined') declinedRecently.set(who, Date.now());
            log(`outbound challenge ${chId} (${who}) ${ev.type === 'challengeDeclined' ? 'declined — skipping them for 1h' : 'canceled'}`);
          }
        } else if (ev.type === 'gameStart' && ev.game) {
          const gameId = ev.game.gameId ?? ev.game.id ?? ev.game.fullId;
          if (!gameId || active.has(gameId)) continue;
          pendingOutbound.delete(gameId); // an accepted challenge keeps its id as the game id
          active.add(gameId);
          log(`game start ${gameId}`);
          // 12s cap: the budget formula (time/30 + 0.8*inc) governs normal
          // moves; the old 4s cap silently starved us at 5+3 and slower TCs
          // (eubos game RqWLhgpt: ~7-8s/move available, never spent >4).
          void playSession(client, gameId, botId, picker, { maxMoveMs: 12_000 })
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
      if (String(e).includes('429')) {
        ladder.pausedUntil = Date.now() + 300_000;
        holdUntil = Date.now() + 65_000; // full minute of quiet, per Lichess
      }
      log(`event stream error: ${String(e)}; reconnecting`);
    }
    if (opts.maxEventStreamRestarts !== undefined && restarts >= opts.maxEventStreamRestarts) return;
    restarts += 1;
    // Healthy = the stream LIVED a while, not "delivered one event" — the old
    // per-event reset kept backoff at 1-2s forever during 429 storms.
    if (Date.now() - connectedAt >= 30_000) consecutiveFailures = 0;
    consecutiveFailures += 1;
    // Exponential backoff with jitter, capped at 60s. Lichess throttles IPs that
    // hammer it during outages — a fixed 1s retry loop is exactly that pattern.
    const base = opts.reconnectDelayMs ?? 1000;
    const backoff = Math.min(60_000, base * 2 ** Math.min(consecutiveFailures - 1, 6));
    const jittered = backoff + Math.floor(Math.random() * (backoff / 4));
    const wait = Math.max(jittered, holdUntil - Date.now());
    if (consecutiveFailures > 1 || wait > jittered)
      log(`backoff ${Math.round(wait / 1000)}s (failure #${consecutiveFailures})`);
    await sleep(wait);
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
