// [8/9] Mode-scoped color + LED export. Each mode OWNS its color language
// (Invariant 6): one square holds one meaning at a time, so every mode reduces
// to a 64-square LedMap. The React board and the LED twin render the SAME map.
import { Chess } from 'chess.js';
import { buildRelationMap } from './relations';
import { seeOnSquare, occupationLoss } from './see';
import { detectAvailableMotifs } from './motif';
import { parseFen, allPieces, fileOf, attackersOf } from './board';
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
  // Hanging (SEE) detail level: 'full' (default) shows every contested square
  // including standoffs and merely-pressured pieces; 'focused' shows only squares
  // where material is actually at stake (a side wins points).
  seeDetail?: 'full' | 'focused';
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
  // Mark the ORIGIN — the piece about to move — distinctly (blue), so both the
  // board and the LED twin show where it sits, not just where it can go.
  map.squares[ctx.selectedSquare] = 'blue';
  return map;
}

// ── Threat Map — BOTH sides at once. White's control = blue, Black's = red,
//    contested (both) = purple. Opacity graduates by how many pieces hold the
//    square (intensity), so a single-controlled square reads faint and a hotly
//    contested one reads strong — no flat wall of colour. King-zone squares are
//    NOT singled out: the control heat already shows where pressure converges.
function threatMode(ctx: LedContext): LedMap {
  const map = blankMap('threat');
  map.intensity = {};
  const board = parseFen(ctx.fen);
  for (const sq of allSquares()) {
    const wn = attackersOf(board, sq, 'w').length;
    const bn = attackersOf(board, sq, 'b').length;
    if (wn && bn) {
      map.squares[sq] = 'purple';
      map.intensity[sq] = Math.max(wn, bn);
    } else if (wn) {
      map.squares[sq] = 'blue'; // White's base colour
      map.intensity[sq] = wn;
    } else if (bn) {
      map.squares[sq] = 'red'; // Black's base colour
      map.intensity[sq] = bn;
    }
  }
  return map;
}

// ── Defense Map — BOTH sides at once, each with its OWN scheme:
//    White: blue = defended, yellow = loose.   Black: green = defended, orange = loose.
function defenseMode(ctx: LedContext): LedMap {
  const map = blankMap('defense');
  const rel = buildRelationMap(ctx.fen);
  for (const sq of Object.keys(rel.bySquare)) {
    const r = rel.bySquare[sq];
    const defended = r.defendedBy.length > 0;
    if (r.piece[0] === 'w') map.squares[sq] = defended ? 'blue' : 'yellow';
    else map.squares[sq] = defended ? 'green' : 'orange';
  }
  return map;
}

// ── Hanging (SEE) — rendered as RINGS + badges (not fills), so it reads at a
//    glance and several can coexist without a wall of colour. Colour follows WHO
//    BENEFITS, using the side language (blue = White advantage, red = Black).
//    For an OCCUPIED piece the badge is the MATERIAL outcome in points from a
//    full SEE (e.g. "+6" for winning a queen for a knight) — NOT a piece count,
//    because a "1 vs 1" capture can be wildly unequal in value. A piece that is
//    attacked but holds materially gets a soft pressure ring with no number
//    (orange = more attackers than defenders, yellow = adequately defended).
//    EMPTY squares one side floods are ringed by the controlling side with a
//    control COUNT badge ("3v1") — there's no material there, only control.
function hangingMode(ctx: LedContext): LedMap {
  const map = blankMap('hanging');
  map.badges = {};
  const rel = buildRelationMap(ctx.fen);
  const board = parseFen(ctx.fen);
  for (const p of allPieces(board)) {
    const r = rel.bySquare[p.square];
    const swing = seeOnSquare(ctx.fen, p.square).swing;
    const attackers = r?.attackedBy.length ?? 0;
    const defenders = r?.defendedBy.length ?? 0;
    if (attackers === 0) continue; // a safe piece gets no ring
    if (swing > 0) {
      // Capturing wins material — colour by the WINNER (the capturer = enemy of
      // this piece) and badge the POINTS won, so a queen taken for a knight reads
      // "+6 (White)" rather than a meaningless "1v1".
      const winner = other(p.color);
      map.squares[p.square] = winner === 'w' ? 'blue' : 'red';
      map.badges[p.square] = '+' + swing;
    } else if (attackers > defenders) {
      map.squares[p.square] = 'orange'; // more attackers than defenders, but SEE-safe
      map.badges[p.square] = '0'; // neutral material — nothing won by capturing
    } else {
      map.squares[p.square] = 'yellow'; // attacked but adequately defended
      map.badges[p.square] = '0'; // neutral material
    }
  }
  // Empty squares that BOTH sides fight over — valued by a full Static Exchange
  // Evaluation, no heuristics. For each side, occupationLoss() runs the entire
  // capture stack and returns what that side LOSES by occupying the square (0 =
  // can occupy safely). The side that can occupy safely while the other cannot
  // controls it; the badge is the POINTS THE LOSER FORFEITS if it contests. If
  // both can occupy safely (shared) or neither can (no-man's-land) it is a true
  // contested standoff. Only squares both sides attack are shown — one-sided
  // control is the Threat Map's job, not a material question.
  const cap = (n: number) => Math.min(n, 9); // king (≈1000) reads as mate-level
  for (const sq of allSquares()) {
    const [f, r] = [sq.charCodeAt(0) - 97, sq.charCodeAt(1) - 49];
    if (board.grid[f][r]) continue; // occupied squares handled above
    const wn = attackersOf(board, sq, 'w').length;
    const bn = attackersOf(board, sq, 'b').length;
    if (wn === 0 || bn === 0) continue; // need a real two-sided contest

    // occupationLoss: 0 = can hold the square safely, >0 = loses that much by
    // contesting, null = no real (non-king) support at all → cannot hold it.
    const lossW = occupationLoss(board, sq, 'w');
    const lossB = occupationLoss(board, sq, 'b');
    const wSafe = lossW === 0;
    const bSafe = lossB === 0;
    if (wSafe && !bSafe) {
      map.squares[sq] = 'blue'; // only White can hold the square
      map.badges[sq] = '+' + cap(lossB ?? 9); // Black forfeits this if it contests (null = mate-level)
    } else if (bSafe && !wSafe) {
      map.squares[sq] = 'red'; // only Black can hold the square
      map.badges[sq] = '+' + cap(lossW ?? 9);
    } else {
      map.squares[sq] = 'purple'; // shared (both safe) or no-man's-land (neither holds)
      map.badges[sq] = '0'; // neutral — no material swings on this square
    }
  }

  // Focused view — PIECE analysis only: keep every ring on an occupied square
  // (its full SEE picture, pressure rings included — a hanging/under-defended
  // piece matters more than empty-square control) and drop the empty-square
  // contested analysis. Full view keeps both.
  if (ctx.seeDetail === 'focused') {
    for (const sq of allSquares()) {
      if (map.squares[sq] === 'off') continue;
      const [f, r] = [sq.charCodeAt(0) - 97, sq.charCodeAt(1) - 49];
      if (!board.grid[f][r]) {
        map.squares[sq] = 'off'; // empty square — hidden in the focused (pieces) view
        if (map.badges) delete map.badges[sq];
      }
    }
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

