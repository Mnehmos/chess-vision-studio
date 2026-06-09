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
  readonly settings: OpponentSettings;

  private constructor(settings: OpponentSettings) {
    this.settings = settings;
  }

  static async create(eloLabel: number, movetimeMs = 80): Promise<SfOpponent> {
    const opp = new SfOpponent(settingsFor(eloLabel, movetimeMs));
    opp.transport = await createNodeStockfishTransport();
    opp.transport.onLine((line) => {
      for (const h of opp.handlers) h(line);
    });
    await opp.expect('uci', 'uciok');
    if (opp.settings.mechanism === 'UCI_Elo') {
      opp.transport.send('setoption name UCI_LimitStrength value true');
      opp.transport.send(`setoption name UCI_Elo value ${opp.settings.uciElo}`);
    } else {
      opp.transport.send(`setoption name Skill Level value ${opp.settings.skillLevel}`);
    }
    await opp.expect('isready', 'readyok');
    return opp;
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
