// Elo-limited Stockfish opponent for the gauntlet ladder.
//
// Limiting mechanism (recorded in run_config.json):
//  - label >= 1320: UCI_LimitStrength=true + UCI_Elo=<label> (SF16 supports
//    UCI_Elo 1320–3190, so these labels are SF-calibrated).
//  - label <  1320: UCI_Elo can't go that low — fall back to Skill Level with an
//    APPROXIMATE community mapping (recorded; labels below 1320 are nominal):
//      800→0, 1000→2, 1200→4
// Moves are requested with `go movetime <ms>` so strength limiting applies.
import { createNodeStockfishTransport } from '../../engine/stockfish-node';
import type { EngineTransport } from '../../engine/evaluation';

const SKILL_MAP: Record<number, number> = { 800: 0, 1000: 2, 1200: 4 };

export interface OpponentSettings {
  eloLabel: number;
  mechanism: 'UCI_Elo' | 'SkillLevel';
  uciElo?: number;
  skillLevel?: number;
  movetimeMs: number;
}

export function settingsFor(eloLabel: number, movetimeMs = 80): OpponentSettings {
  if (eloLabel >= 1320) {
    return { eloLabel, mechanism: 'UCI_Elo', uciElo: eloLabel, movetimeMs };
  }
  const skillLevel = SKILL_MAP[eloLabel] ?? Math.max(0, Math.round((eloLabel - 700) / 100));
  return { eloLabel, mechanism: 'SkillLevel', skillLevel, movetimeMs };
}

export class SfOpponent {
  private transport!: EngineTransport;
  private handlers: ((line: string) => void)[] = [];
  // NOTE: the single-threaded Stockfish WASM build is ONE instance per process,
  // EVER (the module factory is single-use, even after dispose). So one
  // SfOpponent serves a whole ladder run: create() once, then setStrength()
  // between opponents (UCI options may be changed whenever no search runs).
  settings!: OpponentSettings;

  private constructor() {}

  static async create(eloLabel?: number, movetimeMs = 80): Promise<SfOpponent> {
    const opp = new SfOpponent();
    opp.transport = await createNodeStockfishTransport();
    opp.transport.onLine((line) => {
      for (const h of opp.handlers) h(line);
    });
    await opp.expect('uci', 'uciok');
    await opp.setStrength(eloLabel ?? 1320, movetimeMs);
    return opp;
  }

  /** Reconfigure the limiter for the next ladder rung (resets both mechanisms). */
  async setStrength(eloLabel: number, movetimeMs = 80): Promise<void> {
    this.settings = settingsFor(eloLabel, movetimeMs);
    // Reset both mechanisms, then apply the active one, so rungs don't leak.
    this.transport.send('setoption name UCI_LimitStrength value false');
    this.transport.send('setoption name Skill Level value 20');
    if (this.settings.mechanism === 'UCI_Elo') {
      this.transport.send('setoption name UCI_LimitStrength value true');
      this.transport.send(`setoption name UCI_Elo value ${this.settings.uciElo}`);
    } else {
      this.transport.send(`setoption name Skill Level value ${this.settings.skillLevel}`);
    }
    await this.expect('isready', 'readyok');
  }

  private expect(cmd: string, token: string): Promise<void> {
    return new Promise((resolve) => {
      const onLine = (line: string) => {
        if (line.includes(token)) {
          this.handlers = this.handlers.filter((h) => h !== onLine);
          resolve();
        }
      };
      this.handlers.push(onLine);
      this.transport.send(cmd);
    });
  }

  /** Best move (UCI) for `fen` at the configured limited strength. */
  bestMove(fen: string): Promise<string | null> {
    return new Promise((resolve) => {
      const onLine = (line: string) => {
        if (line.startsWith('bestmove')) {
          this.handlers = this.handlers.filter((h) => h !== onLine);
          const mv = line.split(/\s+/)[1];
          resolve(!mv || mv === '(none)' ? null : mv);
        }
      };
      this.handlers.push(onLine);
      this.transport.send(`position fen ${fen}`);
      this.transport.send(`go movetime ${this.settings.movetimeMs}`);
    });
  }

  dispose(): void {
    this.transport.dispose();
  }
}
