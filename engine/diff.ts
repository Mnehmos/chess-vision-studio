// [5] Diff layer — enumerate ChangedRelation candidates from before/after
// relations + the move + the PV. Two sources (§5 Step C):
//   1. before→after diff  → what the played move DIRECTLY changed (played_move)
//   2. refutation gain     → what the opponent's best reply WINS (refutation)
// (3) validated motifs arrive at M5. Candidates are scored later by saliency.
import { Chess } from 'chess.js';
import { buildRelationMap } from './relations';
import { seeOnSquare, seeCapture } from './see';
import { parseFen, pieceAt } from './board';
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

  // Material refutation: the opponent's REPLY — the first capture by the refuter
  // (even plies 0,2) with positive SEE. Scan only the immediate reply window; a
  // capture deep in the PV is not "the reply" and its isolated SEE over-claims
  // (the eval already accounts for the recapture/compensation downstream).
  const chess = new Chess(fenAfter);
  for (let i = 0; i < pv.length && i < 3; i++) {
    const fenAtPly = chess.fen();
    const moved = chess.move(pv[i]);
    if (!moved) break;
    const isRefuterMove = i % 2 === 0;
    if (isRefuterMove && (moved.flags.includes('c') || moved.flags.includes('e'))) {
      const win = seeCapture(fenAtPly, moved.from, moved.to);
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
            evidence: [
              `opponent's best reply ${pv[i]} wins ${win} (SEE) on ${moved.to}; line: ${pv
                .slice(0, 4)
                .join(' ')}`,
            ],
          },
        ];
      }
    }
  }
  return [];
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
