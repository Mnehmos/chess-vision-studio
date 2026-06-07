// Control Lens — the teaching layer on top of PlyFeatures. It names the CONTROL
// PROBLEM of a move: what hazard did it eliminate, create, leave unanswered, or
// walk into? Position = constraint graph; move = control action over hazards.
//
// Every hazard is ENGINE-VALIDATED (Static Exchange via findThreatenedPieces,
// king-pressure counts, or a proven mate) — never an invented tactic. The lens
// diffs the hazards before vs after the move, classifies the control action, and
// states which obligations must be answered vs can be safely ignored (e.g. a loose
// piece ignored because a forced mate ends the game first).
import { parseFen, allPieces, type Color, type PieceType } from './board';
import { findThreatenedPieces } from './threats';
import type { ThreatFeatureSummary, PlyFeatures } from './features';
import type { MoveAnalysis } from './types';

const PIECE_NAME: Record<PieceType, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const sideName = (c: Color): string => (c === 'w' ? 'White' : 'Black');

// ── hazards ─────────────────────────────────────────────────────────────────
export type HazardKind = 'losing_material' | 'king_pressure' | 'mate_threat';

export interface Hazard {
  kind: HazardKind;
  side: Color; // the side IN DANGER (the one who must answer it)
  magnitude: number; // pawns (material), attacked squares (king), or 100−N (mate)
  square?: string; // for losing_material
  piece?: PieceType; // for losing_material
  label: string; // plain-language, validated
}

const KING_PRESSURE_MIN = 4; // attacked squares around a king before it's a hazard

const hazardKey = (h: Hazard): string => `${h.kind}:${h.side}:${h.square ?? ''}`;

/** Validated hazards in a position: SEE-losing pieces + king pressure. Fail-soft. */
function hazardsOf(fen: string, threat: ThreatFeatureSummary): Hazard[] {
  const out: Hazard[] = [];
  try {
    for (const t of findThreatenedPieces(fen)) {
      out.push({
        kind: 'losing_material',
        side: t.owner,
        magnitude: t.gain,
        square: t.square,
        piece: t.piece,
        label: `the ${sideName(t.owner).toLowerCase()} ${PIECE_NAME[t.piece]} on ${t.square} is losing material (+${t.gain})`,
      });
    }
  } catch {
    /* malformed FEN — no material hazards */
  }
  if (threat.whiteKingPressure >= KING_PRESSURE_MIN) {
    out.push({ kind: 'king_pressure', side: 'w', magnitude: threat.whiteKingPressure, label: `the white king is under pressure (${threat.whiteKingPressure} squares)` });
  }
  if (threat.blackKingPressure >= KING_PRESSURE_MIN) {
    out.push({ kind: 'king_pressure', side: 'b', magnitude: threat.blackKingPressure, label: `the black king is under pressure (${threat.blackKingPressure} squares)` });
  }
  return out;
}

function pieceColorAt(fen: string, square: string): Color | null {
  try {
    const found = allPieces(parseFen(fen)).find((p) => p.square === square);
    return found ? found.color : null;
  } catch {
    return null;
  }
}

// ── obligations + verdict ─────────────────────────────────────────────────────
export interface Obligation {
  hazard: Hazard;
  status: 'must_answer' | 'safely_ignored';
  reason: string;
}

export type ControlAction =
  | 'eliminate' // remove the hazard entirely (capture/trade/escape/mate first)
  | 'substitute' // swap a dangerous position for a safer equivalent
  | 'isolate' // block/interpose/close a line between attacker and target
  | 'add_defense' // satisfy a loose-material constraint by adding a defender
  | 'create_warning' // not losing yet, but a new hazard appeared
  | 'fail_to_control' // an existing hazard remains unanswered
  | 'violate_constraint' // walks into a tactic / drops material
  | 'accept_tradeoff' // locally bad, globally sound (forcing line / eval holds)
  | 'maintain'; // no hazard change — a quiet move

export type Verdict = 'satisfied' | 'failed' | 'violated' | 'accepted_tradeoff';

export interface ControlLens {
  hazardsBefore: Hazard[];
  hazardsAfter: Hazard[];
  removed: Hazard[];
  created: Hazard[];
  worsened: Hazard[];
  obligations: Obligation[];
  action: ControlAction;
  verdict: Verdict;
  teachingLine: string;
}

const bySalience = (a: Hazard, b: Hazard): number => b.magnitude - a.magnitude;

/** Derive the Control Lens for one analyzed ply. Pure; clamped to validated facts. */
export function computeControlLens(features: PlyFeatures, analysis: MoveAnalysis): ControlLens {
  const mover = features.mover;
  const opp = other(mover);
  const fenBefore = analysis.positionBefore;
  const fenAfter = analysis.positionAfter;

  const hazardsBefore = hazardsOf(fenBefore, features.threatBefore);
  const hazardsAfter = hazardsOf(fenAfter, features.threatAfter);

  // A proven mate is a hazard of the resulting position, against the mated side.
  if (analysis.mateProof) {
    const matingColor: Color = analysis.mateProof.matingSide === 'white' ? 'w' : 'b';
    hazardsAfter.push({
      kind: 'mate_threat',
      side: other(matingColor),
      magnitude: 1000 - analysis.mateProof.mateInMoves,
      label: `${sideName(matingColor)} has forced mate in ${analysis.mateProof.mateInMoves}`,
    });
  }

  const beforeKeys = new Set(hazardsBefore.map(hazardKey));
  const afterByKey = new Map(hazardsAfter.map((h) => [hazardKey(h), h] as const));
  const beforeByKey = new Map(hazardsBefore.map((h) => [hazardKey(h), h] as const));

  const removed = hazardsBefore.filter((h) => !afterByKey.has(hazardKey(h)));
  const created = hazardsAfter.filter((h) => !beforeKeys.has(hazardKey(h)));
  const worsened = hazardsAfter.filter((h) => {
    const b = beforeByKey.get(hazardKey(h));
    return b ? h.magnitude > b.magnitude : false;
  });

  const mine = (h: Hazard) => h.side === mover;
  const removedMine = removed.filter(mine);
  const createdMine = [...created, ...worsened].filter(mine);
  const persistMine = hazardsAfter.filter((h) => mine(h) && beforeKeys.has(hazardKey(h)));
  const createdTheirs = created.filter((h) => h.side === opp);

  // The mover delivers mate → nothing else matters (the classic "ignore the loose
  // queen because mate ends it" case is captured in the obligations below).
  const moverMatesFirst =
    !!analysis.mateProof && (analysis.mateProof.matingSide === 'white' ? 'w' : 'b') === mover;

  // Obligations: every hazard against the mover that the opponent can now exploit.
  const obligations: Obligation[] = hazardsAfter
    .filter(mine)
    .map((h) =>
      moverMatesFirst
        ? { hazard: h, status: 'safely_ignored' as const, reason: 'the forced mate ends the game first' }
        : { hazard: h, status: 'must_answer' as const, reason: 'the opponent can exploit it on the next move' },
    );

  const cpLoss = analysis.cpLoss;
  const blunderish = cpLoss >= 1.0 || analysis.classification === 'mistake' || analysis.classification === 'blunder';

  let action: ControlAction;
  let verdict: Verdict;
  if (moverMatesFirst) {
    action = 'eliminate';
    verdict = 'satisfied';
  } else if (createdMine.length) {
    if (blunderish) {
      action = 'violate_constraint';
      verdict = 'violated';
    } else if (createdTheirs.length || cpLoss <= 0.3) {
      action = 'accept_tradeoff';
      verdict = 'accepted_tradeoff';
    } else {
      action = 'create_warning';
      verdict = 'satisfied';
    }
  } else if (removedMine.length) {
    // If the endangered man is still on its square, it was defended in place;
    // otherwise it was captured/traded/moved out of danger.
    const defendedInPlace = removedMine.some((h) => h.square && pieceColorAt(fenAfter, h.square) === mover);
    action = defendedInPlace ? 'add_defense' : 'eliminate';
    verdict = 'satisfied';
  } else if (persistMine.length) {
    action = 'fail_to_control';
    verdict = 'failed';
  } else {
    action = 'maintain';
    verdict = 'satisfied';
  }

  // Coach status may never contradict the engine's verdict: a move classified
  // mistake/blunder can never read as "satisfied" (the lone exception is an
  // oracle-proven mate the mover delivers, handled above via moverMatesFirst).
  if (blunderish && !moverMatesFirst && verdict === 'satisfied') {
    action = 'violate_constraint';
    verdict = 'violated';
  }

  const teachingLine = buildTeachingLine(action, { mover, removedMine, createdMine, persistMine, createdTheirs, obligations, analysis });

  return { hazardsBefore, hazardsAfter, removed, created, worsened, obligations, action, verdict, teachingLine };
}

function topLabel(hazards: Hazard[]): string | null {
  if (!hazards.length) return null;
  return [...hazards].sort(bySalience)[0].label;
}

function buildTeachingLine(
  action: ControlAction,
  ctx: {
    mover: Color;
    removedMine: Hazard[];
    createdMine: Hazard[];
    persistMine: Hazard[];
    createdTheirs: Hazard[];
    obligations: Obligation[];
    analysis: MoveAnalysis;
  },
): string {
  const cp = ctx.analysis.cpLoss;
  const cpTxt = `${cp.toFixed(1)} pawn${cp === 1 ? '' : 's'}`;
  let line: string;
  switch (action) {
    case 'eliminate':
      if (ctx.analysis.mateProof) {
        line = `This forces mate in ${ctx.analysis.mateProof.mateInMoves} — it ends the game.`;
      } else {
        line = `This eliminates the hazard${topLabel(ctx.removedMine) ? ` (${topLabel(ctx.removedMine)})` : ''}.`;
      }
      break;
    case 'add_defense':
      line = `This satisfies the loose-material constraint by adding a defender${topLabel(ctx.removedMine) ? ` to ${topLabel(ctx.removedMine)}` : ''}.`;
      break;
    case 'create_warning':
      line = `Playable, but it creates a warning condition: ${topLabel(ctx.createdMine) ?? 'a new hazard'}.`;
      break;
    case 'fail_to_control':
      line = `This fails to control an existing hazard — ${topLabel(ctx.persistMine) ?? 'it'} is still on the board.`;
      break;
    case 'violate_constraint':
      line = `This violates a constraint: ${topLabel(ctx.createdMine) ?? 'material drops'} — ${cpTxt} lost.`;
      break;
    case 'accept_tradeoff':
      line = `This allows ${topLabel(ctx.createdMine) ?? 'a hazard'}, but the line is sound (only ${cpTxt} off).`;
      break;
    case 'substitute':
      line = `This substitutes the position for a safer equivalent.`;
      break;
    case 'isolate':
      line = `This isolates the attacker from its target by closing the line.`;
      break;
    default:
      line = `A quiet move — no new hazards, nothing urgent to answer.`;
  }
  const must = ctx.obligations.filter((o) => o.status === 'must_answer');
  const ignored = ctx.obligations.filter((o) => o.status === 'safely_ignored');
  if (must.length) line += ` Must answer: ${must.map((o) => o.hazard.label).join('; ')}.`;
  if (ignored.length) line += ` Safely ignored: ${ignored.map((o) => o.hazard.label).join('; ')}, because ${ignored[0].reason}.`;
  return line;
}
