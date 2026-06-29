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
import { RustBackend, rustBackendExtraArgs } from '../engine-backend/rust-backend';
import { ponderPicker } from './ponder-picker';
import { rustPicker } from './rust-picker';
import { LichessClient, type LichessEvent } from './client';
import { loadLichessConfig, hasToken, type LichessConfig } from './env';
import { shouldAccept } from './policy';
import { playSession, cvsPicker, type MovePicker } from './session';
import { nextBookLine } from './book';
import { harvestGame } from './harvest';

export interface RunBotOptions {
  client?: LichessClient;
  picker?: MovePicker;
  harvest?: typeof harvestGame;
  /** Test hook: undefined means keep reconnecting forever. */
  maxEventStreamRestarts?: number;
  reconnectDelayMs?: number;
}

export function lichessRustExtraArgs(
  env: NodeJS.ProcessEnv = process.env,
  overrides: { threads?: number; cvsHelpers?: number } = {},
): string[] {
  const helper = env.CVS_LICHESS_RUST_HELPER_NNUE?.trim() ?? '';
  // Per-call overrides take precedence over the env knobs so the bot can give its
  // main engine the cores + specialist lanes while the ponder engine stays light.
  const threads = overrides.threads !== undefined ? String(overrides.threads) : (env.CVS_LICHESS_RUST_THREADS?.trim() ?? '');
  const helpers = overrides.cvsHelpers !== undefined ? String(overrides.cvsHelpers) : (env.CVS_LICHESS_RUST_CVS_HELPERS?.trim() ?? '');
  const smarttime = env.CVS_LICHESS_RUST_SMARTTIME?.trim() ?? '';
  // --smarttime is live-bot opt-in through CVS_LICHESS_RUST_SMARTTIME=1:
  // session.ts passes the non-smart base budget (clock/30 + 0.8·inc) and the
  // engine's smarttime go-path owns adaptivity (soft ~clock/25, hard ~clock/6).
  // The bridge request timeout (rust-engine.ts) is sized to clear smarttime's
  // hard cap so a legitimately-thinking engine is never killed.
  return rustBackendExtraArgs({
    ...env,
    CVS_RUST_HELPER_NNUE: helper,
    CVS_RUST_THREADS: threads,
    CVS_RUST_CVS_HELPERS: helpers,
    CVS_RUST_SMARTTIME: smarttime,
  });
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
    log(
      'WARNING: this account is NOT a BOT yet — moves will be rejected. Run the one-off upgrade:',
    );
    log(
      '  curl -d "" https://lichess.org/api/bot/account/upgrade -H "Authorization: Bearer <TOKEN>"',
    );
  }

  // Engine backend: Rust is the active default (R5); CVS_ENGINE_BACKEND=ts
  // selects the frozen legacy reference for comparison runs.
  const backendKind = resolveBackendKind();
  let picker: MovePicker;
  if (opts.picker) {
    picker = opts.picker;
  } else if (backendKind === 'rust') {
    const helper = process.env.CVS_LICHESS_RUST_HELPER_NNUE?.trim();
    // Multithreaded specialist search, CPU-budgeted. The MAIN engine gets the cores
    // + the KingSafety/See/Tactics specialist lanes; the opponent-clock PONDER engine
    // stays light (it speculates during the opponent's turn — it shouldn't claim the
    // box). Env overrides: CVS_LICHESS_THREADS / _PONDER_THREADS / _CVS_HELPERS.
    const mainThreads = Number(process.env.CVS_LICHESS_THREADS ?? process.env.CVS_LICHESS_RUST_THREADS ?? 4);
    const ponderThreads = Number(process.env.CVS_LICHESS_PONDER_THREADS ?? 2);
    const cvsHelpers = Number(process.env.CVS_LICHESS_CVS_HELPERS ?? process.env.CVS_LICHESS_RUST_CVS_HELPERS ?? 2);
    const mainArgs = lichessRustExtraArgs(process.env, { threads: mainThreads, cvsHelpers });
    const ponderArgs = lichessRustExtraArgs(process.env, { threads: ponderThreads, cvsHelpers: 0 });
    const base = rustPicker({ backend: new RustBackend({ extraArgs: mainArgs }) });
    // Opponent-clock ponder cache (gated 2026-06-11): ~89% hit rate, banks
    // ~3/4 of the clock on agreed hits. CVS_PONDER=0 reverts to plain picks.
    picker = process.env.CVS_PONDER !== '0' ? ponderPicker(base, { backend: new RustBackend({ extraArgs: ponderArgs }) }) : base;
    log(helper ? `live Rust helper: ${helper}` : 'live Rust helper: disabled (raw play policy)');
    log(`SMP: main ${mainThreads}t (${cvsHelpers} specialists) + ponder ${ponderThreads}t`);
  } else {
    const weights = loadWeights(cfg.weightsPath, log);
    picker = cvsPicker(new CvsEngine(weights ? { weights } : undefined), { depth: cfg.depth });
  }
  log(`engine backend: ${backendKind} (picker ${picker.name})`);
  const active = new Set<string>();

  // CONSTANT harvest seeding: whenever idle, seed a fresh AI game, ROTATING the time
  // control (bullet -> classical) and the AI level so we cover ALL speeds and a range
  // of opposition. Gentle by construction — ONE game at a time, re-seeded only when a
  // slot frees (~1 challenge per game), so it never trips the challenge rate limit the
  // way the bot-ladder did. A 429 just backs the seeder off briefly; it self-recovers.
  // This is the PRIMARY harvest source: steady, not aggressive (the ladder is the
  // aggressive path and is off by default below).
  // Classical/rapid by default — competitive games the engine plays well and that the
  // clock-relative time guard keeps flag-safe. Override with CVS_SEED_TCS for other speeds.
  const SEED_TCS: Array<[number, number]> = (process.env.CVS_SEED_TCS
    ?? '1800+0,1500+10,1800+30,1200+10,900+10')
    .split(',')
    .map((s) => s.trim().split('+').map(Number) as [number, number])
    .filter(([l, i]) => Number.isFinite(l) && l >= 15 && Number.isFinite(i) && i >= 0);
  const SEED_LEVELS = cfg.seedAiLevels.length ? cfg.seedAiLevels : [4, 5, 6, 7, 8];
  let seedRot = 0;
  let seedPausedUntil = 0;
  const maybeSeed = async (): Promise<boolean> => {
    if (!cfg.seedAi || active.size >= cfg.maxConcurrentGames || Date.now() < seedPausedUntil) return false;
    const [limit, inc] = SEED_TCS[seedRot % SEED_TCS.length] ?? [300, 3];
    const level = SEED_LEVELS[seedRot % SEED_LEVELS.length] ?? 6;
    seedRot += 1;
    try {
      const g = await client.challengeAi({ level, color: 'random', clockLimitSec: limit, clockIncrementSec: inc });
      log(`seeded vs Lichess AI L${level} ${limit}+${inc} -> ${g.id ?? '(pending gameStart)'}`);
      return true;
    } catch (e) {
      if (String(e).includes('429')) seedPausedUntil = Date.now() + 300_000; // brief back-off; do not hammer a throttle
      log(`seed L${level} ${limit}+${inc} failed: ${String(e)}`);
      return false;
    }
  };

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
        const res = await client.challengeUser(pick.b.username, {
          rated,
          clockLimitSec: limit,
          clockIncrementSec: inc,
        });
        if (res.id) pendingOutbound.set(res.id, pick.b.username);
        log(
          `bot-ladder: challenged ${pick.b.username} (blitz ${pick.rating}) ${rated ? 'rated' : 'casual'} ${limit / 60}+${inc} -> ${res.id ?? res.status ?? 'sent'}`,
        );
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
  // Fill an idle slot: prefer a fresh seed level (diversity) over a ladder bot, and
  // let seeding take the slot so we never stack a seed game AND a ladder game on the
  // same shared engine.
  const fillSlot = async (): Promise<void> => {
    if (!(await maybeSeed())) await maybeChallengeBot();
  };
  void fillSlot();
  // Retry tick: a never-accepted challenge used to strand the ladder (it only
  // re-fired on game end). Tick once a minute; the caps above make it a no-op
  // unless we are genuinely idle with nothing pending.
  const ladderTick = setInterval(() => void fillSlot(), 60_000);
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
            log(
              `${ok ? 'accepted' : 'accept-failed'} ${ch.id} (${ch.speed ?? '?'}, ${ch.rated ? 'rated' : 'casual'})`,
            );
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
            log(
              `outbound challenge ${chId} (${who}) ${ev.type === 'challengeDeclined' ? 'declined — skipping them for 1h' : 'canceled'}`,
            );
          }
        } else if (ev.type === 'gameStart' && ev.game) {
          const gameId = ev.game.gameId ?? ev.game.id ?? ev.game.fullId;
          if (!gameId || active.has(gameId)) continue;
          pendingOutbound.delete(gameId); // an accepted challenge keeps its id as the game id
          for (const [challengeId, username] of pendingOutbound) {
            const canceled = await client.cancelChallenge(challengeId);
            if (canceled) pendingOutbound.delete(challengeId);
            log(
              `${canceled ? 'canceled' : 'cancel-failed'} surplus outbound challenge ${challengeId} (${username})`,
            );
          }
          active.add(gameId);
          log(`game start ${gameId}`);
          // 12s cap: the budget formula (time/30 + 0.8*inc) governs normal
          // moves; the old 4s cap silently starved us at 5+3 and slower TCs
          // (eubos game RqWLhgpt: ~7-8s/move available, never spent >4).
          // Watchdog: an orphaned per-game stream (seen after a 502 / "terminated"
          // event-stream reconnect) can leave playSession awaiting forever, which
          // strands `active` at 1 and silently blocks the bot-ladder — observed:
          // game NQaya5i9 froze the ladder for 11h. Cap the wait so a stuck game
          // always clears `active` and re-kicks the ladder. Generous (default 90m,
          // env CVS_GAME_WATCHDOG_MS) so no real-time TC trips it; a correspondence
          // game idle past the cap is released back to active play.
          const watchdogMs = Number(process.env.CVS_GAME_WATCHDOG_MS ?? 5_400_000);
          let wd: ReturnType<typeof setTimeout> | undefined;
          const watchdog = new Promise<never>((_, reject) => {
            wd = setTimeout(
              () => reject(new Error(`watchdog ${watchdogMs}ms — game stream orphaned`)),
              watchdogMs,
            );
            wd.unref?.();
          });
          // Rotate the opening book per game: snap-play our in-book moves (diversity
          // + banked clock + keeps smarttime off known openings).
          const book = nextBookLine();
          log(`game ${gameId} opening: ${book.name}`);
          // maxMoveMs 12s caps the base budget for slow games (smarttime expands it);
          // moveOverheadMs 150 reserves a real network round-trip + engine IPC so
          // accumulated lag stays under the clock.
          void Promise.race([
            playSession(client, gameId, botId, picker, {
              maxMoveMs: Number(process.env.CVS_LICHESS_MAX_MOVE_MS ?? 12_000),
              moveOverheadMs: Number(process.env.CVS_LICHESS_MOVE_OVERHEAD_MS ?? 150),
              // Worst-case hard move ≤ this fraction of the remaining clock (flag guard).
              safeHardFraction: Number(process.env.CVS_LICHESS_SAFE_HARD_FRACTION ?? 0.05),
              smarttimeHardMult: Number(process.env.CVS_LICHESS_SMARTTIME_HARD ?? 4.8),
              bookLine: book.moves,
            }),
            watchdog,
          ])
            .then(async (res) => {
              try {
                log(
                  `game ${gameId} done: ${res.record.result} (${res.record.termination}, ${res.record.plies.length} plies, CVS=${res.cvsColor})`,
                );
                if (cfg.review) {
                  try {
                    await (opts.harvest ?? harvestGame)(res, cfg, log);
                  } catch (e) {
                    log(`harvest ${gameId} failed: ${String(e)}`);
                  }
                }
              } finally {
                active.delete(gameId);
                void fillSlot(); // seed the next level or hit the ladder once idle
              }
            })
            .catch((e) => {
              active.delete(gameId);
              log(`game ${gameId} error: ${String(e)}`);
              void fillSlot(); // re-seed / re-kick the ladder after a watchdog/abort too
            })
            .finally(() => clearTimeout(wd));
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
    if (opts.maxEventStreamRestarts !== undefined && restarts >= opts.maxEventStreamRestarts)
      return;
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
    console.error(
      'No LICHESS_BOT_TOKEN configured (personal token, scope bot:play). See arena/lichess/README.md.',
    );
    process.exit(1);
  }
  runBot(cfg).catch((e) => {
    console.error('lichess bot failed:', e);
    process.exit(1);
  });
}
