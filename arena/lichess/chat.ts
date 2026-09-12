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
//   * **Every ply, studio voice.** No cadence, no dedupe, no silence: after each of our
//     moves and after each of theirs, the line the Chess Vision Studio's `analyzeMove`
//     produces for that ply is what gets said. The studio's neutral fallback is still its
//     voice; filtering it out is what produced three lines per game before.
//   * **Fail-closed.** Any engine/protocol/network failure is swallowed; the game
//     continues untouched.
import { Chess } from 'chess.js';
import { RustEngine } from '../gauntlet/rust-engine';
import { uciToMove } from '../players';
import { curateChatLine } from '../../engine/teaching/chatLine';
import type { Eval } from '../../engine/types';
import { studioLine } from './studio-commentary';

export interface ChatterOptions {
  /** Engine binary; defaults to the same path the picker uses. */
  exe?: string;
  /**
   * Which Lichess chat room. Verified live: in a game against the Lichess AI the player
   * room is accepted by the API and stays invisible (AI games show no chat at all), while
   * in a real bot game the player room is what everyone sees. So the room is chosen per
   * game from the opponent's name (AI -> spectator, otherwise player), with
   * CVS_LICHESS_CHAT_ROOM as an explicit override.
   */
  room?: 'player' | 'spectator';
  /**
   * Running Chess Vision Studio (dev server) whose teaching pipeline writes the line:
   * its facts endpoint + `analyzeMove`. When unset/unreachable the local curator
   * (engine/teaching/chatLine.ts) is used instead.
   */
  studioUrl?: string;
  /** Depth for the studio path's before/after evals. Default 12. */
  studioDepth?: number;
  log?: (message: string) => void;
}

export interface Chatter {
  /** Called after our move has been accepted by the server. Never throws. */
  afterOurMove(gameId: string, fenBefore: string, uci: string, opponent?: string): Promise<void>;
  /**
   * Called when it is our turn again, with the opponent's just-played move: says what
   * that move ALLOWED us. This is the more instructive half — the opponent-side probes
   * in the bundle prove a motif is newly available (present now, absent from the
   * before-position's opponent-side collections), so the claim is verified rather than
   * assumed. Never throws.
   */
  afterTheirMove(gameId: string, fenBefore: string, uci: string, opponent?: string): Promise<void>;
  dispose(): void;
}

/** FEN halfmove/fullmove -> the move number the position belongs to (1-based). */
function moveNumber(fen: string): number {
  const parts = fen.split(' ');
  return Number(parts[5] ?? '1') || 1;
}

/**
 * Compact eval tag for the line: "(mate in 5)", or the score, or the swing when it moved.
 * The mate lines already carried this and were the most useful in the feed; the rest said
 * "the evaluation is unchanged" without ever saying what it was.
 */
function evalTag(before: Eval, after: Eval): string {
  if (typeof after.mate === 'number' && after.mate !== 0) return `(mate in ${Math.abs(after.mate)})`;
  if (typeof after.cp !== 'number') return '';
  const now = after.cp / 100;
  const was = typeof before.cp === 'number' ? before.cp / 100 : undefined;
  const fmt = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  if (was !== undefined && Math.abs(was - now) >= 0.5) return `(${fmt(was)} → ${fmt(now)})`;
  return `(${fmt(now)})`;
}

/** `12.` for White's move, `12...` for Black's — a chat reader must know WHICH move. */
function moveNumberPrefix(fen: string): string {
  return fen.split(' ')[1] === 'w' ? `${moveNumber(fen)}.` : `${moveNumber(fen)}...`;
}

/** Fullmove index (odd = White) for the studio's AnalyzeInput.ply. */
function plyOf(fen: string): number {
  return (moveNumber(fen) - 1) * 2 + (fen.split(' ')[1] === 'w' ? 1 : 2);
}

function moverOf(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'w' ? 'white' : 'black';
}

const DEFAULT_EXE =
  process.env.CVS_RUST_EXE ?? '../chess-vision-studio-rust-engine/target/release/analyze.exe';

export function makeChatter(
  client: { chat(gameId: string, text: string, room?: 'player' | 'spectator'): Promise<boolean> },
  opts: ChatterOptions = {},
): Chatter {
  const studioUrl = opts.studioUrl ?? process.env.CVS_STUDIO_URL ?? 'http://localhost:5199';
  const roomOverride = opts.room
    ?? (process.env.CVS_LICHESS_CHAT_ROOM as 'player' | 'spectator' | undefined);
  let room: 'player' | 'spectator' = roomOverride ?? 'player';

  /** Lichess AI opponents are named "Stockfish level N" and their games show no chat. */
  function roomFor(opponent: string | undefined): 'player' | 'spectator' {
    if (roomOverride) return roomOverride;
    return opponent && /^stockfish level/i.test(opponent) ? 'spectator' : 'player';
  }
  const log = opts.log ?? ((): void => {});
  // Facts need no nets and no search: a dedicated depth-1 serve process is enough.
  const engine = new RustEngine(opts.exe ?? DEFAULT_EXE, 1);

  let game = '';
  let lastTag = '';
  let lines = 0;

  async function speak(
    gameId: string,
    fenBefore: string,
    uci: string,
    subject: 'ours' | 'theirs',
    opponent?: string,
  ): Promise<void> {
    room = roomFor(opponent);
    {
      try {
        if (gameId !== game) {
          game = gameId;
          lines = 0;
          lastTag = '';
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

        // The studio's own per-ply commentary. Its insights are budget-gated against
        // cpLoss (a best move carries no "missed" claim) and it always has a fallback
        // line, which is fine: this is narration of every ply, not a highlight reel.
        let text: string | null = null;
        let tag = 'studio';
        let scoreTag = '';
        try {
          const line = await studioLine(
            { baseUrl: studioUrl, depth: opts.studioDepth ?? 12 },
            {
              fenBefore,
              fenAfter: new Chess(fenBefore).move(uciToMove(uci))?.after ?? fenBefore,
              uci,
              san: moveLabel,
              ply: plyOf(fenBefore),
              mover: moverOf(fenBefore),
            },
          );
          if (line?.text) {
            scoreTag = evalTag(line.evals.before, line.evals.after);
            // Quote the score when the line does not already carry one and the budget
            // allows it: "the evaluation is unchanged" is meaningless without the number.
            text =
              scoreTag && !/\([+-]?\d|mate in/.test(line.text) && line.text.length + scoreTag.length + 1 <= 140
                ? `${line.text} ${scoreTag}`
                : line.text;
            tag = `studio ${line.topic} (${line.classification})`;
          }
        } catch (error) {
          log(`chat: studio unavailable (${(error as Error).message}) — local curator`);
        }

        if (!text) {
          // Studio unreachable: say the validated motif the move created, if any.
          const local = curateChatLine(bundle, { subject, moveLabel });
          if (local) {
            text = `${moveNumberPrefix(fenBefore)} ${local.text}`;
            tag = `local T${local.tier} ${local.conceptCode}${subject === 'theirs' ? ' their-move' : ''}`;
          }
        }
        if (!text) {
          return;
        }

        // Repetition guard: the same template on consecutive plies must not read as the
        // same sentence twice ("No forcing tactic found…" ran 15x in one game). Fall back
        // to the compact move+score form — still per-ply, still informative, never a rerun.
        if (tag === lastTag && scoreTag) {
          text = `${moveNumberPrefix(fenBefore)} ${moveLabel} ${scoreTag}`.replace(/\s+/g, ' ').trim();
        }

        const said = await client.chat(gameId, text, room);
        if (said) {
          lines += 1;
          lastTag = tag;
          // Log the room: whether a line is visible depends entirely on which room it
          // went to, and guessing has cost us a lot of time today.
          log(`chat ${gameId} [${room} ${tag}]: ${text}`);
        }
      } catch (error) {
        // Chat is a garnish: never let it touch the game.
        log(`chat: suppressed error (${(error as Error).message})`);
      }
    }
  }

  return {
    async afterOurMove(gameId, fenBefore, uci, opponent) {
      await speak(gameId, fenBefore, uci, 'ours', opponent);
    },
    async afterTheirMove(gameId, fenBefore, uci, opponent) {
      await speak(gameId, fenBefore, uci, 'theirs', opponent);
    },
    dispose() {
      engine.dispose();
    },
  };
}
