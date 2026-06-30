# NNUE gen-1 trainer.
#
# Net: 768 sparse inputs (12 piece-planes x 64 squares, side-to-move
# perspective: board mirrored + colors swapped when black to move) ->
# HIDDEN clipped-ReLU -> 1, output in centipawns (stm POV).
#
# Labels from JSONL {fen, cp (white POV), res
# (white result)}: target = LAMBDA * sigmoid(cp/K) + (1-LAMBDA) * result,
# loss = MSE(sigmoid(pred/K), target). Everything converted to stm POV.
#
#   python arena/train-nnue.py data.jsonl [--rows N] [--epochs E] [--out net.json]
#
# Output: JSON with float weights + quantization scales for the Rust loader.
# UNPROMOTED until node-speed + SPRT gates pass.
import json
import os
import sys
import time

import numpy as np
import torch
import torch.nn as nn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_split_guard as ssg  # noqa: E402  (#33 deterministic seeding)

DATA = sys.argv[1] if len(sys.argv) > 1 else 'f:/tools/nnue-data-gen1.jsonl'


def arg(flag, dflt):
    return type(dflt)(sys.argv[sys.argv.index(flag) + 1]) if flag in sys.argv else dflt


MAX_ROWS = arg('--rows', 100_000_000)
EPOCHS = arg('--epochs', 12)
OUT = arg('--out', 'arena/out/nnue-gen1.json')
K = 256.0
LAMBDA = arg('--lambda', 0.6)  # 1.0 = pure-eval target (result-less corpora)
HIDDEN = arg('--hidden', 128)
BATCH = 16384
SEED = arg('--seed', 0)                       # #33: deterministic, reproducible artifacts
DETERMINISTIC = '--deterministic' in sys.argv  # also pin cuDNN determinism
# #33: this slice has only the single-corpus row-level (% 50) holdout, which LEAKS sources across
# train/holdout. Refuse it as promotion-eligible — require an explicit ack that the artifact is a
# NON-PROMOTABLE dev run. (Promotion-eligible training from a verified --train/--validation split is
# slice 2; pre-flight gate: arena/verify-split.py.)
ALLOW_UNSAFE = '--allow-unsafe-row-split' in sys.argv
DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'

# ---- FEN -> (feature indices stm-POV, cp_stm, target_result_stm) ----
PIECE_IDX = {'P': 0, 'N': 1, 'B': 2, 'R': 3, 'Q': 4, 'K': 5,
             'p': 6, 'n': 7, 'b': 8, 'r': 9, 'q': 10, 'k': 11}


def encode(fen, cp_white, res_white):
    board, stm = fen.split(' ')[0], fen.split(' ')[1]
    white_to_move = stm == 'w'
    idx = []
    sq = 56  # FEN starts at a8 = LERF 56
    for ch in board:
        if ch == '/':
            sq -= 16
        elif ch.isdigit():
            sq += int(ch)
        else:
            p = PIECE_IDX[ch]
            s = sq
            if not white_to_move:
                # mirror vertically + swap colors -> stm perspective
                p = (p + 6) % 12
                s = sq ^ 56
            idx.append(p * 64 + s)
            sq += 1
    cp = cp_white if white_to_move else -cp_white
    res = res_white if white_to_move else 1.0 - res_white
    return idx, cp, res


def load(path, max_rows):
    feats, lens, cps, ress = [], [], [], []
    t0 = time.time()
    with open(path, encoding='utf8') as fh:
        for i, line in enumerate(fh):
            if i >= max_rows:
                break
            try:
                j = json.loads(line)
                cp = j.get('cp', j.get('sfCp'))
                mate = j.get('mate', j.get('sfMate'))
                if mate is not None:
                    cp = 10000 if mate > 0 else -10000
                elif cp is None:
                    continue
                idx, cp, res = encode(j['fen'], cp, j['res'])
            except Exception:
                continue
            feats.append(idx)
            lens.append(len(idx))
            cps.append(cp)
            ress.append(res)
    n = len(feats)
    maxlen = max(lens)
    F = np.full((n, maxlen), -1, dtype=np.int64)
    for i, idx in enumerate(feats):
        F[i, :len(idx)] = idx
    print(f'loaded {n} rows (maxlen {maxlen}) in {time.time()-t0:.0f}s', flush=True)
    return F, np.array(cps, dtype=np.float32), np.array(ress, dtype=np.float32)


class Net(nn.Module):
    def __init__(self):
        super().__init__()
        # +1 padding row at index 768 for the -1 (empty) slots.
        self.embed = nn.EmbeddingBag(769, HIDDEN, mode='sum', padding_idx=768)
        self.b1 = nn.Parameter(torch.zeros(HIDDEN))
        self.out = nn.Linear(HIDDEN, 1)
        nn.init.normal_(self.embed.weight, std=0.05)
        self.embed.weight.data[768].zero_()

    def forward(self, f):
        h = torch.clamp(self.embed(f) + self.b1, 0.0, 1.0)
        return self.out(h).squeeze(-1) * 400.0  # cp scale


def main():
    print(f'seed: {ssg.seed_everything(SEED, deterministic=DETERMINISTIC)}', flush=True)
    if not ALLOW_UNSAFE:
        raise SystemExit(
            'REFUSED: this trainer slice uses a single unsplit corpus with a row-level (% 50) holdout '
            'that LEAKS sibling positions from the same game across train/holdout — its artifact is '
            'NOT promotion-eligible. Pass --allow-unsafe-row-split to produce a clearly NON-PROMOTABLE '
            'dev artifact, or wait for slice 2 (train from a verified --train/--validation split; '
            'pre-flight gate: python arena/verify-split.py).')
    F, cps, ress = load(DATA, MAX_ROWS)
    F[F < 0] = 768
    n = len(F)
    hold = (np.arange(n) % 50) == 7  # 2% holdout
    tr = ~hold
    Ft = torch.from_numpy(F)
    cpt = torch.from_numpy(cps)
    rst = torch.from_numpy(ress)
    target = LAMBDA * torch.sigmoid(cpt / K) + (1 - LAMBDA) * rst

    net = Net().to(DEVICE)
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    tr_idx = np.flatnonzero(tr)
    ho_idx = torch.from_numpy(np.flatnonzero(hold))

    def holdout_loss():
        net.eval()
        with torch.no_grad():
            losses = []
            for c in range(0, len(ho_idx), BATCH):
                b = ho_idx[c:c + BATCH]
                pred = torch.sigmoid(net(Ft[b].to(DEVICE)) / K)
                losses.append(((pred - target[b].to(DEVICE)) ** 2).mean().item())
        net.train()
        return float(np.mean(losses))

    print(f'train {tr.sum()} / holdout {hold.sum()}  device={DEVICE}', flush=True)
    print(f'epoch -1  holdout {holdout_loss():.6f} (untrained)', flush=True)
    for ep in range(EPOCHS):
        np.random.shuffle(tr_idx)
        t0 = time.time()
        tot, nb = 0.0, 0
        for c in range(0, len(tr_idx), BATCH):
            b = torch.from_numpy(tr_idx[c:c + BATCH])
            pred = torch.sigmoid(net(Ft[b].to(DEVICE)) / K)
            loss = ((pred - target[b].to(DEVICE)) ** 2).mean()
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += loss.item()
            nb += 1
        print(f'epoch {ep:2d}  train {tot/nb:.6f}  holdout {holdout_loss():.6f}  ({time.time()-t0:.0f}s)', flush=True)

    # Export float weights (Rust quantizes on load or uses f32 directly first).
    w1 = net.embed.weight.detach().cpu().numpy()[:768]  # (768,128)
    b1 = net.b1.detach().cpu().numpy()
    w2 = net.out.weight.detach().cpu().numpy()[0]       # (128,)
    b2 = float(net.out.bias.detach().cpu().numpy()[0])
    json.dump({
        'arch': f'768x{HIDDEN}cReLU-1', 'hidden': HIDDEN, 'outputScaleCp': 400.0,
        'k': K, 'lambda': LAMBDA, 'rows': int(n), 'epochs': EPOCHS,
        'w1': [[round(float(v), 6) for v in row] for row in w1],
        'b1': [round(float(v), 6) for v in b1],
        'w2': [round(float(v), 6) for v in w2],
        'b2': b2,
        'note': 'stm-POV, mirror+colorswap for black; UNPROMOTED; '
                '--allow-unsafe-row-split: source-leaking %50 holdout, NON-PROMOTABLE (#33)',
        'promotable': False,
    }, open(OUT, 'w'))
    print(f'wrote {OUT}')


main()
