// [5] Diff layer — enumerate ChangedRelation candidates from before/after
// relations + the move + the PV. Two sources (§5 Step C):
//   1. before→after diff  → what the played move DIRECTLY changed (played_move)
//   2. refutation gain     → what the opponent's best reply WINS (refutation)
// (3) validated motifs arrive at M5. Candidates are scored later by saliency.
import { Chess } from 'chess.js';
import { buildRelationMap } from './relations';
import { seeOnSquare, seeCapture } from './see';
import { parseFen, pieceAt } from './board';
import { evalToPawns } from './classify';
import type { ChangedRelation, ChangeType, Eval, Square } from './types';

const otherColor = (c: 'w' | 'b') => (c === 'w' ? 'b' : 'w');
const sideName = (c: 'w' | 'b') => (c === 'w' ? 'white' : 'black');

function setEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function blankRelation(): ChangedRelation {
  return {
    id: '',
    kind: 'changed_relation',
    type: 'now_defended',
    side: 'white',
    squares: [],
    arrows: [],
    source: 'played_move',
    materialSwing: 0,
    kingSafetyDelta: 0,
    inPV: false,
    saliency: 0,
    templateId: '',
    evidence: [],
  };
}

/**
 * Source 1 — direct before/after diff of the position. Emits a ChangedRelation
 * for every occupied square whose attacker/defender set changed, plus captures.
 * Material consequence comes from SEE on the AFTER position: a piece of the side
 * that just moved (`mover`) which is now SEE-losing is the "what did I hang".
 */
export function diffPlayedMove(fenBefore: string, fenAfter: string): ChangedRelation[] {
  const before = buildRelationMap(fenBefore);
  const after = buildRelationMap(fenAfter);
  const mover = parseFen(fenBefore).turn; // the side that just moved
  const out: ChangedRelation[] = [];

  const squares = new Set<string>([
    ...Object.keys(before.bySquare),
    ...Object.keys(after.bySquare),
  ]);

  for (const sq of squares) {
    const b = before.bySquare[sq];
    const a = after.bySquare[sq];

    // A piece that was here before and is gone now (and an enemy stands there or
    // it's empty) — captured.
    if (b && (!a || a.piece[0] !== b.piece[0])) {
      // Only count as a capture if something actually took it (enemy now there).
      if (a && a.piece[0] === otherColor(b.piece[0] as 'w' | 'b')) {
        out.push({
          ...blankRelation(),
          id: nextId('cap'),
          type: 'piece_captured',
          side: sideName(b.piece[0] as 'w' | 'b'),
          squares: [sq],
          materialSwing: 0,
          templateId: 'piece_captured',
          evidence: [`${b.piece} on ${sq} was captured`],
        });
      }
      continue;
    }
    if (!b || !a) continue; // newly arrived piece: handled via the squares it now affects

    const attackersChanged = !setEqual(b.attackedBy, a.attackedBy);
    const defendersChanged = !setEqual(b.defendedBy, a.defendedBy);
    if (!attackersChanged && !defendersChanged) continue;

    const owner = a.piece[0] as 'w' | 'b';
    // Material consequence: only the mover's OWN pieces are immediately at risk
    // (it is now the opponent's turn to capture).
    const swing = owner === mover ? seeOnSquare(fenAfter, sq).swing : 0;

    let type: ChangeType = 'now_defended';
    if (swing > 0) {
      // SEE-losing dominates the framing — this is a material loss (Invariant 3).
      type = 'now_see_losing';
    } else if (a.defendedBy.length === 0 && b.defendedBy.length > 0 && a.attackedBy.length > 0) {
      type = 'now_undefended';
    } else if (a.defendedBy.length > b.defendedBy.length) {
      type = 'now_defended';
    } else if (a.attackedBy.length > b.attackedBy.length) {
      type = 'now_undefended';
    }

    out.push({
      ...blankRelation(),
      id: nextId('chg'),
      type,
      side: sideName(owner),
      squares: [sq],
      materialSwing: swing,
      templateId: type,
      evidence: [
        `${a.piece} on ${sq}: defenders ${b.defendedBy.length}→${a.defendedBy.length}, attackers ${b.attackedBy.length}→${a.attackedBy.length}` +
          (swing > 0 ? `; SEE ${swing >= 0 ? '+' : ''}${swing}` : ''),
      ],
    });
  }

  return out;
}

/**
 * Source 2 — the refutation. Walk the opponent's best continuation (evalAfter.pv,
 * from positionAfter) and find the first forcing reply (capture / check / mate)
 * it relies on. THIS is how blunders are explained (Invariant 5): the punishment
 * is the opponent's reply, not what the move directly changed.
 */
export function diffRefutation(fenAfter: string, evalAfter: Eval): ChangedRelation[] {
  const pv = evalAfter.pv ?? [];
  if (pv.length === 0) return [];
  const opponent = parseFen(fenAfter).turn; // side to move at positionAfter (the refuter)

  // Mating refutation: the whole line is a forced mate for the refuter.
  if (evalAfter.mate !== undefined && evalAfter.mate > 0) {
    const chess = new Chess(fenAfter);
    const first = chess.move(pv[0]);
    const squares = first ? [first.to] : [];
    return [
      {
        ...blankRelation(),
        id: nextId('ref'),
        type: 'mate_threat',
        side: sideName(opponent),
        squares,
        arrows: first ? [[first.from, first.to]] : [],
        source: 'refutation',
        materialSwing: 0,
        kingSafetyDelta: 1, // forced mate — maximal king-safety swing
        inPV: true,
        templateId: 'mate_threat',
        evidence: [`forced mate in ${evalAfter.mate}: ${pv.slice(0, 4).join(' ')}`],
      },
    ];
  }

  // Material refutation: the opponent's IMMEDIATE reply (pv[0]) only — a capture by
  // the refuter, with positive SEE, on the ACTUAL displayed position. A winning
  // capture deeper in the PV is NOT "the reply": its destination is a future-board
  // square that may be empty on the position shown (the root cause of "Bxb5 wins a
  // pawn" claimed on an empty b5). Those are left to pvRefutation, which frames the
  // whole line honestly instead of asserting a capture on the current board.
  let moved;
  try {
    moved = new Chess(fenAfter).move(pv[0]);
  } catch {
    moved = null;
  }
  if (moved && (moved.flags.includes('c') || moved.flags.includes('e'))) {
    const win = seeCapture(fenAfter, moved.from, moved.to);
    if (win > 0) {
      return [
        {
          ...blankRelation(),
          id: nextId('ref'),
          type: 'now_see_losing',
          side: sideName(opponent),
          squares: [moved.to],
          arrows: [[moved.from, moved.to]],
          source: 'refutation',
          materialSwing: win,
          inPV: true,
          templateId: 'refutation_wins_material',
          victim: moved.captured, // the real captured piece — names the prose correctly
          evidence: [
            `opponent's best reply ${pv[0]} wins ${win} (SEE) on ${moved.to}; line: ${pv
              .slice(0, 4)
              .join(' ')}`,
          ],
        },
      ];
    }
  }
  return [];
}

/**
 * Source 2b — the PV refutation FALLBACK (Invariant 5, honest mode). When the move
 * is a real mistake by eval but NO named detector (mate / clean SEE capture / proven
 * motif) explains it, the punishment is quiet/positional (interference, overload,
 * king-safety proof failure). We refuse to invent a motif we can't prove; instead we
 * surface the ORACLE's line verbatim: "the refutation starts with Rd6 — not a capture
 * or mate yet, but the line that punishes the move." Tagged so detector gaps become
 * labeled future work, not bad explanations.
 */
export function pvRefutation(fenAfter: string, evalAfter: Eval, evalLoss: number): ChangedRelation | null {
  const pv = evalAfter.pv ?? [];
  if (pv.length === 0) return null;
  const winner = parseFen(fenAfter).turn; // side to move at positionAfter = the refuter
  let first;
  try {
    first = new Chess(fenAfter).move(pv[0]);
  } catch {
    first = null;
  }
  if (!first) return null;

  const evalPawns = evalToPawns(evalAfter); // winner's POV: ≥0 when the refuter is better
  const who = sideName(winner) === 'white' ? 'White' : 'Black';
  const lineText = formatPvLine(fenAfter, pv, 6);
  const shape = pvForcingShape(fenAfter, pv);

  // A line the refuter drives with CHECKS is never "quiet". If it also repeats / the
  // eval is level, it is a perpetual-check / forced-draw resource (the 56.Rxe6 case);
  // otherwise it is a forcing-check sequence that wins something.
  if (shape.firstIsCheck || shape.refuterAllChecks) {
    const drawish = shape.repeats || Math.abs(evalPawns) < 0.75;
    const type: ChangeType = drawish ? 'perpetual_check' : 'forcing_check_resource';
    const headline = drawish
      ? `${who} has a perpetual check — ${pv[0]} forces a draw by repetition: ${lineText}. ` +
        `The winning advantage disappears.`
      : `${who} has a forcing check sequence (not quiet — these are checks) — ${pv[0]}: ${lineText} ` +
        `(${who} ${standingPhrase(evalPawns)}, ${evalPawns >= 0 ? '+' : ''}${evalPawns.toFixed(1)}).`;
    return {
      ...blankRelation(),
      id: nextId('pvref'),
      type,
      side: sideName(winner),
      squares: [first.to],
      arrows: [[first.from, first.to]],
      source: 'refutation',
      materialSwing: 0,
      kingSafetyDelta: drawish ? 0 : 0.5,
      inPV: true,
      templateId: type,
      evidence: [
        headline,
        `tags: ${drawish ? 'perpetual_check forced_draw' : 'forcing_check_resource'} evalLoss=${evalLoss.toFixed(2)}`,
      ],
    };
  }

  const headline =
    `${who} has a quiet refutation — ${pv[0]} starts the line that punishes the move ` +
    `(${who} ${standingPhrase(evalPawns)}, ${evalPawns >= 0 ? '+' : ''}${evalPawns.toFixed(1)}). ` +
    `Not a direct capture or mate yet: ${lineText}.`;

  return {
    ...blankRelation(),
    id: nextId('pvref'),
    type: 'pv_refutation',
    side: sideName(winner),
    squares: [first.to],
    arrows: [[first.from, first.to]],
    source: 'refutation',
    materialSwing: 0, // honest: no proven material — the eval carries it, not SEE
    kingSafetyDelta: 0,
    inPV: true,
    templateId: 'pv_refutation',
    // Training-data tags: every time this fires on a real game it names a missing detector.
    evidence: [
      headline,
      `tags: unexplained_by_detectors pv_refutation_required candidate_for_new_detector evalLoss=${evalLoss.toFixed(2)}`,
    ],
  };
}

/**
 * Inspect the shape of a PV: is the first move a check, are ALL the refuter's moves
 * (even plies) checks, and does the line repeat / draw? Used to recognise a perpetual
 * or forcing-check resource so it is never mislabelled "quiet". Replays the PV with
 * chess.js (illegal/over-run plies stop the scan).
 */
function pvForcingShape(
  fenAfter: string,
  pv: string[],
): { firstIsCheck: boolean; refuterAllChecks: boolean; repeats: boolean } {
  let firstIsCheck = false;
  let refuterAllChecks = true;
  let refuterPlies = 0;
  let repeats = false;
  try {
    const chess = new Chess(fenAfter);
    const n = Math.min(pv.length, 8);
    for (let i = 0; i < n; i++) {
      const m = chess.move(pv[i]);
      if (!m) break;
      const isCheck = m.san.includes('+') || m.san.includes('#');
      if (i === 0) firstIsCheck = isCheck;
      if (i % 2 === 0) {
        refuterPlies += 1;
        if (!isCheck) refuterAllChecks = false;
      }
      if (chess.isThreefoldRepetition() || chess.isDraw()) {
        repeats = true;
        break;
      }
    }
  } catch {
    return { firstIsCheck: false, refuterAllChecks: false, repeats: false };
  }
  return { firstIsCheck, refuterAllChecks: refuterPlies > 0 && refuterAllChecks, repeats };
}

/** Phrase the magnitude of an advantage (winner's POV, in pawns). */
function standingPhrase(pawns: number): string {
  const p = Math.abs(pawns);
  if (p >= 3) return pawns >= 0 ? 'is winning' : 'is lost';
  if (p >= 1.5) return pawns >= 0 ? 'is clearly better' : 'is clearly worse';
  if (p >= 0.5) return pawns >= 0 ? 'is better' : 'is worse';
  return 'is about equal';
}

/** Render a SAN PV with move numbers, starting from the position's side & move no. */
function formatPvLine(fenAfter: string, pv: string[], maxPlies: number): string {
  const parts = fenAfter.trim().split(/\s+/);
  let turn = (parts[1] as 'w' | 'b') ?? 'w';
  let moveNo = parseInt(parts[5] ?? '1', 10);
  const out: string[] = [];
  for (let i = 0; i < pv.length && i < maxPlies; i++) {
    if (turn === 'w') out.push(`${moveNo}.${pv[i]}`);
    else out.push(out.length === 0 ? `${moveNo}...${pv[i]}` : pv[i]);
    if (turn === 'b') moveNo += 1;
    turn = turn === 'w' ? 'b' : 'w';
  }
  return out.join(' ');
}

/** True if the SAN move is forcing (capture or check). */
export function isForcingSan(san: string): boolean {
  return san.includes('x') || san.includes('+') || san.includes('#');
}

export function capturedSquareOf(fenBefore: string, san: string): Square | null {
  const chess = new Chess(fenBefore);
  const m = chess.move(san);
  if (!m) return null;
  return m.flags.includes('c') || m.flags.includes('e') ? m.to : null;
}

export { pieceAt };
