// Generative tactical-motif edge cases. Detectors (geometry/SEE) are cross-
// checked against the INDEPENDENT search oracle (tacticsearch). Where they
// disagree on a clear case, that's a bug — this is the "iterate until pass" net.
import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { findForks, findPinsAndSkewers, findMatesIn1, findRemovalOfGuard, findDiscoveredCheck } from '../motif';
import { tacticalOutcome } from '../tacticsearch';

// ── Fork generator ───────────────────────────────────────────────────────────
// Skeleton: White Ke1 + Nb5 (+pawns); Black Ke8 + Ra8 (+pawns). White's Nc7+
// forks K and rook. We vary the DEFENDER of c7 and an optional White recapturer,
// producing clean forks, poisoned-defender forks, and forker-hangs non-forks.
type Piece = { sq: string; type: 'n' | 'b' | 'r' | 'q' | 'p' };

function buildForkPos(defender?: Piece, recapturer?: Piece): string | null {
  const c = new Chess();
  c.clear();
  const ok =
    c.put({ type: 'k', color: 'w' }, 'e1') &&
    c.put({ type: 'n', color: 'w' }, 'b5') &&
    c.put({ type: 'p', color: 'w' }, 'a2') &&
    c.put({ type: 'p', color: 'w' }, 'h2') &&
    c.put({ type: 'k', color: 'b' }, 'e8') &&
    c.put({ type: 'r', color: 'b' }, 'a8') &&
    c.put({ type: 'p', color: 'b' }, 'a7') &&
    c.put({ type: 'p', color: 'b' }, 'h7');
  if (!ok) return null;
  if (defender && !c.put({ type: defender.type, color: 'b' }, defender.sq as never)) return null;
  if (recapturer && !c.put({ type: recapturer.type, color: 'w' }, recapturer.sq as never))
    return null;
  const fen = c.fen();
  // Legality: must be a valid position, White to move, Nc7+ legal, Black not in check.
  let test: Chess;
  try {
    test = new Chess(fen);
  } catch {
    return null;
  }
  if (test.turn() !== 'w' || test.inCheck()) return null;
  if (!test.moves().includes('Nc7+')) return null;
  return fen;
}

/** Oracle: after the fork move, the forker's net material (mate → huge). */
function oracleForkGain(fen: string, moveSan: string): number {
  const c = new Chess(fen);
  if (!c.move(moveSan)) return 0;
  const out = tacticalOutcome(c.fen(), 6); // opponent to move
  if (out.mateInPlies !== null) return out.mateInPlies < 0 ? 50 : -50;
  return -out.gain; // forker POV
}

function detectorFindsFork(fen: string, moveSan: string): boolean {
  return findForks(fen).motifs.some((m) => m.type === 'fork' && m.line[0] === moveSan);
}

describe('generative — fork poisoned-defender family (detector vs search oracle)', () => {
  // Defenders of c7 (a dark square): bishops/knights/rooks/queen on attacking squares.
  const defenders: (Piece | undefined)[] = [
    undefined, // no defender → clean fork
    { sq: 'a5', type: 'b' },
    { sq: 'd6', type: 'b' },
    { sq: 'e5', type: 'b' },
    { sq: 'f4', type: 'b' },
    { sq: 'g3', type: 'b' },
    { sq: 'd8', type: 'b' },
    { sq: 'a6', type: 'n' },
    { sq: 'd5', type: 'n' },
    { sq: 'e6', type: 'n' },
    { sq: 'c4', type: 'r' },
    { sq: 'c5', type: 'r' },
    { sq: 'c6', type: 'r' },
    { sq: 'b7', type: 'r' },
    { sq: 'd7', type: 'q' },
  ];
  // Optional White recapturer on c1 (turns a defended c7 into a poisoned trap).
  const recapturers: (Piece | undefined)[] = [undefined, { sq: 'c1', type: 'r' }];

  const cases: { fen: string; gain: number }[] = [];
  for (const d of defenders) {
    for (const rc of recapturers) {
      const fen = buildForkPos(d, rc);
      if (!fen) continue;
      cases.push({ fen, gain: oracleForkGain(fen, 'Nc7+') });
    }
  }

  it(`generated ${cases.length >= 0 ? '' : ''}a non-trivial set of fork positions`, () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it('the detector agrees with the oracle on every CLEAR case', () => {
    const disagreements: string[] = [];
    for (const { fen, gain } of cases) {
      const detects = detectorFindsFork(fen, 'Nc7+');
      if (gain >= 2 && !detects) disagreements.push(`MISSED win(+${gain}): ${fen}`);
      if (gain <= 0 && detects) disagreements.push(`FALSE fork(${gain}): ${fen}`);
    }
    if (disagreements.length) console.log('DISAGREEMENTS:\n' + disagreements.join('\n'));
    expect(disagreements).toEqual([]);
  });

  it('the set includes clean forks, forker-hangs negatives, AND poisoned positives', () => {
    const valid = cases.filter((c) => c.gain >= 2).length;
    const invalid = cases.filter((c) => c.gain <= 0).length;
    expect(valid).toBeGreaterThanOrEqual(5); // incl. poisoned rook/queen + Rc1 recaptures
    expect(invalid).toBeGreaterThanOrEqual(8); // forker-hangs look-alikes
  });
});

// ── Manual FEN builder (bypasses chess.js legality so we can pose pure-geometry
//    pin/skewer look-alikes the detector must classify or reject) ─────────────
type Placed = { sq: string; piece: string }; // piece e.g. 'wR', 'bk'
function buildFen(placed: Placed[], turn: 'w' | 'b' = 'w'): string {
  const grid: (string | null)[][] = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const { sq, piece } of placed) {
    const f = sq.charCodeAt(0) - 97;
    const r = sq.charCodeAt(1) - 49;
    const ch = piece[0] === 'w' ? piece[1].toUpperCase() : piece[1].toLowerCase();
    grid[f][r] = ch;
  }
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const c = grid[f][r];
      if (!c) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += c;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${turn} - - 0 1`;
}

const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
/** Expected motif, or null when the meaningfulness filter (back ≥ minor) drops it. */
function expectedPinSkewer(front: string, back: string): string | null {
  if (back === 'k') return 'pin_absolute';
  if (VAL[back] < 3) return null; // skewered over a pawn → noise, not a motif
  if (front === 'k') return 'skewer';
  return VAL[front] > VAL[back] ? 'skewer' : 'pin_relative';
}

// ── Generative pin / skewer along the a-file (rook) ──────────────────────────
describe('generative — pins & skewers (geometry classification)', () => {
  // White Ra1 looks up the a-file at a black FRONT (a4) and BACK (a7) piece.
  const types = ['n', 'b', 'r', 'q', 'p', 'k'];
  const positives: { fen: string; want: string | null }[] = [];
  for (const front of types) {
    for (const back of types) {
      if (front === 'k' && back === 'k') continue; // two kings of one color — skip
      const placed: Placed[] = [
        { sq: 'a1', piece: 'wR' },
        { sq: 'a4', piece: 'b' + front },
        { sq: 'a7', piece: 'b' + back },
        { sq: 'h1', piece: 'wK' },
      ];
      if (front !== 'k' && back !== 'k') placed.push({ sq: 'h8', piece: 'bk' }); // black king elsewhere
      positives.push({ fen: buildFen(placed), want: expectedPinSkewer(front, back) });
    }
  }

  it(`classifies/filters every aligned (front,back) pair correctly (${positives.length} cases)`, () => {
    const wrong: string[] = [];
    for (const { fen, want } of positives) {
      const got = findPinsAndSkewers(fen, 'b').motifs.map((m) => m.type);
      if (want === null) {
        if (got.length > 0) wrong.push(`expected none, got [${got}] :: ${fen}`);
      } else if (!got.includes(want as never)) {
        wrong.push(`${want} not in [${got}] :: ${fen}`);
      }
    }
    if (wrong.length) console.log('PIN/SKEWER WRONG:\n' + wrong.join('\n'));
    expect(wrong).toEqual([]);
  });

  it('rejects look-alikes: a blocker breaks the line; nothing behind the front', () => {
    // Blocker (own black pawn a5) between front a4 and back a7 → NOT a pin.
    const blocked = buildFen([
      { sq: 'a1', piece: 'wR' },
      { sq: 'a4', piece: 'bn' },
      { sq: 'a5', piece: 'bp' },
      { sq: 'a7', piece: 'bk' },
      { sq: 'h1', piece: 'wK' },
    ]);
    expect(findPinsAndSkewers(blocked, 'b').motifs).toHaveLength(0);

    // Nothing behind the front knight → just an attack, not a pin.
    const nothingBehind = buildFen([
      { sq: 'a1', piece: 'wR' },
      { sq: 'a4', piece: 'bn' },
      { sq: 'h8', piece: 'bk' },
      { sq: 'h1', piece: 'wK' },
    ]);
    expect(findPinsAndSkewers(nothingBehind, 'b').motifs).toHaveLength(0);

    // A WHITE blocker first (own piece in front) → the ray is the slider's own.
    const ownInFront = buildFen([
      { sq: 'a1', piece: 'wR' },
      { sq: 'a4', piece: 'wp' },
      { sq: 'a7', piece: 'bk' },
      { sq: 'h8', piece: 'bk' },
      { sq: 'h1', piece: 'wK' },
    ]);
    expect(findPinsAndSkewers(ownInFront, 'b').motifs).toHaveLength(0);
  });

  // Horizontal rook pins/skewers along rank 4 (third ray geometry).
  it('classifies horizontal rook pins/skewers (12 cases)', () => {
    const wrong: string[] = [];
    const pairs: [string, string][] = [
      ['n', 'k'], ['b', 'k'], ['r', 'k'], ['p', 'k'], ['q', 'k'],
      ['q', 'r'], ['r', 'n'], ['q', 'b'],
      ['n', 'q'], ['b', 'r'],
      ['n', 'p'], ['r', 'p'], // back pawn → filtered
    ];
    for (const [front, back] of pairs) {
      const placed: Placed[] = [
        { sq: 'a4', piece: 'wR' },
        { sq: 'd4', piece: 'b' + front },
        { sq: 'g4', piece: 'b' + back },
        { sq: 'a1', piece: 'wK' },
      ];
      if (front !== 'k' && back !== 'k') placed.push({ sq: 'a8', piece: 'bk' });
      const fen = buildFen(placed);
      const want = expectedPinSkewer(front, back);
      const got = findPinsAndSkewers(fen, 'b').motifs.map((m) => m.type);
      if (want === null ? got.length > 0 : !got.includes(want as never))
        wrong.push(`${front}/${back} want ${want} got [${got}]`);
    }
    if (wrong.length) console.log('HORIZ WRONG:\n' + wrong.join('\n'));
    expect(wrong).toEqual([]);
  });

  // Diagonal bishop pins/skewers (a different ray geometry).
  it('classifies diagonal bishop pins/skewers (10 cases)', () => {
    const wrong: string[] = [];
    const pairs: [string, string][] = [
      ['n', 'k'], // pin_absolute
      ['b', 'k'],
      ['r', 'k'],
      ['p', 'k'],
      ['q', 'r'], // skewer (q>r)
      ['r', 'n'], // skewer (r>n)
      ['n', 'q'], // relative pin (n<q)
      ['b', 'r'], // relative pin (b<r)
      ['n', 'p'], // back pawn → filtered (null)
      ['r', 'p'], // back pawn → filtered (null)
    ];
    for (const [front, back] of pairs) {
      // White Bc1 → e3(front) → g5(back) diagonal.
      const placed: Placed[] = [
        { sq: 'c1', piece: 'wB' },
        { sq: 'e3', piece: 'b' + front },
        { sq: 'g5', piece: 'b' + back },
        { sq: 'a1', piece: 'wK' },
      ];
      if (front !== 'k' && back !== 'k') placed.push({ sq: 'a8', piece: 'bk' });
      const fen = buildFen(placed);
      const want = expectedPinSkewer(front, back);
      const got = findPinsAndSkewers(fen, 'b').motifs.map((m) => m.type);
      if (want === null ? got.length > 0 : !got.includes(want as never))
        wrong.push(`${front}/${back} want ${want} got [${got}]`);
    }
    if (wrong.length) console.log('DIAG WRONG:\n' + wrong.join('\n'));
    expect(wrong).toEqual([]);
  });
});

// ── Generative discovered check (rook behind a moving knight) ─────────────────
describe('generative — discovered check', () => {
  function buildDisco(knightSq: string, extra: Placed[] = []): string {
    return buildFen(
      [
        { sq: 'e1', piece: 'wR' },
        { sq: knightSq, piece: 'wN' },
        { sq: 'e8', piece: 'bk' },
        { sq: 'h1', piece: 'wK' },
        { sq: 'a2', piece: 'wp' },
        { sq: 'a7', piece: 'bp' },
        ...extra,
      ],
      'w',
    );
  }
  function play(fen: string, san: string): string | null {
    const c = new Chess(fen);
    return c.move(san) ? c.fen() : null;
  }

  it('a knight stepping off the e-file uncovers the rook check (6 cases)', () => {
    const before = buildDisco('e4');
    // knight moves that do NOT themselves check e8 and stay legal
    const escapes = ['Nc3', 'Nc5', 'Nd2', 'Nf2', 'Ng3', 'Ng5'];
    const missed: string[] = [];
    for (const san of escapes) {
      const after = play(before, san);
      if (!after) {
        missed.push(`illegal ${san}`);
        continue;
      }
      const found = findDiscoveredCheck(before, after).motifs.some((m) => m.type === 'discovered_check');
      if (!found) missed.push(`no discovered_check after ${san}`);
    }
    if (missed.length) console.log('DISCO MISSED:\n' + missed.join('\n'));
    expect(missed).toEqual([]);
  });

  it('rejects look-alikes: still-blocked line, and a slider not aimed at the king', () => {
    // A second white blocker (pawn e2) → moving the knight does NOT uncover check.
    const blocked = buildDisco('e4', [{ sq: 'e2', piece: 'wp' }]);
    const afterBlocked = play(blocked, 'Nc3')!;
    expect(findDiscoveredCheck(blocked, afterBlocked).motifs).toHaveLength(0);

    // Rook on a1 (not aimed at e8) → no discovered check.
    const notAimed = buildFen(
      [
        { sq: 'a1', piece: 'wR' },
        { sq: 'e4', piece: 'wN' },
        { sq: 'e8', piece: 'bk' },
        { sq: 'h1', piece: 'wK' },
        { sq: 'a2', piece: 'wp' },
        { sq: 'h7', piece: 'bp' },
      ],
      'w',
    );
    const afterNotAimed = play(notAimed, 'Nc3')!;
    expect(findDiscoveredCheck(notAimed, afterNotAimed).motifs).toHaveLength(0);
  });
});

// ── Curated removal-of-guard & back-rank edge cases ──────────────────────────
describe('curated — removal of guard', () => {
  const play = (fen: string, san: string) => {
    const c = new Chess(fen);
    c.move(san);
    return c.fen();
  };
  const positives: [string, string][] = [
    // [fen, capturing move]; after the move the guarded piece is SEE-losing.
    ['4k3/8/2n5/4b3/8/8/8/2R1R1K1 w - - 0 1', 'Rxc6'], // c6 knight guards e5; removed
    ['4k3/8/6n1/4b3/8/8/8/4R1RK w - - 0 1', 'Rxg6'], // g6 knight guards e5; removed
  ];
  const negatives: [string, string][] = [
    ['4k3/8/2n3n1/4b3/8/8/8/2R1R1K1 w - - 0 1', 'Rxc6'], // second guard g6 remains
  ];
  it('fires only when a sole guard disappears and the piece becomes SEE-losing', () => {
    for (const [fen, san] of positives) {
      const found = findRemovalOfGuard(fen, play(fen, san)).motifs.some(
        (m) => m.type === 'removal_of_guard',
      );
      expect(found).toBe(true);
    }
    for (const [fen, san] of negatives) {
      const found = findRemovalOfGuard(fen, play(fen, san)).motifs.some(
        (m) => m.type === 'removal_of_guard',
      );
      expect(found).toBe(false);
    }
  });
});

describe('curated — back-rank mate vs luft', () => {
  const mates: string[] = [
    '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', // Re8#
    '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', // Ra8#
    '6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1', // Rd8#
  ];
  const luft: string[] = [
    '6k1/5pp1/7p/8/8/8/8/4R1K1 w - - 0 1', // …h6 luft, not mate
    '6k1/5p1p/6p1/8/8/8/8/4R1K1 w - - 0 1', // …g6 luft
  ];
  it('detects real back-rank mates and rejects luft positions', () => {
    for (const fen of mates) {
      expect(findMatesIn1(fen).motifs.some((m) => m.type === 'back_rank')).toBe(true);
    }
    for (const fen of luft) {
      expect(findMatesIn1(fen).motifs).toHaveLength(0);
    }
  });
});
