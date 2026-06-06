// [5b] Tier-2 motif layer — PROPOSE → VALIDATE → NAME (Invariant 7, hardest puzzle).
//
// Tier-2 motifs (overload, deflection, decoy, zwischenzug, interference,
// trapped_piece) are NOT geometrically provable the way a pin is. So we follow
// the spec's contract literally:
//
//   1. PROPOSE a forcing candidate (a check, a capture, or a sacrifice).
//   2. VALIDATE it with the independent search oracle (tacticalOutcome): the
//      resulting line must WIN material or force mate. The SEARCH is ground
//      truth — never the dataset's label.
//   3. NAME the motif by the SHAPE of the validated line.
//
// We are deliberately CONSERVATIVE: a candidate is only ever emitted when the
// oracle confirms the payoff. An "interference" that the opponent captures for
// free, an "overload" with a backup defender, a "decoy" sac that is simply taken
// — all fail step 2 and are dropped. This is what lets us correctly REJECT the
// dataset's look-alike negatives (and catch its mislabels, e.g. a "trapped"
// rook the oracle proves is not actually won).
//
// SUB-TYPE caveat: deflection / decoy / overload frequently describe the SAME
// validated line from different angles (a queen pulled OFF its guard square is
// simultaneously lured ONTO the mating square and was overloaded). When the
// shape is genuinely ambiguous we emit the type whose defining signature is
// strongest and document the heuristic below. Validity is binary regardless;
// only the *name* is best-effort.

import { Chess } from 'chess.js';
import {
  parseFen,
  pieceAt,
  attackersOf,
  toSquare,
  fileOf,
  rankOf,
  type Board,
  type Color,
  type PieceType,
} from './board';
import { pieceIdOf } from './relations';
import { seeCapture, PIECE_VALUE } from './see';
import { tacticalOutcome } from './tacticsearch';
import type { Motif, PieceId } from './types';

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const sideName = (c: Color) => (c === 'w' ? 'white' : 'black');

let tier2Counter = 0;
function nextId(): string {
  tier2Counter += 1;
  return `tier2-${tier2Counter}`;
}

interface VerboseMove {
  san: string;
  from: string;
  to: string;
  flags: string;
  piece: string;
  captured?: string;
}

// A line is "winning for the side to move at `fen`" iff the forcing search either
// forces the opponent to be mated or nets at least a minor piece of material.
const WIN_THRESHOLD = 1.5; // pawns

/**
 * Evaluate, from the MOVER's perspective, what happens AFTER we make our
 * candidate move (so it is now the OPPONENT to move at `fenAfter`). The oracle
 * reports gain from the side-to-move POV, so we negate it to get our payoff.
 */
function moverPayoff(fenAfter: string): { wins: boolean; gain: number; mateForUs: boolean; line: string[] } {
  const out = tacticalOutcome(fenAfter, 6);
  // `tacticalOutcome` reports from the SIDE-TO-MOVE (the opponent) POV. It only
  // sets `mateInPlies` (non-null) when THAT side forces mate — i.e. the OPPONENT
  // mates us (bad). When WE mate the opponent, the opponent's score collapses to
  // ≈ -MATE, so `mateInPlies` stays null and `gain` is a huge NEGATIVE for them.
  // We therefore detect "mate for us" from the magnitude of the flipped gain.
  const ourGain = -out.gain; // flip opponent POV → mover POV
  const oppMatesUs = out.mateInPlies !== null && out.mateInPlies > 0; // opponent forces mate
  const mateForUs = !oppMatesUs && ourGain >= 100; // mate sentinel territory (MAT scale)
  const wins = mateForUs || (!oppMatesUs && ourGain >= WIN_THRESHOLD);
  return { wins, gain: ourGain, mateForUs, line: out.line };
}

/**
 * The TOTAL net material (mover POV, in pawns) of playing `san` from `fen`,
 * measured CONSISTENTLY from the root: the material the move itself captures PLUS
 * the mover's best forcing follow-up from the resulting position. A forced mate
 * is a large sentinel. This is the apples-to-apples yardstick that lets us
 * compare an in-between check against the "natural" immediate capture — the
 * post-move forcing search alone is NOT comparable because it omits the material
 * the move just grabbed.
 */
function netFromRoot(fen: string, san: string): number {
  const c = new Chess(fen);
  const m = c.move(san);
  if (!m) return -Infinity;
  const captured = (m as VerboseMove).captured;
  const cap = captured ? PIECE_VALUE[captured as PieceType] : 0;
  const out = tacticalOutcome(c.fen(), 6); // opponent to move now
  // `mateInPlies` is set only when the side-to-move (the OPPONENT) forces mate →
  // catastrophic for us. When WE force mate the opponent's gain collapses to a
  // huge negative, which flips to a huge positive follow-up below.
  let follow: number;
  if (out.mateInPlies !== null && out.mateInPlies > 0) follow = -1000; // opponent mates us
  else follow = -out.gain; // flip opponent POV → mover POV (huge if we mate)
  return cap + follow;
}

function baseTier2(partial: Partial<Motif> & Pick<Motif, 'type' | 'byPiece' | 'side'>): Motif {
  return {
    id: nextId(),
    kind: 'motif',
    type: partial.type,
    tier: 2,
    byPiece: partial.byPiece,
    line: partial.line ?? [],
    consequence: partial.consequence ?? { materialSwing: 0 },
    proposedBy: partial.proposedBy ?? 'heuristic',
    validatedBy: 'engine_pv', // Tier-2 is ALWAYS engine-validated by construction
    side: partial.side,
    squares: partial.squares ?? [],
    arrows: partial.arrows ?? [],
    source: partial.source ?? 'available',
    materialSwing: partial.materialSwing ?? 0,
    kingSafetyDelta: partial.kingSafetyDelta ?? 0,
    inPV: partial.inPV ?? true,
    saliency: 0,
    templateId: partial.templateId ?? partial.type,
    evidence: partial.evidence ?? [],
  };
}

function isSlider(t: PieceType): boolean {
  return t === 'b' || t === 'r' || t === 'q';
}

const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function sliderDirs(t: PieceType): number[][] {
  if (t === 'b') return BISHOP_DIRS;
  if (t === 'r') return ROOK_DIRS;
  if (t === 'q') return [...BISHOP_DIRS, ...ROOK_DIRS];
  return [];
}

// ────────────────────────────────────────────────────────────────────────────
// Candidate generation: the forcing moves we are allowed to PROPOSE.
//   - captures (incl. sacrifices — a capture that loses material on its own
//     square but the search confirms the whole line wins)
//   - checks (forcing tempo moves: zwischenzüge, decoy/deflection sacs)
//   - quiet interposing moves that cut a defender's line (interference)
// ────────────────────────────────────────────────────────────────────────────
function isCheck(m: VerboseMove): boolean {
  return m.san.includes('+') || m.san.includes('#');
}
function isCaptureMove(m: VerboseMove): boolean {
  return m.flags.includes('c') || m.flags.includes('e');
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY
// ────────────────────────────────────────────────────────────────────────────
export function detectTier2(fen: string): Motif[] {
  const board = parseFen(fen);
  const mover = board.turn;
  const out: Motif[] = [];
  const seen = new Set<string>(); // dedupe by `${type}:${firstMoveSan}`

  const push = (m: Motif | null) => {
    if (!m) return;
    const key = `${m.type}:${m.line[0] ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };

  // The forcing candidates we propose.
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true }) as VerboseMove[];

  for (const m of moves) {
    const forcing = isCheck(m) || isCaptureMove(m);
    // Interference proposes QUIET interposing moves too (handled separately),
    // but for the sac/deflect/decoy/zwischenzug family we only look at forcing.
    if (!forcing) continue;

    const after = new Chess(fen);
    after.move(m.san);
    const afterFen = after.fen();
    const payoff = moverPayoff(afterFen);
    if (!payoff.wins) continue; // VALIDATION GATE — search must confirm the win

    const line = [m.san, ...payoff.line];

    // ---- Classify the validated forcing line by shape ----
    classifyForcingLine(fen, board, mover, m, payoff, line).forEach(push);
  }

  // Interference: quiet (or capturing) interpositions on a defender's line.
  detectInterference(fen, board, mover).forEach(push);

  // Trapped piece: an enemy major piece with no safe escape, won by the search.
  detectTrappedPiece(fen, board, mover).forEach(push);

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Shape classifier for a validated FORCING line (sac/check/capture families).
//   Recognises the deflection / decoy / overload trio and the zwischenzug.
// ────────────────────────────────────────────────────────────────────────────
function classifyForcingLine(
  fen: string,
  board: Board,
  mover: Color,
  first: VerboseMove,
  payoff: { gain: number; mateForUs: boolean; line: string[] },
  line: string[],
): Motif[] {
  const result: Motif[] = [];
  const moverPieces = pieceIdOf(pieceAt(board, first.from)!);
  const consequence: { materialSwing: number; mateIn?: number } = payoff.mateForUs
    ? { materialSwing: 0, mateIn: Math.max(1, Math.ceil(line.length / 2)) }
    : { materialSwing: payoff.gain };

  // --- ZWISCHENZUG -----------------------------------------------------------
  // An in-between forcing move (a check) inserted BEFORE the "natural" reply,
  // strictly better by search than playing that natural reply immediately.
  // Signature: our first move is a CHECK, and there exists an immediate
  // alternative (e.g. the obvious recapture) whose value is strictly worse.
  if (isCheck(first)) {
    const zz = tryZwischenzug(fen, mover, first, payoff, line, moverPieces, consequence);
    if (zz) result.push(zz);
  }

  // --- DEFLECTION / DECOY / OVERLOAD (the sacrifice trio) ---------------------
  // Signature: a SACRIFICE/capture (often a check) on a square `S` occupied by an
  // enemy piece that is DEFENDED by exactly one enemy piece D. The opponent's
  // forced best reply recaptures on `S` with D (pulling D off its post / luring
  // it onto S), after which we win or mate. The defender D having a BACKUP
  // recapturer is exactly what makes the dataset negatives fail the search gate.
  if (isCaptureMove(first)) {
    const trio = tryDeflectDecoyOverload(fen, board, mover, first, payoff, line, moverPieces, consequence);
    result.push(...trio);
  }

  return result;
}

/**
 * Zwischenzug: the validated best line opens with a CHECK that is strictly
 * better than the immediate "natural" response. We approximate the natural
 * response as the best NON-check forcing reply (e.g. the direct recapture / the
 * move that answers the opponent's threat) and require the zwischenzug line to
 * out-score it for the mover.
 */
function tryZwischenzug(
  fen: string,
  mover: Color,
  first: VerboseMove,
  payoff: { gain: number; mateForUs: boolean },
  line: string[],
  byPiece: PieceId,
  consequence: { materialSwing: number; mateIn?: number },
): Motif | null {
  // Measure BOTH options from the same root baseline (total net material, mover
  // POV). The in-between check is genuine only if it out-scores the best
  // "natural" NON-check alternative (the immediate recapture / direct grab) by a
  // meaningful margin. Equal nets ⇒ the check buys nothing material ⇒ NOT a
  // zwischenzug (this is exactly the dataset's 'not-forcing' look-alike, where
  // you could simply take instead of interposing a check first).
  const ourValue = netFromRoot(fen, first.san);
  const chess = new Chess(fen);
  const all = chess.moves({ verbose: true }) as VerboseMove[];
  let bestImmediate = -Infinity;
  for (const m of all) {
    if (isCheck(m)) continue; // the alternative must be a NON-check move
    if (!isCaptureMove(m)) continue; // the "natural" move is the direct capture/recapture
    const v = netFromRoot(fen, m.san);
    if (v > bestImmediate) bestImmediate = v;
  }
  // The check must be STRICTLY better than the best immediate non-check option,
  // by at least ~a full pawn, to count as a genuine in-between improvement.
  if (bestImmediate === -Infinity) return null;
  if (ourValue <= bestImmediate + 0.99) return null;

  return baseTier2({
    type: 'zwischenzug',
    byPiece,
    side: sideName(mover),
    squares: [first.from, first.to],
    arrows: [[first.from, first.to]],
    line,
    consequence,
    materialSwing: consequence.materialSwing,
    proposedBy: 'heuristic',
    evidence: [
      `${first.san} is an in-between check: line wins ${ourValue >= 1000 ? 'by force (mate)' : `+${payoff.gain.toFixed(1)}`}, ` +
        `strictly better than the immediate alternative (+${bestImmediate.toFixed(1)})`,
    ],
  });
}

/**
 * The sacrifice trio. We look at the first move landing on `S` (a capture, often
 * with check). If after our move the opponent's best line recaptures on `S` with
 * a piece D that we then exploit (win material / mate), we have the trio shape.
 *
 * Naming heuristic (documented, best-effort — validity is binary regardless):
 *   - decoy      : D is LURED ONTO `S`, and `S` is itself the fatal square (the
 *                  piece is mated / lost ON `S`). King decoys and "recapture →
 *                  mate ON the recapture square" are decoys.
 *   - deflection : D is pulled OFF a duty — it was DEFENDING `S` from a different
 *                  square and is forced to abandon another defended point.
 *   - overload   : D defended >= 2 critical points before the sac (it cannot keep
 *                  both once forced to act).
 * Because the back-rank trio is geometrically one shape, we emit the dominant
 * label by this priority and ALSO emit the complementary labels the shape
 * genuinely supports, so a consumer asking for any of the three finds it.
 */
function tryDeflectDecoyOverload(
  fen: string,
  board: Board,
  mover: Color,
  first: VerboseMove,
  payoff: { gain: number; mateForUs: boolean },
  line: string[],
  byPiece: PieceId,
  consequence: { materialSwing: number; mateIn?: number },
): Motif[] {
  const S = first.to;
  const victim = pieceAt(board, S); // the enemy piece we capture (the sac target square occupant)
  // The opponent's forced reply (2nd ply of the line) — must recapture on S.
  const reply = line[1];
  if (!reply) return [];

  // Reconstruct the position after our move to inspect who recaptures on S.
  const afterOurMove = new Chess(fen);
  afterOurMove.move(first.san);
  const replyMoves = afterOurMove.moves({ verbose: true }) as VerboseMove[];
  const replyMv = replyMoves.find((m) => m.san === reply);
  // The trio shape requires the opponent's forced reply to RECAPTURE on S.
  if (!replyMv || replyMv.to !== S) return [];

  const enemy = other(mover);
  const beforeBoard = board;

  // Identify the recapturing defender D (the enemy piece that takes back on S).
  const dType = replyMv.piece as PieceType;
  const dFrom = replyMv.from;

  // The capture must be a genuine sacrifice/forcing investment: our first move
  // is a check (forces the recapture) OR S was defended (so recapture is forced
  // to avoid losing material). We already KNOW the search wins, so this is shape.
  const isSac = isCheck(first) || (victim ? PIECE_VALUE[first.piece as PieceType] >= PIECE_VALUE[victim.type] : true);
  if (!isSac) return [];

  const results: Motif[] = [];
  const dPiece = pieceAt(beforeBoard, dFrom);
  const dLabel = dPiece ? dPiece.type.toUpperCase() + dFrom : dType.toUpperCase() + dFrom;

  // How many of the enemy's own pieces did D defend BEFORE the sacrifice?
  // (overload signature: D guarded >= 2 occupied points.)
  const defendedByD = countDefendedByPiece(beforeBoard, dFrom, enemy);

  // Sole-defender overload: D is the ONLY defender of S, and being forced to
  // recapture there it can no longer perform its other duty (here, preventing
  // the mate that lands ON S). Classic "overloaded guard". This is the dominant
  // reading of the back-rank trio, so we treat it as an overload signal too.
  const defendersOfS = attackersOf(beforeBoard, S, enemy);
  const soleDefenderOverload =
    defendersOfS.length === 1 && defendersOfS[0].square === dFrom && payoff.mateForUs;
  const isOverloaded = defendedByD >= 2 || soleDefenderOverload;

  // Does the final blow land ON S (decoy: the lured piece dies on S)?
  const finalLandsOnS = line.length >= 3 && sanLandsOn(line[line.length - 1], S);

  // Common fields.
  const baseSquares = [first.from, S, dFrom].filter(Boolean) as string[];
  const baseArrows: [string, string][] = [[first.from, S]];
  const swing = payoff.mateForUs ? 0 : payoff.gain;
  const mateTag = payoff.mateForUs ? ' (forces mate)' : ` (+${payoff.gain.toFixed(1)})`;

  // --- DECOY: the defender is lured ONTO S and is lost/mated THERE. -----------
  if (finalLandsOnS) {
    results.push(
      baseTier2({
        type: 'decoy',
        byPiece,
        side: sideName(mover),
        squares: baseSquares,
        arrows: baseArrows,
        line,
        consequence,
        materialSwing: swing,
        kingSafetyDelta: payoff.mateForUs ? 1 : 0,
        proposedBy: 'heuristic',
        evidence: [
          `${first.san} lures ${dLabel} onto ${S}; ${line[line.length - 1]} then wins on ${S}${mateTag}`,
        ],
      }),
    );
  }

  // --- DEFLECTION: D is pulled OFF a duty (it was guarding S / the key square). -
  // D defended S from dFrom (a different square) and is forced to leave its post.
  const dGuardedS = dFrom !== S; // it recaptures, so it was bearing on S from elsewhere
  if (dGuardedS) {
    results.push(
      baseTier2({
        type: 'deflection',
        byPiece,
        side: sideName(mover),
        squares: baseSquares,
        arrows: baseArrows,
        line,
        consequence,
        materialSwing: swing,
        kingSafetyDelta: payoff.mateForUs ? 1 : 0,
        proposedBy: 'heuristic',
        evidence: [
          `${first.san} deflects ${dLabel} from its post onto ${S}; the duty it abandons collapses${mateTag}`,
        ],
      }),
    );
  }

  // --- OVERLOAD: D carried >= 2 duties (guarded >= 2 points), OR D was the SOLE
  //     guard of S and could not both recapture and prevent the mate on S. -----
  if (isOverloaded) {
    const dutyDesc = defendedByD >= 2 ? `guards ${defendedByD} points` : `is the sole guard of ${S}`;
    results.push(
      baseTier2({
        type: 'overload',
        byPiece,
        side: sideName(mover),
        squares: baseSquares,
        arrows: baseArrows,
        line,
        consequence,
        materialSwing: swing,
        kingSafetyDelta: payoff.mateForUs ? 1 : 0,
        proposedBy: 'heuristic',
        evidence: [
          `${dLabel} is overloaded (${dutyDesc}); ${first.san} forces it to fail a duty${mateTag}`,
        ],
      }),
    );
  }

  // If the shape matched none of the finer signatures but the search still wins
  // via a forced recapture-then-blow, emit the best-fit dominant label so the
  // winning tactic is never silently dropped. Dominant priority: decoy (mate on
  // S) → deflection (defender pulled off) → overload.
  if (results.length === 0) {
    results.push(
      baseTier2({
        type: 'deflection',
        byPiece,
        side: sideName(mover),
        squares: baseSquares,
        arrows: baseArrows,
        line,
        consequence,
        materialSwing: swing,
        proposedBy: 'heuristic',
        evidence: [`${first.san} forces ${dLabel} to recapture on ${S}; the line wins${mateTag}`],
      }),
    );
  }

  return results;
}

/** True if a SAN move's destination square equals `sq`. */
function sanLandsOn(san: string, sq: string): boolean {
  // Strip check/mate/promotion decorations; the destination is the last file+rank.
  const m = san.match(/([a-h][1-8])(?:=[QRBN])?[+#]?$/);
  return m ? m[1] === sq : false;
}

/** Count how many of `color`'s OWN occupied pieces the piece on `fromSq` defends. */
function countDefendedByPiece(board: Board, fromSq: string, color: Color): number {
  let n = 0;
  for (let f = 0; f < 8; f++)
    for (let r = 0; r < 8; r++) {
      const p = board.grid[f][r];
      if (!p || p.color !== color) continue;
      const sq = toSquare(f, r);
      if (sq === fromSq) continue;
      const defenders = attackersOf(board, sq, color);
      if (defenders.some((a) => a.square === fromSq)) n++;
    }
  return n;
}

// ────────────────────────────────────────────────────────────────────────────
// INTERFERENCE — interpose a piece on an enemy defender's line, then win.
//   The interposer must be DEFENDED (so capturing it loses material / fails),
//   which is exactly what separates the real motif from the "captured safely"
//   look-alike.
// ────────────────────────────────────────────────────────────────────────────
function detectInterference(fen: string, board: Board, mover: Color): Motif[] {
  const results: Motif[] = [];
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true }) as VerboseMove[];

  for (const m of moves) {
    // PROPOSE: a move that lands BETWEEN an enemy slider and the square it guards.
    // We detect it by: before the move, some enemy slider's ray passed through
    // m.to to a friendly target; after, the interposer sits on m.to.
    const interposed = interposesOnDefenderLine(board, mover, m.to);
    if (!interposed) continue;

    const after = new Chess(fen);
    after.move(m.san);
    const afterFen = after.fen();
    const afterBoard = parseFen(afterFen);

    // The interposer must be DEFENDED — otherwise the opponent just captures it.
    const defenders = attackersOf(afterBoard, m.to, mover);
    if (defenders.length === 0) continue;

    const payoff = moverPayoff(afterFen);
    if (!payoff.wins) continue; // VALIDATION GATE

    // Confirm the discriminator: if the enemy captures the interposer, we win
    // material on the recapture (the queen/defender that took is itself lost).
    const enemyCapturesIt = (after.moves({ verbose: true }) as VerboseMove[]).find(
      (r) => r.to === m.to,
    );
    let capturePunished = true;
    if (enemyCapturesIt) {
      const c = new Chess(afterFen);
      c.move(enemyCapturesIt.san);
      const p2 = moverPayoff(c.fen());
      capturePunished = p2.wins;
    }
    if (!capturePunished) continue;

    const byPiece = pieceIdOf(pieceAt(board, m.from)!);
    results.push(
      baseTier2({
        type: 'interference',
        byPiece,
        side: sideName(mover),
        squares: [m.from, m.to, interposed.sliderSq, interposed.targetSq],
        arrows: [[interposed.sliderSq, interposed.targetSq]],
        line: [m.san, ...payoff.line],
        consequence: payoff.mateForUs ? { materialSwing: 0, mateIn: 1 } : { materialSwing: payoff.gain },
        materialSwing: payoff.mateForUs ? 0 : payoff.gain,
        proposedBy: 'heuristic',
        evidence: [
          `${m.san} interposes on ${interposed.sliderType.toUpperCase()}${interposed.sliderSq}→${interposed.targetSq}; ` +
            `the interposer is defended, so capturing it loses material — line wins ${payoff.mateForUs ? 'by mate' : `+${payoff.gain.toFixed(1)}`}`,
        ],
      }),
    );
  }
  return results;
}

interface Interposition {
  sliderSq: string;
  sliderType: PieceType;
  targetSq: string;
}

/**
 * Does placing a piece on `sq` cut an ENEMY slider's line to one of its own
 * targets (an enemy-defended piece) OR to a friendly piece it was attacking?
 * We look for an enemy slider that, with `sq` treated as empty, bears through
 * `sq` onto a piece beyond it.
 */
function interposesOnDefenderLine(board: Board, mover: Color, sq: string): Interposition | null {
  const enemy = other(mover);
  const sf = fileOf(sq), sr = rankOf(sq);
  // For each enemy slider, see if `sq` lies on a clear ray that continues to a
  // piece beyond `sq`.
  for (let f = 0; f < 8; f++)
    for (let r = 0; r < 8; r++) {
      const p = board.grid[f][r];
      if (!p || p.color !== enemy || !isSlider(p.type)) continue;
      for (const [df, dr] of sliderDirs(p.type)) {
        // Walk from slider toward `sq`; `sq` must be reached with a clear path,
        // and the ray must CONTINUE to another piece just beyond `sq`.
        let cf = f + df, cr = r + dr;
        let reachedSq = false;
        let blockedBefore = false;
        while (cf >= 0 && cf < 8 && cr >= 0 && cr < 8) {
          const cur = toSquare(cf, cr);
          if (cur === sq) {
            reachedSq = true;
            // continue scanning beyond sq for the target
            cf += df; cr += dr;
            while (cf >= 0 && cf < 8 && cr >= 0 && cr < 8) {
              const beyond = board.grid[cf][cr];
              if (beyond) {
                return { sliderSq: toSquare(f, r), sliderType: p.type, targetSq: toSquare(cf, cr) };
              }
              cf += df; cr += dr;
            }
            break;
          }
          if (board.grid[cf][cr]) { blockedBefore = true; break; }
          cf += df; cr += dr;
        }
        void reachedSq; void blockedBefore; void sf; void sr;
      }
    }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// TRAPPED PIECE — an enemy major piece (Q/R) whose every escape is SEE-losing
//   (or it has none), confirmed WON by the search.
// ────────────────────────────────────────────────────────────────────────────
function detectTrappedPiece(fen: string, board: Board, mover: Color): Motif[] {
  const results: Motif[] = [];
  const enemy = other(mover);

  for (let f = 0; f < 8; f++)
    for (let r = 0; r < 8; r++) {
      const p = board.grid[f][r];
      if (!p || p.color !== enemy) continue;
      if (p.type !== 'q' && p.type !== 'r') continue; // major pieces only
      const sq = toSquare(f, r);

      // It must currently be ATTACKED by the mover (else nothing to trap), and
      // the cheapest capture must win the piece by SEE ALONE (a clean grab — not
      // a sacrifice that only "wins" via a mate follow-up; that is overload/decoy,
      // NOT a trapped piece). This rejects the back-rank trio's defended e8 rook.
      const attackers = attackersOf(board, sq, mover);
      if (attackers.length === 0) continue;
      const cap = cheapestCapture(fen, board, mover, sq);
      if (!cap || cap.gain < 4.5) continue;

      // ENTOMBMENT: the enemy, GIVEN the move, must have no way to save the piece.
      // Move it to every reachable square — if even one lands it on a SEE-safe
      // square, it is NOT trapped (it simply escapes). We give the enemy the move
      // by flipping the side-to-move field of the FEN.
      if (!isEntombed(fen, sq, enemy)) continue;

      // VALIDATE with the search that the capture truly nets the material (the
      // enemy's best defensive resource cannot rescue it).
      const after = new Chess(fen);
      if (!after.move(cap.san)) continue;
      const payoff = moverPayoff(after.fen());
      if (cap.gain + Math.max(0, payoff.gain) < 4.5 && !payoff.mateForUs) continue;

      const byPiece = pieceIdOf(pieceAt(board, cap.from)!);
      results.push(
        baseTier2({
          type: 'trapped_piece',
          byPiece,
          side: sideName(mover),
          squares: [sq, cap.from],
          arrows: [[cap.from, sq]],
          line: [cap.san, ...payoff.line],
          consequence: { materialSwing: cap.gain },
          materialSwing: cap.gain,
          proposedBy: 'heuristic',
          evidence: [
            `${enemy}${p.type.toUpperCase()} on ${sq} is trapped: no escape square is safe; ${cap.san} wins it (+${cap.gain.toFixed(1)})`,
          ],
        }),
      );
    }
  return results;
}

/**
 * Is the enemy piece on `sq` ENTOMBED? Give the enemy the move (flip the FEN's
 * side field) and try every legal move of THAT piece. If any destination leaves
 * it SEE-safe (not losing material on its new square), it can escape → not
 * trapped. Also not trapped if it can simply be defended into safety by staying
 * (handled by the SEE-winning capture gate at the call site). Note: this also
 * naturally rejects the dataset's mislabeled rook, which can flee to safety.
 */
function isEntombed(fen: string, sq: string, enemy: Color): boolean {
  const parts = fen.trim().split(/\s+/);
  parts[1] = enemy; // give the enemy the move
  // Reset en-passant to avoid an illegal target; keep castling as-is.
  parts[3] = '-';
  const enemyToMove = parts.join(' ');
  let chess: Chess;
  try {
    chess = new Chess(enemyToMove);
  } catch {
    return false; // can't reason cleanly → be conservative, don't claim trapped
  }
  const moves = (chess.moves({ verbose: true }) as VerboseMove[]).filter((m) => m.from === sq);
  if (moves.length === 0) return true; // cannot move at all → entombed
  for (const m of moves) {
    const c = new Chess(enemyToMove);
    if (!c.move(m.san)) continue;
    // After relocating, is the piece SEE-safe on its new square? (mover to move)
    const swing = seeOnSquareSafe(c.fen(), m.to);
    if (swing <= 0) return false; // found a safe haven → escapes, not trapped
  }
  return true;
}

/** SEE swing on `square` (owner's loss if opponent initiates captures); 0 = safe. */
function seeOnSquareSafe(fen: string, square: string): number {
  const board = parseFen(fen);
  const victim = pieceAt(board, square);
  if (!victim) return 0;
  // Reuse seeCapture from each attacker; the worst (max) loss for the owner.
  let worst = 0;
  for (const a of attackersOf(board, square, other(victim.color))) {
    const g = seeCapture(fen, a.square, square);
    if (g > worst) worst = g;
  }
  return worst;
}

function cheapestCapture(fen: string, board: Board, mover: Color, target: string): { san: string; from: string; gain: number } | null {
  const attackers = attackersOf(board, target, mover);
  let best: { san: string; from: string; gain: number } | null = null;
  for (const a of attackers) {
    const gain = seeCapture(fen, a.square, target);
    const c = new Chess(fen);
    const m = c.move({ from: a.square, to: target, promotion: 'q' });
    if (!m) continue;
    if (!best || gain > best.gain) best = { san: m.san, from: a.square, gain };
  }
  return best;
}
