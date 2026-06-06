// [8/9] Mode-scoped color + LED export. Each mode OWNS its color language
// (Invariant 6): one square holds one meaning at a time, so every mode reduces
// to a 64-square LedMap. The React board and the LED twin render the SAME map.
import { Chess } from 'chess.js';
import { buildRelationMap } from './relations';
import { seeOnSquare } from './see';
import { detectAvailableMotifs } from './motif';
import { parseFen, allPieces, fileOf } from './board';
import type { LedColor, LedMap, MoveAnalysis, Square } from './types';

export type ModeId =
  | 'legal'
  | 'threat'
  | 'defense'
  | 'hanging'
  | 'what_changed'
  | 'pawn'
  | 'tactics';

export interface LedContext {
  fen: string;
  selectedSquare?: Square;
  analysis?: MoveAnalysis; // required for 'what_changed'
}

const FILES = 'abcdefgh';
const RANKS = '12345678';
export function allSquares(): Square[] {
  const out: Square[] = [];
  for (const f of FILES) for (const r of RANKS) out.push(f + r);
  return out;
}

function blankMap(mode: ModeId): LedMap {
  const squares: Record<Square, LedColor> = {};
  for (const sq of allSquares()) squares[sq] = 'off';
  return { mode, squares };
}

export function computeLedMap(mode: ModeId, ctx: LedContext): LedMap {
  switch (mode) {
    case 'legal':
      return legalMode(ctx);
    case 'threat':
      return threatMode(ctx);
    case 'defense':
      return defenseMode(ctx);
    case 'hanging':
      return hangingMode(ctx);
    case 'what_changed':
      return whatChangedMode(ctx);
    case 'pawn':
      return pawnMode(ctx);
    case 'tactics':
      return tacticsMode(ctx);
  }
}

const other = (c: 'w' | 'b') => (c === 'w' ? 'b' : 'w');

// ── Legal Move — green=quiet, red=capture, yellow=check, purple=tactical ─────
function legalMode(ctx: LedContext): LedMap {
  const map = blankMap('legal');
  if (!ctx.selectedSquare) return map;
  const board = parseFen(ctx.fen);
  const piece = board.grid[ctx.selectedSquare.charCodeAt(0) - 97][ctx.selectedSquare.charCodeAt(1) - 49];
  if (!piece) return map;

  // The piece may belong to the side that just moved (not the side to move) —
  // chess.moves() only lists the side-to-move's moves, so flip the turn to show
  // where THIS piece can go. Falls back to the raw FEN if the flip is illegal.
  let movesFen = ctx.fen;
  if (piece.color !== board.turn) {
    const parts = ctx.fen.trim().split(/\s+/);
    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    parts[3] = '-'; // clear en-passant after a hypothetical turn flip
    movesFen = parts.join(' ');
  }
  let chess: Chess;
  try {
    chess = new Chess(movesFen);
  } catch {
    chess = new Chess(ctx.fen);
  }
  const moves = chess.moves({ square: ctx.selectedSquare as never, verbose: true }) as Array<{
    to: string;
    san: string;
    flags: string;
  }>;
  const motifFirsts = new Set(detectAvailableMotifs(ctx.fen).motifs.map((m) => m.line[0]));
  for (const m of moves) {
    let color: LedColor = 'green';
    if (m.flags.includes('c') || m.flags.includes('e')) color = 'red';
    if (m.san.includes('+') || m.san.includes('#')) color = 'yellow';
    if (motifFirsts.has(m.san)) color = 'purple'; // a tactical candidate
    map.squares[m.to] = color;
  }
  return map;
}

// ── Threat Map — red=opp attacks, blue=you control, purple=contested, dark_red=king danger
function threatMode(ctx: LedContext): LedMap {
  const map = blankMap('threat');
  const rel = buildRelationMap(ctx.fen);
  const you = parseFen(ctx.fen).turn;
  const youSet = new Set(you === 'w' ? rel.controlledByWhite : rel.controlledByBlack);
  const oppSet = new Set(you === 'w' ? rel.controlledByBlack : rel.controlledByWhite);
  for (const sq of allSquares()) {
    const byYou = youSet.has(sq);
    const byOpp = oppSet.has(sq);
    if (byYou && byOpp) map.squares[sq] = 'purple';
    else if (byOpp) map.squares[sq] = 'red';
    else if (byYou) map.squares[sq] = 'blue';
  }
  // King danger: squares around YOUR king controlled by the opponent.
  const board = parseFen(ctx.fen);
  const king = allPieces(board).find((p) => p.color === you && p.type === 'k');
  if (king) {
    for (const sq of adjacent(king.square)) {
      if (oppSet.has(sq)) map.squares[sq] = 'dark_red';
    }
  }
  return map;
}

// ── Defense Map — blue=defended, yellow=undefended, orange=sole/critical guard ─
function defenseMode(ctx: LedContext): LedMap {
  const map = blankMap('defense');
  const rel = buildRelationMap(ctx.fen);
  const you = parseFen(ctx.fen).turn;
  // Which pieces are the SOLE defender of some friendly piece?
  const criticalGuards = new Set<string>();
  for (const sq of Object.keys(rel.bySquare)) {
    const r = rel.bySquare[sq];
    if (r.piece[0] === you && r.defendedBy.length === 1) {
      criticalGuards.add(r.defendedBy[0]); // the guarding PieceId
    }
  }
  for (const sq of Object.keys(rel.bySquare)) {
    const r = rel.bySquare[sq];
    if (r.piece[0] !== you) continue;
    const myId = r.piece + sq; // wN + e5 → wNe5
    if (criticalGuards.has(myId)) map.squares[sq] = 'orange';
    else if (r.defendedBy.length > 0) map.squares[sq] = 'blue';
    else map.squares[sq] = 'yellow';
  }
  return map;
}

// ── Hanging (SEE) — yellow=loose, orange=fragile, red=SEE-losing, red_blink=Q/mate
function hangingMode(ctx: LedContext): LedMap {
  const map = blankMap('hanging');
  const rel = buildRelationMap(ctx.fen);
  const board = parseFen(ctx.fen);
  for (const p of allPieces(board)) {
    const r = rel.bySquare[p.square];
    const swing = seeOnSquare(ctx.fen, p.square).swing;
    const attacked = (r?.attackedBy.length ?? 0) > 0;
    const defenders = r?.defendedBy.length ?? 0;
    const attackers = r?.attackedBy.length ?? 0;
    if (swing >= 9) map.squares[p.square] = 'red_blink'; // queen-level loss
    else if (swing > 0) map.squares[p.square] = 'red'; // SEE-losing
    else if (attacked) map.squares[p.square] = defenders <= attackers ? 'orange' : 'yellow';
  }
  return map;
}

// ── What Changed — driven by the ranked insights of THIS ply's MoveAnalysis ──
function whatChangedMode(ctx: LedContext): LedMap {
  const map = blankMap('what_changed');
  const a = ctx.analysis;
  if (!a) return map;
  // Paint low→high saliency so the headline insight wins ties.
  const ordered = [...a.rankedInsights].sort((x, y) => x.saliency - y.saliency);
  for (const ins of ordered) {
    const color = changeColor(ins.kind === 'motif' ? 'motif' : ins.type);
    for (const sq of ins.squares) map.squares[sq] = color;
  }
  return map;
}

function changeColor(type: string): LedColor {
  switch (type) {
    case 'now_defended':
      return 'green';
    case 'now_undefended':
      return 'yellow';
    case 'now_see_losing':
    case 'mate_threat':
    case 'check_created':
    case 'refutation_wins_material':
      return 'red';
    case 'motif':
      return 'orange'; // a new opportunity / tactic
    case 'defender_left':
    case 'piece_captured':
    case 'line_closed':
      return 'gray';
    default:
      return 'blue';
  }
}

// ── Pawn Structure — one color per category (single meaning) ──────────────────
function pawnMode(ctx: LedContext): LedMap {
  const map = blankMap('pawn');
  const board = parseFen(ctx.fen);
  const pawns = allPieces(board).filter((p) => p.type === 'p');
  const fileHas = (color: 'w' | 'b', file: number) =>
    pawns.some((p) => p.color === color && fileOf(p.square) === file);
  for (const p of pawns) {
    const f = fileOf(p.square);
    const own = (file: number) => fileHas(p.color, file);
    const isolated = !own(f - 1) && !own(f + 1);
    const doubled = pawns.filter((q) => q.color === p.color && fileOf(q.square) === f).length > 1;
    const enemy = other(p.color);
    const passed =
      !fileHas(enemy, f) && !fileHas(enemy, f - 1) && !fileHas(enemy, f + 1); // simplified
    if (passed) map.squares[p.square] = 'green';
    else if (isolated) map.squares[p.square] = 'red';
    else if (doubled) map.squares[p.square] = 'yellow';
    else map.squares[p.square] = 'blue';
  }
  return map;
}

// ── Tactics (Motif) — purple=executor, orange=targets, gray=line; only if ≥1 ──
function tacticsMode(ctx: LedContext): LedMap {
  const map = blankMap('tactics');
  const { motifs } = detectAvailableMotifs(ctx.fen);
  if (motifs.length === 0) return map; // shown ONLY when ≥1 motif is proven
  for (const m of motifs) {
    const execSq = m.byPiece.length >= 3 ? m.byPiece.slice(2) : m.squares[0];
    if (execSq) map.squares[execSq] = 'purple';
    for (const t of m.squares.slice(1)) {
      if (map.squares[t] === 'off') map.squares[t] = 'orange';
    }
  }
  return map;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function adjacent(square: Square): Square[] {
  const f = fileOf(square);
  const r = square.charCodeAt(1) - 49;
  const out: Square[] = [];
  for (let df = -1; df <= 1; df++)
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const nf = f + df;
      const nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8)
        out.push(String.fromCharCode(97 + nf) + String.fromCharCode(49 + nr));
    }
  return out;
}
