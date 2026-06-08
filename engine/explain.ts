// [7] Explanation layer — DETERMINISTIC templates keyed by each insight's
// templateId (a ChangeType or a MotifType). Zero LLM (Invariant 8: the LLM is a
// later swap-in on the SAME contract, M8). Same input → same string.
import type { ChangedRelation, InsightCandidate, Motif } from './types';

const PIECE_NAME: Record<string, string> = {
  P: 'pawn',
  N: 'knight',
  B: 'bishop',
  R: 'rook',
  Q: 'queen',
  K: 'king',
};

/** 'wNf3' | 'wN' → 'knight'. */
function pieceName(piece: string): string {
  const letter = piece.replace(/^[wb]/, '').charAt(0).toUpperCase();
  return PIECE_NAME[letter] ?? 'piece';
}

/** Approximate the won material as a noun for readability. */
function materialNoun(swing: number): string {
  const s = Math.abs(swing);
  if (s >= 9) return 'a queen';
  if (s >= 5) return 'a rook';
  if (s >= 3) return 'a piece';
  if (s >= 1) return s >= 2 ? 'material' : 'a pawn';
  return 'material';
}

function signed(n: number): string {
  return `${n >= 0 ? '+' : ''}${n}`;
}

/** The deterministic renderer. Public entry point for the whole layer. */
export function renderInsight(c: InsightCandidate): string {
  return c.kind === 'motif' ? renderMotif(c) : renderChange(c);
}

// ── Changed relations ────────────────────────────────────────────────────────
function renderChange(c: ChangedRelation): string {
  const sq = c.squares[0] ?? '';
  const who = c.side === 'white' ? 'White' : 'Black';
  switch (c.templateId) {
    case 'refutation_wins_material': {
      const reply = firstLineMove(c.evidence[0]);
      // Name the ACTUAL captured piece, not an approximation from the SEE swing.
      const noun = c.victim ? `a ${pieceName(c.victim)}` : materialNoun(c.materialSwing);
      return `${who}'s reply ${reply ?? ''} wins ${noun} on ${sq}.`.replace(/\s+/g, ' ');
    }
    case 'now_see_losing':
      return c.source === 'refutation'
        ? `${who} wins material on ${sq} (${signed(c.materialSwing)}).`
        : `${who}'s ${pieceName(pieceOnSquare(c))} on ${sq} is losing material — it hangs for ${materialNoun(
            c.materialSwing,
          )} (SEE ${signed(c.materialSwing)}).`;
    case 'now_undefended':
      return `${capitalize(sq)} is no longer defended.`;
    case 'now_attacked':
      return `${capitalize(sq)} is now attacked.`;
    case 'now_defended':
      return `${capitalize(sq)} is now defended.`;
    case 'defender_left':
      return `A defender of ${sq} has left.`;
    case 'piece_captured':
      return `A ${who.toLowerCase()} piece was captured on ${sq}.`;
    case 'check_created':
      return `Check on ${sq}.`;
    case 'mate_threat':
      return `There is a forced mate — ${matePhrase(c.evidence[0])}.`;
    case 'pv_refutation':
    case 'perpetual_check':
    case 'forcing_check_resource':
      // The diff layer already built a full, correctly-framed sentence.
      return c.evidence[0] ?? `${who} has a refutation starting on ${sq}.`;
    case 'development_improved':
      return `${who} develops the ${pieceName(pieceOnSquare(c))}${sq ? ` to ${sq}` : ''}.`;
    case 'center_control_gained':
      return `${who} gains central control${sq ? ` around ${sq}` : ''}.`;
    case 'mobility_improved':
      return `${who} improves piece mobility${deltaPhrase(c.evidence[0])}.`;
    case 'defense_improved':
      return `${who} improves piece safety${sq ? ` around ${sq}` : ''}.`;
    case 'king_safety_improved':
      return `${who} improves king safety${sq ? ` around ${sq}` : ''}.`;
    case 'king_safety_weakened':
      return `${who}'s king safety weakens${sq ? ` around ${sq}` : ''}.`;
    case 'pawn_structure_weakened':
      return `${who}'s pawn structure weakens${sq ? ` around ${sq}` : ''}.`;
    case 'line_opened':
      return `A line was opened through ${sq}.`;
    case 'line_closed':
      return `A line was closed at ${sq}.`;
    case 'escape_squares_changed':
      return `The king's escape squares changed around ${sq}.`;
    default:
      return `A relationship changed on ${sq}.`;
  }
}

function pieceOnSquare(c: ChangedRelation): string {
  // evidence like "wP on e5: ..." → 'wP'
  const m = /\b([wb][PNBRQK])\b/.exec(c.evidence[0] ?? '');
  return m ? m[1] : 'piece';
}

// ── Motifs ───────────────────────────────────────────────────────────────────
function renderMotif(m: Motif): string {
  const line = m.line.join(' ');
  const prefix = motifPrefix(m);
  switch (m.type) {
    case 'fork':
      // Render from the validated fork MOVE + its proven targets — never splice the
      // SEE-enumeration tail (a worst-case continuation that can be unsound, e.g. a
      // follow-up that simply hangs). The win is already proven; the targets are in
      // m.squares. (Acceptance #10: motif detection ≠ PV explanation.)
      return `${prefix}fork — ${m.line[0] ?? ''} forks ${targetList(m)}, winning ${materialNoun(
        m.materialSwing,
      )}.`.replace(/\s+/g, ' ');
    case 'pin_absolute':
      return `${prefix}absolute pin — the ${pieceName(m.byPiece)} pins a piece to the king on ${
        m.squares[2] ?? ''
      }; it cannot move.`;
    case 'pin_relative':
      return `${prefix}pin — the ${pieceName(m.byPiece)} pins the piece on ${
        m.squares[1] ?? ''
      } to the more valuable piece behind it.`;
    case 'skewer':
      return `${prefix}skewer — the ${pieceName(m.byPiece)} forces the front piece to move and wins ${materialNoun(
        m.materialSwing,
      )} behind it.`;
    case 'discovered_check':
      return `${prefix}discovered check — moving away uncovers the ${pieceName(
        m.byPiece,
      )} on ${m.squares[0]}, checking the king.`;
    case 'discovered_attack':
      return `${prefix}discovered attack — an uncovered ${pieceName(m.byPiece)} hits a target.`;
    case 'removal_of_guard': {
      // Plainer than "has a removal of the guard"; reads as the action it is.
      const side = m.side === 'white' ? 'White' : 'Black';
      const noun = materialNoun(m.materialSwing);
      return m.source === 'available'
        ? `${side} missed removing the guard of ${m.squares[0]} (wins ${noun}).`
        : `${side} removes the guard of ${m.squares[0]}, winning ${noun}.`;
    }
    case 'back_rank':
      return `${prefix}back-rank mate — ${line}.`;
    case 'mating_net':
      return `${prefix}forced mate — ${line}.`;
    case 'overload':
      return `${prefix}overload — the defender on ${m.squares[0]} has too many duties.`;
    case 'deflection':
      return `${prefix}deflection — ${line} drags a defender away.`;
    case 'decoy':
      return `${prefix}decoy — ${line} lures a piece onto a fatal square.`;
    case 'interference':
      return `${prefix}interference — ${line} cuts a defender's line.`;
    case 'zwischenzug':
      return `${prefix}in-between move — ${line} inserts a stronger threat first.`;
    case 'trapped_piece':
      return `${prefix}trapped piece on ${m.squares[0]} — it has no safe square.`;
    case 'x_ray':
      return `${prefix}x-ray — pressure passes through to ${m.squares[m.squares.length - 1] ?? ''}.`;
    default:
      return `${prefix}${String(m.type).replace(/_/g, ' ')} — ${line}.`;
  }
}

/** Color-specific prefix: name the SIDE (White/Black), never "you"/"opponent". */
function motifPrefix(m: Motif): string {
  const side = m.side === 'white' ? 'White' : 'Black';
  if (m.source === 'available') return `${side} missed a `; // the mover passed it up
  if (m.source === 'refutation') return `${side} has a `; // the reply punishes the move
  return `${side} has a `; // executed by the move
}

function targetList(m: Motif): string {
  const targets = m.squares.slice(1);
  if (targets.length === 0) return 'two targets';
  if (targets.length === 1) return targets[0];
  return `${targets.slice(0, -1).join(', ')} and ${targets[targets.length - 1]}`;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function firstLineMove(evidence: string | undefined): string | null {
  if (!evidence) return null;
  const m = /reply\s+(\S+)/.exec(evidence);
  return m ? m[1] : null;
}
function matePhrase(evidence: string | undefined): string {
  if (!evidence) return 'mate is forced';
  const m = /mate in (\d+)/.exec(evidence);
  return m ? `mate in ${m[1]}` : 'mate is forced';
}
function deltaPhrase(evidence: string | undefined): string {
  if (!evidence) return '.';
  const m = /(\d+)->(\d+)/.exec(evidence);
  if (!m) return '.';
  return ` (${m[1]} to ${m[2]}).`;
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
