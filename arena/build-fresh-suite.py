# Build the fresh validation suite for the arbiter-v3 gate.
#
# 100 never-before-used positions (82 danger / 18 quiet, matching suite-100's
# composition), sampled with a FIXED seed from f:/tmp/nnue-all.jsonl, excluding
# every FEN in the original suite. Danger = any active CVS id in the
# hanging-material or king-danger families (the same detector used for the
# quiet training filter). Then: SF-d24 oracle + all 10 voices at d5, saved to
# fresh-results.json / fresh-danger.json. NO tuning after results.
#
#   python arena/build-fresh-suite.py
import json
import random
import subprocess

EXE = '../chess-vision-studio-rust-engine/target-cand/release/analyze.exe'
SF = 'f:/tools/stockfish/stockfish/stockfish-windows-x86-64-avx2.exe'
BASE = ['--base', 'arena/out/value-weights-mixed.json', '--rung2', 'arena/out/rung2-weights-mixed.json']
OLD_SUITE = 'f:/tmp/diversity-100.txt'
SRC = 'f:/tmp/nnue-all.jsonl'
N_DANGER, N_QUIET = 82, 18
SEED = 20260611
DEFAULT_STOCKFISH_REVIEW_DEPTH = 24

VOICES = {
    'gen7': ['--nnue', 'f:/tools/cvs-baselines/raw-nnue-h256-sf-d12-v3.json'],
    'cvs-v3': ['--nnue', 'arena/out/cvs-nnue-h256-sf-d12-v3.json'],
    'net': ['--nnue', 'arena/out/nnue-gen1-h256.json'],
    'fast': [],
    'king': ['--lane', 'king'], 'see': ['--lane', 'see'], 'tactics': ['--lane', 'tactics'],
    'defender': ['--lane', 'defender'], 'quietdef': ['--lane', 'quietdef'], 'pawn': ['--lane', 'pawn'],
}

old = set(l.strip() for l in open(OLD_SUITE) if l.strip())

# Reservoir-free fixed sample: take every Kth row from a seeded random offset,
# far more candidates than needed, then classify and trim.
rng = random.Random(SEED)
cands = []
with open(SRC, encoding='utf8') as f:
    for i, line in enumerate(f):
        if i % 9973 != 1234:  # ~770 spaced candidates from 7.7M
            continue
        try:
            fen = json.loads(line)['fen']
        except Exception:
            continue
        if fen not in old and fen.split()[0].count('K') == 1 and fen.split()[0].count('k') == 1:
            cands.append(fen)
rng.shuffle(cands)
print(f'{len(cands)} candidate positions', flush=True)

# classify danger via active CVS fact names (hanging / king-danger families)
p = subprocess.Popen([EXE, '--serve', '--depth', '1'] + BASE, stdin=subprocess.PIPE,
                     stdout=subprocess.PIPE, text=True)
DANGER_KEYS = ('hanging', 'king_danger', 'king_zone', 'see_losing')


def is_danger(fen):
    p.stdin.write(f'cvs {fen}\n')
    p.stdin.flush()
    j = json.loads(p.stdout.readline())
    return any(any(k in nm.lower() for k in DANGER_KEYS) for nm in j.get('activeNames', []))


danger_fens, quiet_fens = [], []
for fen in cands:
    if len(danger_fens) >= N_DANGER and len(quiet_fens) >= N_QUIET:
        break
    try:
        d = is_danger(fen)
    except Exception:
        continue
    (danger_fens if d else quiet_fens).append(fen)
p.kill()
suite = danger_fens[:N_DANGER] + quiet_fens[:N_QUIET]
flags = [True] * min(N_DANGER, len(danger_fens)) + [False] * min(N_QUIET, len(quiet_fens))
print(f'suite: {sum(flags)} danger / {len(flags)-sum(flags)} quiet', flush=True)
open('f:/tmp/fresh-100.txt', 'w').write('\n'.join(suite) + '\n')
json.dump(flags, open('f:/tmp/fresh-danger.json', 'w'))

# oracle: SF d24 bestmove
sf = subprocess.Popen([SF], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
sf.stdin.write('uci\nisready\n')
sf.stdin.flush()
while 'readyok' not in sf.stdout.readline():
    pass
oracle = []
for k, fen in enumerate(suite):
    sf.stdin.write(f'position fen {fen}\ngo depth {DEFAULT_STOCKFISH_REVIEW_DEPTH}\n')
    sf.stdin.flush()
    while True:
        ln = sf.stdout.readline()
        if ln.startswith('bestmove'):
            oracle.append(ln.split()[1])
            break
    if (k + 1) % 25 == 0:
        print(f'oracle {k+1}/{len(suite)}', flush=True)
sf.kill()

results = {'ORACLE': oracle}
for name, extra in VOICES.items():
    p = subprocess.Popen([EXE, '--serve', '--depth', '5', '--threads', '1'] + BASE + extra,
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    mv = []
    for fen in suite:
        p.stdin.write(fen + '\n')
        p.stdin.flush()
        mv.append(json.loads(p.stdout.readline()).get('uci'))
    p.kill()
    results[name] = mv
    print(f'voice {name} done', flush=True)
json.dump(results, open('f:/tmp/fresh-results.json', 'w'))
print('wrote f:/tmp/fresh-100.txt, fresh-danger.json, fresh-results.json')
