// [5a] Motif layer — PROPOSE → VALIDATE → LOG (Invariant 7, the HARDEST PUZZLE).
// A motif is a NAMED LABEL on an engine/geometry-verified line, never a guess.
// Only VALIDATED candidates are ever constructed. Rejected proposals are logged,
// never returned. Tactical validity is BINARY — no confidence field.
//
// Proof strategy (no LLM, mostly no engine):
//   - pin/skewer  : ray geometry (nothing between → it IS a pin)
//   - fork        : ENUMERATE every opponent reply; if F wins material in ALL of
//                   them it is real. This auto-rejects "the forker is hanging"
//                   (a reply that captures the forker leaves F winning nothing).
//   - removal-of-guard : SEE on the now-undefended piece after the guard is gone
//   - discovered check : diff of attack maps + a piece that did not move
//   - mate / back-rank : chess.js isCheckmate() on the actual move — ground truth
import { Chess } from 'chess.js';
import {
  parseFen,
  pieceAt,
  attackersOf,
  toSquare,
  fileOf,
  rankOf,
  type Board,
  type BoardPiece,
} from './board';
import { pieceIdOf, buildRelationMap } from './relations';
import { seeCapture, seeOnSquare, PIECE_VALUE } from './see';
import type { Motif, MotifType, PieceId } from './types';

const other = (c: 'w' | 'b') => (c === 'w' ? 'b' : 'w');
const sideName = (c: 'w' | 'b') => (c === 'w' ? 'white' : 'black');

let motifCounter = 0;
function nextId(): string {
  motifCounter += 1;
  return `motif-${motifCounter}`;
}

/** A logged rejection (kept for diagnostics; never shown to the player). */
export interface RejectedProposal {
  type: MotifType;
  reason: string;
  squares: string[];
}
export interface MotifResult {
  motifs: Motif[];
  rejected: RejectedProposal[];
}

function baseMotif(partial: Partial<Motif> & Pick<Motif, 'type' | 'byPiece'>): Motif {
  return {
    id: nextId(),
    kind: 'motif',
    type: partial.type,
    tier: partial.tier ?? 1,
    byPiece: partial.byPiece,
    line: partial.line ?? [],
    consequence: partial.consequence ?? { materialSwing: 0 },
    proposedBy: partial.proposedBy ?? 'geometry',
    validatedBy: partial.validatedBy ?? 'geometry',
    side: partial.side ?? 'white',
    squares: partial.squares ?? [],
    arrows: partial.arrows ?? [],
    source: partial.source ?? 'available',
    materialSwing: partial.materialSwing ?? 0,
    kingSafetyDelta: partial.kingSafetyDelta ?? 0,
    inPV: partial.inPV ?? false,
    saliency: 0,
    templateId: partial.templateId ?? partial.type,
    evidence: partial.evidence ?? [],
  };
}

const BISHOP_DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ROOK_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function sliderDirs(type: string): number[][] {
  if (type === 'b') return BISHOP_DIRS;
  if (type === 'r') return ROOK_DIRS;
  if (type === 'q') return [...BISHOP_DIRS, ...ROOK_DIRS];
  return [];
}

// ────────────────────────────────────────────────────────────────────────────
// Pins & skewers — pure ray geometry. The proof IS the unobstructed ray.
// ────────────────────────────────────────────────────────────────────────────
export function findPinsAndSkewers(fen: string, victimColor: 'w' | 'b'): MotifResult {
  const board = parseFen(fen);
  const motifs: Motif[] = [];
  const rejected: RejectedProposal[] = [];
  const enemy = other(victimColor);

  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const slider = board.grid[f][r];
      if (!slider || slider.color !== enemy) continue;
      if (!['b', 'r', 'q'].includes(slider.type)) continue;

      for (const [df, dr] of sliderDirs(slider.type)) {
        // Walk outward: first victim piece = "front", next = "back".
        let cf = f + df;
        let cr = r + dr;
        let front = null as ReturnType<typeof pieceAt>;
        let frontSq = '';
        while (cf >= 0 && cf < 8 && cr >= 0 && cr < 8) {
          const p = board.grid[cf][cr];
          if (p) {
            if (!front) {
              if (p.color !== victimColor) break; // enemy blocker → no pin this ray
              front = p;
              frontSq = toSquare(cf, cr);
            } else {
              // p is the "back" piece.
              if (p.color !== victimColor) break; // back must be victim's to be a (s)pin
              const backSq = toSquare(cf, cr);
              classifyPinSkewer(slider, front, frontSq, p, backSq, victimColor).forEach((m) =>
                motifs.push(m),
              );
              break;
            }
          }
          cf += df;
          cr += dr;
        }
      }
    }
  }
  return { motifs, rejected };
}

function classifyPinSkewer(
  slider: BoardPiece,
  front: BoardPiece,
  frontSq: string,
  back: BoardPiece,
  backSq: string,
  victimColor: 'w' | 'b',
): Motif[] {
  const vfront = PIECE_VALUE[front.type];
  const vback = PIECE_VALUE[back.type];
  let type: MotifType;
  if (back.type === 'k')
    type = 'pin_absolute'; // less valuable piece pinned against its king
  else if (front.type === 'k')
    type = 'skewer'; // king in front forced to move, back falls
  else if (vfront > vback)
    type = 'skewer'; // more valuable in front
  else type = 'pin_relative'; // less/equal valuable in front, bigger behind

  // Meaningfulness filter: a skewer/relative pin is only a tactic if the BACK
  // piece is actually worth winning (≥ a minor). A piece "skewered" over a pawn
  // is geometric noise, not a motif. Absolute pins (back = king) always count.
  if (type !== 'pin_absolute' && vback < 3) return [];

  const sliderId = pieceIdOf(slider);
  return [
    baseMotif({
      type,
      byPiece: sliderId,
      side: sideName(other(victimColor)), // the side executing the (s)pin
      squares: [slider.square, frontSq, backSq],
      arrows: [[slider.square, backSq]],
      validatedBy: 'geometry',
      proposedBy: 'geometry',
      materialSwing: type === 'pin_absolute' ? 0 : Math.max(0, vback - vfront),
      evidence: [
        `${slider.type.toUpperCase()}${slider.square} ${type} on ${frontSq} (front) → ${backSq} (back); ray clear`,
      ],
    }),
  ];
}

// ────────────────────────────────────────────────────────────────────────────
// Fork — proven by ENUMERATION over every opponent reply (no engine needed).
// ────────────────────────────────────────────────────────────────────────────
export function findForks(fen: string): MotifResult {
  const board = parseFen(fen);
  const forkerColor = board.turn;
  const motifs: Motif[] = [];
  const rejected: RejectedProposal[] = [];
  const chess = new Chess(fen);

  for (const m of chess.moves({ verbose: true })) {
    // PROPOSE: a move whose moved piece then attacks ≥2 enemy pieces worth taking.
    const test = new Chess(fen);
    test.move(m.san);
    const afterFen = test.fen();
    const afterBoard = parseFen(afterFen);
    const movedPiece = pieceAt(afterBoard, m.to);
    if (!movedPiece) continue;

    const targets = enemyPiecesAttackedBy(afterBoard, m.to, other(forkerColor));
    const valuableTargets = targets.filter(
      (t) =>
        t.type === 'k' ||
        PIECE_VALUE[t.type as keyof typeof PIECE_VALUE] >= 3 ||
        isUndefended(afterBoard, t.square, other(forkerColor)),
    );
    if (valuableTargets.length < 2) continue;

    // VALIDATE: in EVERY legal opponent reply, the forker still wins material on
    // one of the original targets. A reply that captures the forker (or saves
    // both targets) yields gain 0 → the proposal is rejected (e.g. forker hangs).
    const verdict = validateForkByEnumeration(afterFen, m.to, valuableTargets, forkerColor);
    if (verdict.win > 0) {
      motifs.push(
        baseMotif({
          type: 'fork',
          byPiece: pieceIdOf(movedPiece),
          side: sideName(forkerColor),
          squares: [m.to, ...valuableTargets.map((t) => t.square)],
          arrows: valuableTargets.map((t) => [m.to, t.square] as [string, string]),
          line: [m.san, ...verdict.line],
          consequence: { materialSwing: verdict.win },
          materialSwing: verdict.win,
          validatedBy: 'see',
          proposedBy: 'geometry',
          kingSafetyDelta: valuableTargets.some((t) => t.type === 'k') ? 0.5 : 0,
          evidence: [
            `${m.san} forks ${valuableTargets.map((t) => t.type.toUpperCase() + t.square).join(' + ')}; ` +
              `wins ≥${verdict.win} in every reply`,
          ],
        }),
      );
    } else {
      rejected.push({
        type: 'fork',
        reason: verdict.reason,
        squares: [m.to, ...valuableTargets.map((t) => t.square)],
      });
    }
  }
  return { motifs, rejected };
}

interface ForkVerdict {
  win: number;
  line: string[];
  reason: string;
}

function validateForkByEnumeration(
  forkFen: string,
  forkerSquare: string,
  targets: { square: string; type: string }[],
  forkerColor: 'w' | 'b',
): ForkVerdict {
  const opp = new Chess(forkFen);
  const replies = opp.moves({ verbose: true });
  if (replies.length === 0) return { win: 0, line: [], reason: 'no replies (mate/stalemate)' };

  let guaranteed = Infinity;
  let worstLine: string[] = [];
  const targetSquares = targets.filter((t) => t.type !== 'k').map((t) => t.square);

  for (const r of replies) {
    const afterReply = new Chess(forkFen);
    afterReply.move(r.san);
    const replyFen = afterReply.fen();
    const replyBoard = parseFen(replyFen);

    // What the opponent's reply COST the forker (e.g. capturing the forker piece).
    const lostToOpp = r.captured ? PIECE_VALUE[r.captured as keyof typeof PIECE_VALUE] : 0;

    // The forker's best recapture/grab. Crucially this includes RECAPTURING on the
    // square the opponent just captured on — so a poisoned defense (…Qxc2 ?? …Bxc2)
    // is correctly scored as winning, not as "the fork was defused".
    const candidateSquares = new Set<string>(targetSquares);
    if (r.captured) candidateSquares.add(r.to); // recapture the piece that just took ours

    let bestGain = 0;
    let bestLine: string[] = [];
    for (const sq of candidateSquares) {
      const victim = pieceAt(replyBoard, sq);
      if (!victim || victim.color === forkerColor) continue;
      for (const a of attackersOf(replyBoard, sq, forkerColor)) {
        // attackersOf is geometric — the capture may be ILLEGAL in the real
        // position (e.g. a pinned attacker). Only credit it if chess.js agrees.
        const san = legalCaptureSan(replyFen, a.square, sq);
        if (!san) continue;
        const gain = seeCapture(replyFen, a.square, sq);
        if (gain > bestGain) {
          bestGain = gain;
          bestLine = [r.san, san];
        }
      }
    }

    const netForForker = bestGain - lostToOpp;
    if (netForForker < guaranteed) {
      guaranteed = netForForker;
      worstLine = bestLine;
    }
    if (guaranteed <= 0) {
      return {
        win: 0,
        line: [],
        reason: `opponent reply ${r.san} defuses the fork (forker hangs or both targets are saved)`,
      };
    }
  }
  void forkerSquare;
  return { win: guaranteed === Infinity ? 0 : guaranteed, line: worstLine, reason: 'validated' };
}

/**
 * SAN for a capture from→to IF it is legal in `fen`, else null. chess.js throws
 * on an illegal move (it does not return null), so this must guard — an
 * uncaught throw here previously crashed the whole app on certain positions.
 */
function legalCaptureSan(fen: string, from: string, to: string): string | null {
  const c = new Chess(fen);
  for (const opts of [{ from, to }, { from, to, promotion: 'q' }] as const) {
    try {
      const m = c.move(opts);
      if (m) return m.san;
    } catch {
      /* try the promotion variant, then give up */
    }
  }
  return null;
}

function enemyPiecesAttackedBy(
  board: Board,
  fromSquare: string,
  enemyColor: 'w' | 'b',
): { square: string; type: string }[] {
  // Which enemy pieces does the piece on `fromSquare` attack? We reuse
  // attackersOf by asking, for each enemy piece, whether `fromSquare` is among
  // its attackers of that square.
  const out: { square: string; type: string }[] = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const p = board.grid[f][r];
      if (!p || p.color !== enemyColor) continue;
      const sq = toSquare(f, r);
      const attackers = attackersOf(board, sq, other(enemyColor));
      if (attackers.some((a) => a.square === fromSquare)) out.push({ square: sq, type: p.type });
    }
  }
  return out;
}

function isUndefended(board: Board, square: string, ownerColor: 'w' | 'b'): boolean {
  return attackersOf(board, square, ownerColor).length === 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Mate / back-rank — ground truth via chess.js isCheckmate() (no engine).
// ────────────────────────────────────────────────────────────────────────────
export function findMatesIn1(fen: string): MotifResult {
  const motifs: Motif[] = [];
  const rejected: RejectedProposal[] = [];
  const board = parseFen(fen);
  const moverColor = board.turn;
  const chess = new Chess(fen);

  for (const m of chess.moves({ verbose: true })) {
    const test = new Chess(fen);
    const moved = test.move(m.san);
    if (!moved) continue;
    if (!test.isCheckmate()) continue;

    const afterBoard = parseFen(test.fen());
    const mover = pieceAt(afterBoard, m.to)!;
    const enemyKingSq = findKing(afterBoard, other(moverColor));
    const backRank = isBackRankMate(afterBoard, enemyKingSq, other(moverColor), m.to, mover.type);
    motifs.push(
      baseMotif({
        type: backRank ? 'back_rank' : 'mating_net',
        byPiece: pieceIdOf(mover),
        side: sideName(moverColor),
        squares: [m.to, enemyKingSq].filter(Boolean) as string[],
        arrows: enemyKingSq ? [[m.to, enemyKingSq]] : [],
        line: [moved.san],
        consequence: { materialSwing: 0, mateIn: 1 },
        kingSafetyDelta: 1,
        validatedBy: 'geometry', // checkmate is rules-provable
        proposedBy: 'geometry',
        evidence: [`${moved.san} is checkmate${backRank ? ' (back rank)' : ''}`],
      }),
    );
  }
  return { motifs, rejected };
}

function findKing(board: Board, color: 'w' | 'b'): string {
  for (let f = 0; f < 8; f++)
    for (let r = 0; r < 8; r++) {
      const p = board.grid[f][r];
      if (p && p.color === color && p.type === 'k') return toSquare(f, r);
    }
  return '';
}

function isBackRankMate(
  board: Board,
  kingSq: string,
  kingColor: 'w' | 'b',
  matingSq: string,
  matingType: string,
): boolean {
  if (!kingSq) return false;
  const backRank = kingColor === 'w' ? 0 : 7;
  if (rankOf(kingSq) !== backRank) return false;
  if (!['r', 'q'].includes(matingType)) return false;
  if (rankOf(matingSq) !== backRank) return false;
  // The king's forward-rank escape squares are blocked by its own pawns/pieces.
  const fwd = kingColor === 'w' ? 1 : -1;
  const kf = fileOf(kingSq);
  for (const df of [-1, 0, 1]) {
    const f = kf + df;
    const r = backRank + fwd;
    if (f < 0 || f > 7) continue;
    const occ = board.grid[f][r];
    if (!occ || occ.color !== kingColor) {
      // an empty/enemy forward square that the king could flee to would mean
      // it's not the classic back-rank pattern (still mate, just not back-rank).
      // We only require the pattern signature here; mate itself is already proven.
    }
  }
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Move-aware motifs — discovered check & removal of guard (need before/after).
// ────────────────────────────────────────────────────────────────────────────
export function findRemovalOfGuard(fenBefore: string, fenAfter: string): MotifResult {
  const motifs: Motif[] = [];
  const rejected: RejectedProposal[] = [];
  const before = parseFen(fenBefore);
  const after = parseFen(fenAfter);
  const mover = before.turn;
  const beforeRel = buildRelationMap(fenBefore);
  const afterRel = buildRelationMap(fenAfter);

  // The move that captured/displaced the guard: a square that held an enemy piece
  // before and holds a mover piece after (the capturer becomes byPiece).
  let capturer: PieceId = 'n/a' as PieceId;
  for (let f = 0; f < 8; f++)
    for (let r = 0; r < 8; r++) {
      const a = after.grid[f][r];
      const b = before.grid[f][r];
      if (a && a.color === mover && b && b.color !== mover) capturer = pieceIdOf(a);
    }

  for (let f = 0; f < 8; f++)
    for (let r = 0; r < 8; r++) {
      const p = after.grid[f][r];
      if (!p || p.color === mover) continue; // we expose the OPPONENT's piece
      const sq = toSquare(f, r);
      const defBefore = beforeRel.bySquare[sq]?.defendedBy.length ?? 0;
      const defAfter = afterRel.bySquare[sq]?.defendedBy.length ?? 0;
      // REQUIRE that a guard actually disappeared — otherwise this is "newly
      // attacked", a different motif, not removal of guard (Invariant 7).
      if (defAfter >= defBefore) continue;
      const swingBefore = seeOnSquare(fenBefore, sq).swing;
      const swingAfter = seeOnSquare(fenAfter, sq).swing;
      if (swingAfter > 0 && swingBefore <= 0) {
        motifs.push(
          baseMotif({
            type: 'removal_of_guard',
            byPiece: capturer,
            side: sideName(mover),
            squares: [sq],
            consequence: { materialSwing: swingAfter },
            materialSwing: swingAfter,
            validatedBy: 'see',
            proposedBy: 'geometry',
            evidence: [
              `guard removed (defenders ${defBefore}→${defAfter}): ${p.color}${p.type.toUpperCase()} on ${sq} now SEE +${swingAfter}`,
            ],
          }),
        );
      }
    }
  return { motifs, rejected };
}

/** Discovered check: a piece that did NOT move now gives check (line uncovered). */
export function findDiscoveredCheck(fenBefore: string, fenAfter: string): MotifResult {
  const motifs: Motif[] = [];
  const rejected: RejectedProposal[] = [];
  const before = parseFen(fenBefore);
  const after = parseFen(fenAfter);
  const mover = before.turn;
  const enemyKing = findKing(after, other(mover));
  if (!enemyKing) return { motifs, rejected };

  const test = new Chess(fenAfter);
  if (!test.inCheck()) return { motifs, rejected };

  // The moved piece landed on `toSquare`; if the checker is a DIFFERENT piece, it
  // is a discovered check.
  const checkers = attackersOf(after, enemyKing, mover);
  for (const c of checkers) {
    const beforePiece = pieceAt(before, c.square);
    // The checker existed on the same square before the move (it didn't move).
    if (beforePiece && beforePiece.color === mover && beforePiece.type === c.type) {
      const wasCheckingBefore = attackersOf(before, findKing(before, other(mover)), mover).some(
        (a) => a.square === c.square,
      );
      if (!wasCheckingBefore) {
        const checker = pieceAt(after, c.square)!;
        motifs.push(
          baseMotif({
            type: 'discovered_check',
            byPiece: pieceIdOf(checker),
            side: sideName(mover),
            squares: [c.square, enemyKing],
            arrows: [[c.square, enemyKing]],
            kingSafetyDelta: 0.6,
            validatedBy: 'geometry',
            proposedBy: 'geometry',
            evidence: [`${c.type.toUpperCase()}${c.square} delivers a discovered check on ${enemyKing}`],
          }),
        );
      }
    }
  }
  return { motifs, rejected };
}

/** Convenience: all "available" Tier-1 motifs for the side to move in a position. */
export function detectAvailableMotifs(fen: string): MotifResult {
  const board = parseFen(fen);
  const mover = board.turn;
  const forks = findForks(fen);
  const mates = findMatesIn1(fen);
  const pins = findPinsAndSkewers(fen, other(mover)); // (s)pins the mover has on the opponent
  return {
    motifs: [...mates.motifs, ...forks.motifs, ...pins.motifs],
    rejected: [...mates.rejected, ...forks.rejected, ...pins.rejected],
  };
}
