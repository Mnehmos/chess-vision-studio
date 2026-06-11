# CVS-NNUE trainer (Track B of the representation experiment).
#
# IDENTICAL to train-nnue.py in teacher, data, split, hidden size, and budget.
# The ONLY change is the input representation: 768 piece-square features
# (stm-perspective) PLUS the 168 CVS geometry feature ids (offset +768) from
# the deterministic CVS Feature Registry v1. Research question: does explicit
# truth-preserving geometry beat raw piece-square input at equal everything?
#
#   python arena/train-cvs-nnue.py <sf-train.jsonl> <cvsids.txt> [--hidden N]
#       [--epochs E] [--rows N] [--out model.json]
#
# The model embeds the registry version+hash; the Rust loader must reject a
# mismatch loudly. SF labels train; SF never powers runtime eval.
import json
import subprocess
import sys
import time

import numpy as np
import torch
import torch.nn as nn

DATA = sys.argv[1]
CVSIDS = sys.argv[2]


def arg(flag, dflt):
    return type(dflt)(sys.argv[sys.argv.index(flag) + 1]) if flag in sys.argv else dflt


MAX_ROWS = arg('--rows', 100_000_000)
EPOCHS = arg('--epochs', 30)
OUT = arg('--out', 'arena/out/cvs-nnue-h256-sf-d12-v1.json')
HIDDEN = arg('--hidden', 256)
K = 256.0
LAMBDA = 0.6
BATCH = 16384
DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
PS_INPUTS = 768
CVS_DIM = 168
INPUTS = PS_INPUTS + CVS_DIM  # 936; padding idx = 936

PIECE_IDX = {'P': 0, 'N': 1, 'B': 2, 'R': 3, 'Q': 4, 'K': 5,
             'p': 6, 'n': 7, 'b': 8, 'r': 9, 'q': 10, 'k': 11}


def registry_info():
    exe = '../chess-vision-studio-rust-engine/target-cand/release/analyze.exe'
    p = subprocess.Popen([exe, '--serve', '--depth', '1'], stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, text=True)
    p.stdin.write('cvs rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\n')
    p.stdin.flush()
    j = json.loads(p.stdout.readline())
    p.kill()
    assert j['inputDim'] == CVS_DIM, f"registry dim {j['inputDim']} != {CVS_DIM}"
    return j['registryVersion'], j['registryHash']


def encode_ps(fen, cp_white, res_white):
    board, stm = fen.split(' ')[0], fen.split(' ')[1]
    white = stm == 'w'
    idx = []
    sq = 56
    for ch in board:
        if ch == '/':
            sq -= 16
        elif ch.isdigit():
            sq += int(ch)
        else:
            p = PIECE_IDX[ch]
            s = sq
            if not white:
                p = (p + 6) % 12
                s = sq ^ 56
            idx.append(p * 64 + s)
            sq += 1
    cp = cp_white if white else -cp_white
    res = res_white if white else 1.0 - res_white
    return idx, cp, res


def load():
    feats, cps, ress = [], [], []
    t0 = time.time()
    with open(DATA, encoding='utf8') as fd, open(CVSIDS, encoding='utf8') as fc:
        for i, (dl, cl) in enumerate(zip(fd, fc)):
            if i >= MAX_ROWS:
                break
            try:
                j = json.loads(dl)
                idx, cp, res = encode_ps(j['fen'], j['cp'], j['res'])
            except Exception:
                continue
            cl = cl.strip()
            if cl and cl != 'ERR':
                # stm-relative geometry: the piece-square half is stm-mirrored,
                # so the CVS side bit must flip too when black is to move
                # (id = fam*8 + side*4 + bucket; flip side => id XOR-style swap).
                white = j['fen'].split(' ')[1] == 'w'
                for x in cl.split(','):
                    i = int(x)
                    if not white:
                        fam, within = divmod(i, 8)
                        side, bucket = divmod(within, 4)
                        i = fam * 8 + (1 - side) * 4 + bucket
                    idx.append(PS_INPUTS + i)
            feats.append(idx)
            cps.append(cp)
            ress.append(res)
    n = len(feats)
    maxlen = max(len(f) for f in feats)
    F = np.full((n, maxlen), INPUTS, dtype=np.int64)  # pad = INPUTS
    for i, idx in enumerate(feats):
        F[i, :len(idx)] = idx
    print(f'loaded {n} rows (maxlen {maxlen}) in {time.time()-t0:.0f}s', flush=True)
    return F, np.array(cps, dtype=np.float32), np.array(ress, dtype=np.float32)


class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.embed = nn.EmbeddingBag(INPUTS + 1, HIDDEN, mode='sum', padding_idx=INPUTS)
        self.b1 = nn.Parameter(torch.zeros(HIDDEN))
        self.out = nn.Linear(HIDDEN, 1)
        nn.init.normal_(self.embed.weight, std=0.05)
        self.embed.weight.data[INPUTS].zero_()

    def forward(self, f):
        h = torch.clamp(self.embed(f) + self.b1, 0.0, 1.0)
        return self.out(h).squeeze(-1) * 400.0


def main():
    reg_ver, reg_hash = registry_info()
    print(f'registry v{reg_ver} hash {reg_hash}', flush=True)
    F, cps, ress = load()
    n = len(F)
    hold = (np.arange(n) % 50) == 7
    tr_idx = np.flatnonzero(~hold)
    ho_idx = torch.from_numpy(np.flatnonzero(hold))
    Ft = torch.from_numpy(F)
    target = LAMBDA * torch.sigmoid(torch.from_numpy(cps) / K) + (1 - LAMBDA) * torch.from_numpy(ress)

    net = Net().to(DEVICE)
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)

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

    print(f'train {len(tr_idx)} / holdout {len(ho_idx)}  device={DEVICE}  inputs={INPUTS}', flush=True)
    for ep in range(EPOCHS):
        np.random.shuffle(tr_idx)
        t0 = time.time()
        tot = nb = 0
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

    w1 = net.embed.weight.detach().cpu().numpy()[:INPUTS]
    json.dump({
        'modelKind': 'cvs_nnue', 'arch': f'{INPUTS}x{HIDDEN}cReLU-1',
        'inputCount': INPUTS, 'psInputs': PS_INPUTS, 'cvsDim': CVS_DIM,
        'hidden': HIDDEN, 'outputScaleCp': 400.0,
        'registryVersion': reg_ver, 'registryHash': reg_hash,
        'teacher': 'stockfish_d12', 'rows': int(n), 'epochs': EPOCHS,
        'k': K, 'lambda': LAMBDA,
        'w1': [[round(float(v), 6) for v in row] for row in w1],
        'b1': [round(float(v), 6) for v in net.b1.detach().cpu().numpy()],
        'w2': [round(float(v), 6) for v in net.out.weight.detach().cpu().numpy()[0]],
        'b2': float(net.out.bias.detach().cpu().numpy()[0]),
        'note': 'stm-POV piece-square + STM-RELATIVE CVS registry-v1 ids (+768); UNPROMOTED',
        'cvsStmRelative': True,
    }, open(OUT, 'w'))
    print(f'wrote {OUT}')


main()
