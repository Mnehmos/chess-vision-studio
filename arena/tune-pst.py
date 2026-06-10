# PST + material Texel tuner.
#
# Replicates the Rust base eval (material x multipliers + tapered Michniewski
# PSTs + bishop pair + tempo) exactly in numpy, verifies parity against the
# Rust faucet, then fits 5 material values + 6x64 MG PSTs + 6x64 EG PSTs
# (EG untied from MG -- the reference reuses MG for non-king EG, which is
# itself headroom) against GAME OUTCOMES with a logistic (Texel) loss.
#
# The promoted rung2 contribution rides along as a fixed per-position offset
# (faucet eval minus replicated base), so tuned weights compose exactly.
#
#   python arena/tune-pst.py [epochs] [l2]
#
# Output: arena/out/pst-tuned.json {material, pstMg, pstEg, K, meta}.
# A separate codegen step turns it into src/eval/pst.rs + base weights JSON.
# UNPROMOTED until the gate stack passes.
import chess
import chess.pgn
import glob
import json
import os
import random
import subprocess
import sys
import tempfile

import numpy as np

random.seed(11)
EXE = os.environ.get('CVS_RUST_EXE', '../chess-vision-studio-rust-engine/target-cand/release/analyze.exe')
BASE_W = 'arena/out/value-weights-mixed.json'
RUNG2_MIXED = 'arena/out/rung2-weights-mixed.json'
RUNG2_ZERO = 'arena/out/rung2-weights-zero.json'
OUT = 'arena/out/pst-tuned.json'
EPOCHS = int(sys.argv[1]) if len(sys.argv) > 1 else 600
L2 = float(sys.argv[2]) if len(sys.argv) > 2 else 0.002

SEE_VALUE = [100, 320, 330, 500, 900]  # P N B R Q (king excluded: cancels)
PHASE = {chess.KNIGHT: 1, chess.BISHOP: 1, chess.ROOK: 2, chess.QUEEN: 4}
MAX_PHASE = 24

PAWN_MG = [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10,
           5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5,
           5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0]
KNIGHT_MG = [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40,
             -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
             -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30,
             -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50]
BISHOP_MG = [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10,
             -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
             -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10,
             -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20]
ROOK_MG = [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5,
           -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
           -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0]
QUEEN_MG = [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10,
            -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
            0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10,
            -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20]
KING_MG = [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
           -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
           -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
           20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20]
KING_EG = [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30,
           -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30,
           -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30,
           -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50]
MG0 = np.array([PAWN_MG, KNIGHT_MG, BISHOP_MG, ROOK_MG, QUEEN_MG, KING_MG], dtype=np.float64)
EG0 = np.array([PAWN_MG, KNIGHT_MG, BISHOP_MG, ROOK_MG, QUEEN_MG, KING_EG], dtype=np.float64)


def table_index(white: bool, sq: int) -> int:
    f, r = chess.square_file(sq), chess.square_rank(sq)
    row = 7 - r if white else r
    return row * 8 + f


def harvest():
    samples, seen = [], set()
    games = 0
    for path in glob.glob('f:/tools/sprt-*.pgn'):
        with open(path, encoding='utf8', errors='ignore') as fh:
            while True:
                g = chess.pgn.read_game(fh)
                if g is None:
                    break
                res = g.headers.get('Result')
                y = {'1-0': 1.0, '0-1': 0.0, '1/2-1/2': 0.5}.get(res)
                if y is None:
                    continue
                games += 1
                board = g.board()
                fens = []
                for i, mv in enumerate(g.mainline_moves()):
                    board.push(mv)
                    if 10 <= i and not board.is_check():
                        fens.append(board.fen())
                hi = len(fens) - 6
                step = max(1, hi // 24)
                for i in range(0, max(hi, 0), step):
                    key = fens[i].split(' ')[0] + fens[i].split(' ')[1]
                    if key not in seen:
                        seen.add(key)
                        samples.append((fens[i], y))
    print(f'harvested {len(samples)} positions from {games} games', flush=True)
    return samples


def encode(fen):
    """Sparse encoding: per (piece,square-index) +/- occupancy split by phase weight."""
    b = chess.Board(fen)
    units = min(sum(PHASE.get(p.piece_type, 0) for p in b.piece_map().values()), MAX_PHASE)
    mgw = units / MAX_PHASE
    egw = 1.0 - mgw
    occ = []  # (piece_idx, table_idx, sign)
    counts = np.zeros(5)
    for sq, p in b.piece_map().items():
        pi = p.piece_type - 1  # P0 N1 B2 R3 Q4 K5
        sign = 1.0 if p.color == chess.WHITE else -1.0
        occ.append((pi, table_index(p.color == chess.WHITE, sq), sign))
        if pi < 5:
            counts[pi] += sign
    wb = len(b.pieces(chess.BISHOP, chess.WHITE)) >= 2
    bb = len(b.pieces(chess.BISHOP, chess.BLACK)) >= 2
    scal = (BP if wb else 0.0) - (BP if bb else 0.0)
    scal += TEMPO if b.turn == chess.WHITE else -TEMPO
    return occ, counts, mgw, egw, scal


def base_eval(occ, counts, mgw, egw, scal, mat, mg, eg):
    s = float(np.dot(counts, mat * np.array(SEE_VALUE, dtype=np.float64)))
    for pi, ti, sign in occ:
        s += sign * (mg[pi, ti] * mgw + eg[pi, ti] * egw)
    return s + scal


def faucet(fens, rung2):
    out = []
    CHUNK = 20000
    for c in range(0, len(fens), CHUNK):
        sl = fens[c:c + CHUNK]
        fp = os.path.join(tempfile.mkdtemp(), 'fens.txt')
        open(fp, 'w').write('\n'.join(sl))
        r = subprocess.run([EXE, '--features', '--depth', '1', '--fens', fp, '--base', BASE_W,
                            '--rung2', rung2], capture_output=True, text=True)
        for line in r.stdout.splitlines():
            line = line.strip()
            if line:
                j = json.loads(line)
                out.append(j.get('evalWhiteCp'))
    return out


def main():
    global BP, TEMPO
    base_w = json.load(open(BASE_W))
    BP = base_w['bishopPair']
    TEMPO = base_w['tempo']
    mat0 = np.array([base_w['material'][k] for k in 'pnbrq'], dtype=np.float64)
    pst_scale = base_w['pstScale']
    mg = MG0 * pst_scale
    eg = EG0 * pst_scale

    samples = harvest()
    fens = [s[0] for s in samples]
    y = np.array([s[1] for s in samples])

    print('encoding...', flush=True)
    enc = [encode(f) for f in fens]

    # Parity: replicated base vs faucet with rung2 zeroed (sample of 300).
    idx = random.sample(range(len(fens)), min(300, len(fens)))
    fz = faucet([fens[i] for i in idx], RUNG2_ZERO)
    worst = 0.0
    for k, i in enumerate(idx):
        if fz[k] is None:
            continue
        mine = base_eval(*enc[i], mat0, mg, eg)
        worst = max(worst, abs(mine - fz[k]))
    print(f'parity check: max |python - faucet(zero rung2)| = {worst:.3f}cp', flush=True)
    assert worst < 1.0, 'replica does not match Rust base eval'

    # rung2 (mixed) contribution as fixed offset.
    fm = faucet(fens, RUNG2_MIXED)
    keep = [i for i in range(len(fens)) if fm[i] is not None and abs(fm[i]) < 1200]
    offs = np.array([fm[i] - base_eval(*enc[i], mat0, mg, eg) for i in keep])
    enc = [enc[i] for i in keep]
    y = y[keep]
    n = len(enc)
    hold = np.array([hash(fens[keep[i]]) % 100 < 15 for i in range(n)])
    print(f'rows {n} (train {int((~hold).sum())} / holdout {int(hold.sum())})', flush=True)

    # Dense design matrices for speed: counts (n,5), occupancy (n,6,64) split mg/eg.
    C = np.zeros((n, 5))
    OMG = np.zeros((n, 6, 64))
    OEG = np.zeros((n, 6, 64))
    SC = np.zeros(n)
    for i, (occ, counts, mgw, egw, scal) in enumerate(enc):
        C[i] = counts
        SC[i] = scal
        for pi, ti, sign in occ:
            OMG[i, pi, ti] += sign * mgw
            OEG[i, pi, ti] += sign * egw
    OMG = OMG.reshape(n, 384)
    OEG = OEG.reshape(n, 384)
    K = 150.0
    see = np.array(SEE_VALUE, dtype=np.float64)

    mat = mat0.copy()
    mgv = mg.reshape(384).copy()
    egv = eg.reshape(384).copy()
    tr = ~hold

    def evals(sel):
        return (C[sel] @ (mat * see)) + OMG[sel] @ mgv + OEG[sel] @ egv + SC[sel] + offs[sel]

    def mse(sel):
        s = 1.0 / (1.0 + np.exp(-evals(sel) / K))
        return float(np.mean((s - y[sel]) ** 2))

    print(f'start  train {mse(tr):.6f}  holdout {mse(hold):.6f}', flush=True)
    lr_pst, lr_mat = 8000.0, 0.0  # material frozen for the first gate
    ntr = int(tr.sum())
    for ep in range(EPOCHS):
        e = evals(tr)
        s = 1.0 / (1.0 + np.exp(-e / K))
        d = 2.0 * (s - y[tr]) * s * (1.0 - s) / K  # dLoss/dEval
        gmat = (C[tr] * see).T @ d / ntr + L2 * (mat - mat0)
        gmg = OMG[tr].T @ d / ntr + L2 * 0.01 * (mgv - mg.reshape(384))
        geg = OEG[tr].T @ d / ntr + L2 * 0.01 * (egv - eg.reshape(384))
        mat -= lr_mat * gmat
        mgv -= lr_pst * gmg
        egv -= lr_pst * geg
        np.clip(mat, 0.5, 1.6, out=mat)
        np.clip(mgv, -120, 120, out=mgv)
        np.clip(egv, -120, 120, out=egv)
        if ep % 50 == 0 or ep == EPOCHS - 1:
            print(f'epoch {ep:4d}  train {mse(tr):.6f}  holdout {mse(hold):.6f}', flush=True)

    json.dump({
        'material': {k: round(float(mat[i]), 4) for i, k in enumerate('pnbrq')},
        'pstMg': {p: [round(float(v), 1) for v in mgv.reshape(6, 64)[i]]
                  for i, p in enumerate(['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'])},
        'pstEg': {p: [round(float(v), 1) for v in egv.reshape(6, 64)[i]]
                  for i, p in enumerate(['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'])},
        'K': K, 'rows': n, 'epochs': EPOCHS, 'l2': L2,
        'holdoutMse': mse(hold), 'trainMse': mse(tr),
        'note': 'PSTs are post-pstScale absolute centipawns; UNPROMOTED',
    }, open(OUT, 'w'), indent=1)
    print(f'wrote {OUT}')
    print('material:', [f'{k}:{mat0[i]:.2f}->{mat[i]:.2f}' for i, k in enumerate('pnbrq')])


main()
