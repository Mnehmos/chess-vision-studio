// Annotation graph for the inspected square. CASCADE: surface not just the
// selected piece's direct relations, but the next hop in the chain — so when a
// piece is under attack you also see who defends it, and when you attack a piece
// you see how well it's defended (the "call and response" of an exchange).
import { Chess } from 'chess.js';
import { buildRelationMap } from '../engine/relations';
import type { InsightCandidate, Square } from '../engine/types';
import { ARROW, type Arrow } from './BoardArrows';

const sqOfId = (id: string) => id.slice(2) as Square;

/**
 * Arrows for a selected square:
 *   • RED   incoming — pieces attacking the selection
 *   • GREEN incoming — pieces defending the selection
 *   • RED   outgoing — what the selection itself attacks (raycast)
 *   • CASCADE (dashed): for every piece in the chain, its own defenders, and for
 *     every square the selection attacks, that square's defenders (the response).
 */
export function selectionArrows(fen: string, selected: Square, cascade = true): Arrow[] {
  const rel = buildRelationMap(fen);
  const selRel = rel.bySquare[selected];
  if (!selRel) return [];
  const selColor = selRel.piece[0];
  const selId = selRel.piece + selected;

  const out: Arrow[] = [];
  const seen = new Set<string>();
  const add = (from: Square, to: Square, color: string, dashed = false) => {
    const key = `${from}>${to}:${color}:${dashed ? 'd' : 's'}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ from, to, color, dashed });
  };

  // Level 1 — direct relations of the selection.
  for (const id of selRel.defendedBy) add(sqOfId(id), selected, ARROW.defend);
  for (const id of selRel.attackedBy) add(sqOfId(id), selected, ARROW.attack);

  // Level 1 — what the selection itself ATTACKS (enemy pieces, red outgoing) and
  // what it DEFENDS among CONTESTED friendly pieces (green outgoing). A queen's
  // protection of an attacked pawn is surfaced; idle defenses are not (noise).
  const attackTargets: Square[] = [];
  const defendTargets: Square[] = [];
  for (const sq of Object.keys(rel.bySquare)) {
    const r = rel.bySquare[sq];
    if (sq === selected) continue;
    if (r.piece[0] !== selColor && r.attackedBy.includes(selId)) {
      add(selected, sq as Square, ARROW.attack);
      attackTargets.push(sq as Square);
    } else if (r.piece[0] === selColor && r.defendedBy.includes(selId) && r.attackedBy.length > 0) {
      add(selected, sq as Square, ARROW.defend); // you defend this CONTESTED piece
      defendTargets.push(sq as Square);
    }
  }

  if (cascade) {
    // Squares the selection attacks → surface their defenders (the response).
    for (const t of attackTargets) {
      for (const id of rel.bySquare[t]?.defendedBy ?? []) add(sqOfId(id), t, ARROW.defend, true);
    }
    // Contested pieces the selection defends → surface the FULL battle on them:
    // their attackers (red) and their other defenders (green).
    for (const t of defendTargets) {
      for (const id of rel.bySquare[t]?.attackedBy ?? []) add(sqOfId(id), t, ARROW.attack, true);
      for (const id of rel.bySquare[t]?.defendedBy ?? [])
        if (sqOfId(id) !== selected) add(sqOfId(id), t, ARROW.defend, true);
    }
    // Attackers of the selection → surface their own defenders (recapture chain).
    for (const id of selRel.attackedBy) {
      const aSq = sqOfId(id);
      for (const did of rel.bySquare[aSq]?.defendedBy ?? []) add(sqOfId(did), aSq, ARROW.defend, true);
    }
  }

  return out;
}

/** Replay an insight's forcing line into numbered tactical arrows (1·2·3…). */
export function lineArrows(fen: string, ins: InsightCandidate, dashed: boolean): Arrow[] {
  const out: Arrow[] = [];
  const line = ins.kind === 'motif' ? ins.line : [];
  if (line.length) {
    const c = new Chess(fen);
    line.slice(0, 6).forEach((san, i) => {
      let m: ReturnType<Chess['move']> | null = null;
      try {
        m = c.move(san);
      } catch {
        m = null;
      }
      if (m) out.push({ from: m.from, to: m.to, color: ARROW.tactical, label: String(i + 1), dashed });
    });
  } else {
    for (const [from, to] of ins.arrows) out.push({ from, to, color: ARROW.attack, dashed });
  }
  return out;
}
