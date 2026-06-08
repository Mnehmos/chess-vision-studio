// Challenge-accept policy. Per the configured posture the bot accepts casual
// and/or rated standard-chess challenges within a sane time-control band (engines
// want thinking time, so very fast games are declined), optionally restricted to
// other bots. Lichess decline reasons must be from its allowed set.
import type { ChallengeEvent } from './client';
import type { LichessConfig } from './env';

export interface AcceptVerdict {
  accept: boolean;
  /** A Lichess decline reason key when accept=false. */
  reason?: 'variant' | 'tooFast' | 'tooSlow' | 'casual' | 'rated' | 'noBot' | 'onlyBot' | 'later' | 'generic';
}

const ACCEPT: AcceptVerdict = { accept: true };

export function shouldAccept(ch: ChallengeEvent, cfg: LichessConfig): AcceptVerdict {
  // Standard chess only — the engine doesn't play variants.
  if ((ch.variant?.key ?? 'standard') !== 'standard') return { accept: false, reason: 'variant' };

  // Bot-only posture: decline humans.
  if (cfg.botsOnly && (ch.challenger?.title ?? null) !== 'BOT') return { accept: false, reason: 'onlyBot' };

  const isCorrespondence = ch.speed === 'correspondence' || ch.timeControl?.type === 'correspondence';
  if (isCorrespondence) {
    if (!cfg.allowCorrespondence) return { accept: false, reason: 'tooSlow' };
    return ratedGate(ch, cfg);
  }

  // Real-time: decline anything faster than the configured initial clock.
  const initialSec = ch.timeControl?.limit ?? 0;
  if (initialSec > 0 && initialSec < cfg.minClockInitialSec) return { accept: false, reason: 'tooFast' };

  return ratedGate(ch, cfg);
}

function ratedGate(ch: ChallengeEvent, cfg: LichessConfig): AcceptVerdict {
  if (ch.rated) return cfg.acceptRated ? ACCEPT : { accept: false, reason: 'rated' };
  return cfg.acceptCasual ? ACCEPT : { accept: false, reason: 'casual' };
}
