# Standing benchmark: oracle CP-LOSS (not just exact-match).
#
# For each suite position: each engine picks a move (fixed depth, d5);
# Stockfish (d24) evaluates the child of that move and the child of the
# oracle's best move; cp_loss = max(0, best_child - chosen_child), mover POV.
#
# Metrics per engine: exact_match, avg/median/p90 cp_loss, blunder rates
# (>=100, >=200), danger/quiet subset losses. Plus the lane table rebuilt
# around a chosen BASELINE engine (gen7): agree-baseline, unique-and-right,
# unique-and-<=25cp, unique-and-better-than-baseline, ensemble ceiling.
#
#   python arena/bench-oracle-cploss.py
import json
import statistics
import subprocess

import chess

EXE = '../chess-vision-studio-rust-engine/target-cand/release/analyze.exe'
SF = 'f:/tools/stockfish/stockfish/stockfish-windows-x86-64-avx2.exe'
BASE = ['--base', 'arena/out/value-weights-mixed.json', '--rung2', 'arena/out/rung2-weights-mixed.json']
SUITE = 'f:/tmp/diversity-100.txt'
SAVED = 'f:/tmp/diversity-results.json'
DANGER = 'f:/tmp/diversity-danger.json'
BASELINE = 'gen7'
DEPTH = 5
DEFAULT_STOCKFISH_REVIEW_DEPTH = 24
SF_DEPTH = DEFAULT_STOCKFISH_REVIEW_DEPTH

ENGINES = {
    'gen7': ['--nnue', 'f:/tools/cvs-baselines/raw-nnue-h256-sf-d12-v3.json'],
    'cvs-v3': ['--nnue', 'arena/out/cvs-nnue-h256-sf-d12-v3.json'],
}
LANES = ['fast', 'net', 'king', 'see', 'tactics', 'defender', 'quietdef', 'pawn']

fens = [l.strip() for l in open(SUITE) if l.strip()]
results = json.load(open(SAVED))
danger = json.load(open(DANGER))
orc = results['ORACLE']

for name, extra in ENGINES.items():
    if name in results:
        continue
    p = subprocess.Popen([EXE, '--serve', '--depth', str(DEPTH), '--threads', '1'] + BASE + extra,
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    mv = []
    for f in fens:
        p.stdin.write(f + '\n')
        p.stdin.flush()
        mv.append(json.loads(p.stdout.readline()).get('uci'))
    p.kill()
    results[name] = mv
json.dump(results, open(SAVED, 'w'))

ALL = [BASELINE] + [e for e in list(ENGINES) + LANES if e != BASELINE]

# SF child evals for every distinct (pos, move)
sf = subprocess.Popen([SF], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
sf.stdin.write('uci\nisready\n')
sf.stdin.flush()
while 'readyok' not in sf.stdout.readline():
    pass
cache = {}


def child_eval(fen, uci):
    """SF eval of the child position, from the MOVER's POV (cp)."""
    key = (fen, uci)
    if key in cache:
        return cache[key]
    b = chess.Board(fen)
    try:
        b.push(chess.Move.from_uci(uci))
    except Exception:
        cache[key] = None
        return None
    if b.is_checkmate():
        cache[key] = 10000
        return 10000
    if b.is_stalemate() or b.is_insufficient_material():
        cache[key] = 0
        return 0
    sf.stdin.write(f'position fen {b.fen()}\ngo depth {SF_DEPTH}\n')
    sf.stdin.flush()
    sc = 0
    while True:
        ln = sf.stdout.readline()
        if ' score cp ' in ln:
            sc = int(ln.split(' score cp ')[1].split()[0])
        elif ' score mate ' in ln:
            sc = 10000 if int(ln.split(' score mate ')[1].split()[0]) > 0 else -10000
        elif ln.startswith('bestmove'):
            break
    cache[key] = -sc  # child is opponent-to-move; negate to mover POV
    return -sc


loss = {e: [] for e in ALL}
for i, fen in enumerate(fens):
    best = child_eval(fen, orc[i])
    if best is None:
        for e in ALL:
            loss[e].append(None)
        continue
    for e in ALL:
        ce = child_eval(fen, results[e][i]) if results[e][i] else None
        loss[e].append(None if ce is None else max(0, best - ce))


def stats(e, idx):
    xs = [loss[e][i] for i in idx if loss[e][i] is not None]
    if not xs:
        return None
    xs_s = sorted(xs)
    return {
        'match': 100 * sum(1 for i in idx if results[e][i] == orc[i]) / len(idx),
        'avg': statistics.mean(xs), 'med': statistics.median(xs),
        'p90': xs_s[int(0.9 * len(xs_s))],
        'b100': 100 * sum(1 for x in xs if x >= 100) / len(xs),
        'b200': 100 * sum(1 for x in xs if x >= 200) / len(xs),
    }


n = len(fens)
all_idx = list(range(n))
d_idx = [i for i in all_idx if danger[i]]
q_idx = [i for i in all_idx if not danger[i]]
print(f'# Oracle CP-LOSS benchmark (suite {n}, engines d{DEPTH}, SF child evals d{SF_DEPTH})\n')
print('%-10s %7s %7s %5s %5s %6s %6s %10s %9s' % ('engine', 'match%', 'avgCP', 'medCP', 'p90', 'bl100%', 'bl200%', 'dangerAvg', 'quietAvg'))
for e in ALL:
    s = stats(e, all_idx)
    sd = stats(e, d_idx)
    sq = stats(e, q_idx)
    print('%-10s %6.1f%% %7.1f %5.0f %5.0f %5.1f%% %5.1f%% %9.1f %8.1f' %
          (e, s['match'], s['avg'], s['med'], s['p90'], s['b100'], s['b200'], sd['avg'], sq['avg']))

# Lane table vs baseline
print(f'\n# Lane value over BASELINE={BASELINE} (unique = differs from baseline)')
print('%-10s %10s %14s %16s %20s' % ('lane', 'agree-b%', 'uniq&right%', 'uniq&<=25cp%', 'uniq&better-than-b%'))
for e in ALL[1:]:
    agree = sum(1 for i in all_idx if results[e][i] == results[BASELINE][i])
    uniq = [i for i in all_idx if results[e][i] != results[BASELINE][i]]
    ur = sum(1 for i in uniq if results[e][i] == orc[i])
    u25 = sum(1 for i in uniq if loss[e][i] is not None and loss[e][i] <= 25)
    ub = sum(1 for i in uniq if loss[e][i] is not None and loss[BASELINE][i] is not None and loss[e][i] < loss[BASELINE][i])
    print('%-10s %9.1f%% %13.1f%% %15.1f%% %19.1f%%' % (e, 100 * agree / n, 100 * ur / n, 100 * u25 / n, 100 * ub / n))

cover = sum(1 for i in all_idx if any(results[e][i] == orc[i] for e in ALL))
base_match = sum(1 for i in all_idx if results[BASELINE][i] == orc[i])
best_loss_cover = sum(1 for i in all_idx if any(
    loss[e][i] is not None and loss[BASELINE][i] is not None and loss[e][i] < loss[BASELINE][i] for e in ALL[1:]))
print(f'\nensemble oracle coverage: {100*cover/n:.1f}%  vs {BASELINE} alone {100*base_match/n:.1f}%')
print(f'positions where SOME lane beats {BASELINE} on cp-loss: {100*best_loss_cover/n:.1f}%')
sf.kill()
