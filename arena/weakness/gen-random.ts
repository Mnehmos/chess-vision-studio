// Geometric random position generator.
//
// Play random legal plies from the start, then KEEP a position only if it is
// "geometrically sound" and stress-relevant:
//   - legal, not game-over, side-to-move NOT in check (quiet),
//   - material within a few pawns (no lopsided junk),
//   - rich in SAFE-QUIET tension: many legal quiet moves whose target square is NOT
//     controlled by the opponent (safe = not-controlled-by-opponent, per the user's
//     correction). Those safe quiet targets ARE the quiet-move candidate set CVS's
//     ordering/eval has to get right — exactly what we want to probe.
//
// This is the chess.js-local realization of "CVS computes safe squares board-wide →
// quiet-move candidates". Wiring the Rust `{cmd:"facts"}` square_control API would
// give the engine's own geometry; this matches the definition and needs no engine.
//
// Run:  GEN_N=40 npx vite-node --script arena/weakness/gen-random.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';

const N = Number(process.env.GEN_N ?? 40);
const OUT = process.env.GEN_OUT ?? 'arena/out/weakness/random-positions.jsonl';
const MIN_SAFE_QUIET = Number(process.env.GEN_MIN_SAFE_QUIET ?? 5);

const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function materialBalance(chess: Chess): number {
  let bal = 0;
  for (const row of chess.board()) for (const sq of row) if (sq) bal += (sq.color === 'w' ? 1 : -1) * VAL[sq.type];
  return bal;
}

/** Quiet moves (non-capture, non-promotion) whose target square the opponent cannot
 *  capture on after the move — i.e. a SAFE quiet improvement exists there. */
function safeQuietTargets(chess: Chess): number {
  const quiets = (chess.moves({ verbose: true }) as Array<{ from: string; to: string; promotion?: string; captured?: string }>)
    .filter((m) => !m.captured && !m.promotion);
  let safe = 0;
  for (const m of quiets) {
    const after = new Chess(chess.fen());
    try {
      after.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch {
      continue;
    }
    if (!(after.moves({ verbose: true }) as Array<{ to: string }>).some((x) => x.to === m.to)) safe++;
  }
  return safe;
}

/** attacked squares immediately around a king = king exposure proxy. */
function kingExposure(chess: Chess, color: 'w' | 'b'): number {
  // find king
  let ksq: string | null = null;
  const files = 'abcdefgh';
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const sq = chess.board()[r][f];
    if (sq && sq.type === 'k' && sq.color === color) ksq = files[f] + (8 - r);
  }
  if (!ksq) return 0;
  const fi = files.indexOf(ksq[0]); const ri = Number(ksq[1]);
  // a square is "attacked by the opponent" if, with the opponent to move, some move targets it.
  const opp = new Chess(chess.fen());
  // flip side to move by editing the FEN (only to probe attacks)
  const parts = chess.fen().split(' '); parts[1] = color === 'w' ? 'b' : 'w'; parts[3] = '-';
  let attackerView: Chess;
  try { attackerView = new Chess(parts.join(' ')); } catch { return 0; }
  const oppTargets = new Set((attackerView.moves({ verbose: true }) as Array<{ to: string }>).map((m) => m.to));
  void opp;
  let exposed = 0;
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
    if (df === 0 && dr === 0) continue;
    const nf = fi + df; const nr = ri + dr;
    if (nf < 0 || nf > 7 || nr < 1 || nr > 8) continue;
    if (oppTargets.has(files[nf] + nr)) exposed++;
  }
  return exposed;
}

function tag(chess: Chess): 'ENDGAME' | 'KING_DEFENSE' | 'QUIET_DEFENSE' | 'POSITIONAL' {
  const pieces = (chess.fen().split(' ')[0].match(/[a-zA-Z]/g) ?? []).length;
  if (pieces < 14) return 'ENDGAME';
  const stm = chess.turn();
  if (kingExposure(chess, stm) >= 2) return 'KING_DEFENSE';
  return safeQuietTargets(chess) >= 8 ? 'QUIET_DEFENSE' : 'POSITIONAL';
}

function tryGenerate(): { name: string; fen: string; tag: string; source: 'random'; safeQuiet: number } | null {
  const chess = new Chess();
  const plies = 12 + Math.floor(Math.random() * 8); // 12..19
  for (let i = 0; i < plies; i++) {
    const ms = chess.moves();
    if (!ms.length) return null;
    chess.move(ms[Math.floor(Math.random() * ms.length)]);
    if (chess.isGameOver()) return null;
  }
  if (chess.isCheck()) return null;
  if (Math.abs(materialBalance(chess)) > 3) return null;
  const sq = safeQuietTargets(chess);
  if (sq < MIN_SAFE_QUIET) return null;
  return { name: `random@${plies}p`, fen: chess.fen(), tag: tag(chess), source: 'random', safeQuiet: sq };
}

function main() {
  mkdirSync('arena/out/weakness', { recursive: true });
  const kept: ReturnType<typeof tryGenerate>[] = [];
  let attempts = 0;
  while (kept.filter(Boolean).length < N && attempts < N * 40) {
    attempts++;
    const p = tryGenerate();
    if (p) kept.push(p);
  }
  const positions = kept.filter(Boolean);
  writeFileSync(OUT, positions.map((p) => JSON.stringify(p)).join('\n') + '\n', 'utf8');
  const byTag = positions.reduce<Record<string, number>>((a, p) => ((a[p!.tag] = (a[p!.tag] ?? 0) + 1), a), {});
  console.log(`generated ${positions.length}/${N} geometrically-sound positions in ${attempts} attempts -> ${OUT}`);
  console.log('by tag:', JSON.stringify(byTag));
  console.log('samples:');
  for (const p of positions.slice(0, 4)) console.log(`  [${p!.tag}] safeQuiet=${p!.safeQuiet}  ${p!.fen}`);
}

main();
