# Arbiter v3 benchmark: gen7-centered harvest machine, cp-loss gated.
#
# Roles: gen7 = main/verifier authority. Lanes = candidate provocateurs only.
# For each suite position: candidates = unique lane moves differing from
# gen7's move. gen7 verifies every move by child search (d7, d8 on danger
# positions); a challenger replaces gen7's move only if it beats it by a
# support-scaled margin (proposed by >=2 lanes = supported). Verified scores
# are computed once; margin pairs are swept post-hoc.
#
# Scored by SF-d12 child cp-loss (same protocol as bench-oracle-cploss.py).
# Targets (user spec): avgCP <23.2, p90 <87, bl>=200 <=1%, danger <23.9,
# match% >=51 not at cp-loss cost. Guardrail: never trade the 1% blunder
# collapse away.
#
#   python arena/bench-arbiter-v3.py [suite.txt results.json danger.json]
import json
import statistics
import subprocess
import sys

import chess

EXE = '../chess-vision-studio-rust-engine/target-cand/release/analyze.exe'
SF = 'f:/tools/stockfish/stockfish/stockfish-windows-x86-64-avx2.exe'
BASE = ['--base', 'arena/out/value-weights-mixed.json', '--rung2', 'arena/out/rung2-weights-mixed.json']
GEN7 = ['--nnue', 'f:/tools/cvs-baselines/raw-nnue-h256-sf-d12-v3.json']
SUITE = sys.argv[1] if len(sys.argv) > 3 else 'f:/tmp/diversity-100.txt'
SAVED = sys.argv[2] if len(sys.argv) > 3 else 'f:/tmp/diversity-results.json'
DANGER = sys.argv[3] if len(sys.argv) > 3 else 'f:/tmp/diversity-danger.json'
LANES = ['fast', 'cvs-v3', 'net', 'king', 'see', 'tactics', 'defender', 'quietdef', 'pawn']
MARGINS = [(5, 15), (10, 25), (15, 35), (25, 50)]  # (supported, unsupported) cp
VDEPTH, VDEPTH_DANGER = 7, 8

fens = [l.strip() for l in open(SUITE) if l.strip()]
results = json.load(open(SAVED))
danger = json.load(open(DANGER))
orc = results['ORACLE']
n = len(fens)

# --- gen7 child verification (one serve process per depth) ---
servers = {}
for d in (VDEPTH, VDEPTH_DANGER):
    servers[d] = subprocess.Popen([EXE, '--serve', '--depth', str(d), '--threads', '1'] + BASE + GEN7,
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)


def verify(fen, uci, depth):
    """gen7 search score of the child, mover POV. None if illegal."""
    b = chess.Board(fen)
    try:
        b.push(chess.Move.from_uci(uci))
    except Exception:
        return None
    if b.is_checkmate():
        return 10000
    if b.is_stalemate() or b.is_insufficient_material():
        return 0
    s = servers[depth]
    s.stdin.write(b.fen() + '\n')
    s.stdin.flush()
    j = json.loads(s.stdout.readline())
    return None if 'error' in j else -j['scoreCp']


verified = []  # per position: {'main': score, 'cands': {move: (score, support)}}
for i, fen in enumerate(fens):
    d = VDEPTH_DANGER if danger[i] else VDEPTH
    main = results['gen7'][i]
    support = {}
    for ln in LANES:
        m = results[ln][i]
        if m and m != main:
            support[m] = support.get(m, 0) + 1
    entry = {'main': verify(fen, main, d), 'cands': {}}
    for m, sup in support.items():
        sc = verify(fen, m, d)
        if sc is not None:
            entry['cands'][m] = (sc, sup)
    verified.append(entry)
    if (i + 1) % 25 == 0:
        print(f'verified {i+1}/{n}', flush=True)
for s in servers.values():
    s.kill()

# --- SF d12 child evals for cp-loss scoring ---
sf = subprocess.Popen([SF], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
sf.stdin.write('uci\nisready\n')
sf.stdin.flush()
while 'readyok' not in sf.stdout.readline():
    pass
cache = {}


def child_eval(fen, uci):
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
    sf.stdin.write(f'position fen {b.fen()}\ngo depth 12\n')
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
    cache[key] = -sc
    return -sc


def cp_loss(i, uci):
    best = child_eval(fens[i], orc[i])
    ce = child_eval(fens[i], uci)
    return None if best is None or ce is None else max(0, best - ce)


def arbiter_pick(i, m_sup, m_unsup):
    v = verified[i]
    main = results['gen7'][i]
    if v['main'] is None:
        return main, False
    best_m, best_s = main, v['main']
    for m, (sc, sup) in v['cands'].items():
        margin = m_sup if sup >= 2 else m_unsup
        if sc >= v['main'] + margin and sc > best_s:
            best_m, best_s = m, sc
    return best_m, best_m != main


def table_row(name, moves):
    losses = [cp_loss(i, moves[i]) for i in range(n)]
    xs = [x for x in losses if x is not None]
    xs_s = sorted(xs)
    d_l = [losses[i] for i in range(n) if danger[i] and losses[i] is not None]
    q_l = [losses[i] for i in range(n) if not danger[i] and losses[i] is not None]
    match = 100 * sum(1 for i in range(n) if moves[i] == orc[i]) / n
    print('%-16s %6.1f%% %7.1f %5.0f %5.0f %5.1f%% %5.1f%% %9.1f %8.1f' %
          (name, match, statistics.mean(xs), statistics.median(xs), xs_s[int(0.9 * len(xs_s))],
           100 * sum(1 for x in xs if x >= 100) / len(xs),
           100 * sum(1 for x in xs if x >= 200) / len(xs),
           statistics.mean(d_l), statistics.mean(q_l)))
    return losses


print('\n# Arbiter v3 (gen7 main/verifier, candidates from %d lanes, verify d%d/d%d)\n' % (len(LANES), VDEPTH, VDEPTH_DANGER))
print('%-16s %7s %7s %5s %5s %6s %6s %10s %9s' % ('config', 'match%', 'avgCP', 'medCP', 'p90', 'bl100%', 'bl200%', 'dangerAvg', 'quietAvg'))
g7_losses = table_row('gen7-alone', results['gen7'])

# positions where some lane genuinely beats gen7 (harvest opportunity, per SF)
lane_best = []
for i in range(n):
    cand_losses = [cp_loss(i, m) for m in verified[i]['cands']]
    cand_losses = [x for x in cand_losses if x is not None]
    lane_best.append(min(cand_losses) if cand_losses else None)
opp = [i for i in range(n) if lane_best[i] is not None and g7_losses[i] is not None and lane_best[i] < g7_losses[i]]

for m_sup, m_unsup in MARGINS:
    picks = [arbiter_pick(i, m_sup, m_unsup) for i in range(n)]
    moves = [p[0] for p in picks]
    losses = table_row('arb m%d/%d' % (m_sup, m_unsup), moves)
    switched = [i for i in range(n) if picks[i][1]]
    giveback = [i for i in switched if losses[i] is not None and g7_losses[i] is not None and losses[i] > g7_losses[i]]
    harvested = [i for i in opp if losses[i] is not None and losses[i] < g7_losses[i]]
    print('   switched %d | give-back %d (%.0f%% of switches) | harvest %d/%d opportunities (%.0f%%)' %
          (len(switched), len(giveback), 100 * len(giveback) / max(1, len(switched)),
           len(harvested), len(opp), 100 * len(harvested) / max(1, len(opp))))
sf.kill()
