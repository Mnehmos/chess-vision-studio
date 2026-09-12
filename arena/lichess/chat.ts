// Teaching chat for the Lichess bot: say ONE fact-backed line about our own move.
//
// Shape and the reasons for it:
//
//   * **After the move is POSTED, on a dedicated serve process.** Chat can then never
//     delay or corrupt a move, and the facts sweep (measured ~16 ms for the full
//     detector set) does not contend with the picker's search process. Mirrors the
//     ponderPicker pattern: "speculation must never block a real pick".
//   * **Curated, not encyclopaedic.** A position carries ~70 hazards and ~80 motif
//     opportunities; `curateChatLine` ranks them and returns at most one line, with
//     silence as a first-class outcome (26% of moves produce nothing worth saying).
//   * **Evidence-gated.** Every line cites the validators that proved it, and the
//     curator reads only `computed` collections — an uncomputed or unavailable fact
//     contributes nothing.
//   * **Cadence-limited.** At most one line every `minPlies` (default 6) and at most
//     `maxLines` per game (default 12): the point is teaching, not narration.
//   * **Fail-closed.** Any engine/protocol/network failure is swallowed; the game
//     continues untouched.
import { Chess } from 'chess.js';
import { RustEngine } from '../gauntlet/rust-engine';
import { uciToMove } from '../players';
import { cadenceAllows, curateChatLine } from '../../engine/teaching/chatLine';

export interface ChatterOptions {
  /** Engine binary; defaults to the same path the picker uses. */
  exe?: string;
  /** Minimum plies between lines. Default 6. */
  minPlies?: number;
  /** Hard cap per game. Default 12. */
  maxLines?: number;
  /** Which Lichess chat room. Default 'player' (the game's main chat). */
  room?: 'player' | 'spectator';
  log?: (message: string) => void;
}

export interface Chatter {
  /** Called after our move has been accepted by the server. Never throws. */
  afterOurMove(gameId: string, fenBefore: string, uci: string): Promise<void>;
  dispose(): void;
}

const DEFAULT_EXE =
  process.env.CVS_RUST_EXE ?? '../chess-vision-studio-rust-engine/target/release/analyze.exe';

export function makeChatter(
  client: { chat(gameId: string, text: string, room?: 'player' | 'spectator'): Promise<boolean> },
  opts: ChatterOptions = {},
): Chatter {
  const minPlies = opts.minPlies ?? 6;
  const maxLines = opts.maxLines ?? 12;
  const room = opts.room ?? 'player';
  const log = opts.log ?? ((): void => {});
  // Facts need no nets and no search: a dedicated depth-1 serve process is enough.
  const engine = new RustEngine(opts.exe ?? DEFAULT_EXE, 1);

  let game = '';
  let spoken = new Set<string>();
  let pliesSinceLine = 999;
  let lines = 0;

  return {
    async afterOurMove(gameId, fenBefore, uci) {
      try {
        if (gameId !== game) {
          game = gameId;
          spoken = new Set();
          pliesSinceLine = 999;
          lines = 0;
        }
        if (lines >= maxLines) {
          pliesSinceLine += 1;
          return;
        }

        let moveLabel = uci;
        try {
          const board = new Chess(fenBefore);
          const moved = board.move(uciToMove(uci));
          if (moved?.san) moveLabel = moved.san;
        } catch {
          /* label stays UCI; the facts below do not depend on it */
        }

        const bundle = await engine.facts({
          schemaVersion: 1,
          fenBefore,
          playedMoveUci: uci,
          options: { includeMotifOpportunities: true, includeCounterfactual: true },
        });
        if (bundle.errors?.length) {
          log(`chat: bundle errors for ${gameId} ${uci}: ${JSON.stringify(bundle.errors)}`);
          return;
        }

        const line = curateChatLine(bundle, { subject: 'ours', moveLabel, spoken });
        if (!line) {
          pliesSinceLine += 1;
          return;
        }
        if (!cadenceAllows(spoken, pliesSinceLine, minPlies)) {
          pliesSinceLine += 1;
          return;
        }

        const said = await client.chat(gameId, line.text, room);
        if (said) {
          spoken.add(line.key);
          pliesSinceLine = 0;
          lines += 1;
          log(`chat ${gameId} [T${line.tier} ${line.conceptCode}]: ${line.text}`);
        }
      } catch (error) {
        // Chat is a garnish: never let it touch the game.
        log(`chat: suppressed error (${(error as Error).message})`);
      }
    },
    dispose() {
      engine.dispose();
    },
  };
}
