# Bot-layer gate: opponent-turn arbiter cache vs plain ponder vs gen7-alone.
#
# Replays real transitions from timed games (sprt-rawv3-gen6.pgn). At each
# transition the opponent is to move and their actual reply is known. We
# simulate the opponent-clock pipeline:
#
#   predict top-5 replies (gen7 d4 child-verification ranking, 92.5% top-5)
#   tiered effort on predicted children (per the ponder design):
#     rank 1:    all 9 lanes + gen7 -> arbiter v3 5/15 (gen7 verify d7)
#     ranks 2-3: fast/king/tactics + gen7 -> arbiter v3 5/15
#     ranks 4-5: gen7 d5 only
#   cache prepared move by child FEN
#   on actual reply: hit -> quick gen7 d6 verify (reject if >25cp worse than
#   the d6 move); miss -> normal gen7 d5. "Cache suggests. Current search
#   verifies."
#
# Configs compared on identical transitions / own-clock budget (d5 on miss):
#   gen7-alone | gen7+plain ponder (gen7 d7 on predicted children, no lanes)
#   | gen7+arbiter cache
# Scored by SF-d12 child cp-loss vs SF-d14 oracle on the ACTUAL reply position.
# Gate: arbiter cache beats gen7-alone overall without increasing bl>=200.
#
#   python arena/bench-ponder-cache.py [n_transitions]
import json
import random
import statistics
import subprocess
import sys

import chess
import chess.pgn

EXE = '../chess-vision-studio-rust-engine/target-cand/release/analyze.exe'
SF = 'f:/tools/stockfish/stockfish/stockfish-windows-x86-64-avx2.exe'
BASE = ['--base', 'arena/out/value-weights-mixed.json', '--rung2', 'arena/out/rung2-weights-mixed.json']
GEN7 = ['--nnue', 'f:/tools/cvs-baselines/raw-nnue-h256-sf-d12-v3.json']
PGN = 'f:/tools/sprt-rawv3-gen6.pgn'
N = int(sys.argv[1]) if len(sys.argv) > 1 else 80
SEED = 20260611
TOPK = 5
M_SUP, M_UNSUP = 5, 15
VERIFY_REJECT_CP = 25

LANE_SETS = {1: ['fast', 'cvs-v3', 'net', 'king', 'see', 'tactics', 'defender', 'quietdef', 'pawn'],
             2: ['fast', 'king', 'tactics'], 3: ['fast', 'king', 'tactics']}
LANE_ARGS = {
    'fast': [], 'cvs-v3': ['--nnue', 'arena/out/cvs-nnue-h256-sf-d12-v3.json'],
    'net': ['--nnue', 'arena/out/nnue-gen1-h256.json'],
    'king': ['--lane', 'king'], 'see': ['--lane', 'see'], 'tactics': ['--lane', 'tactics'],
    'defender': ['--lane', 'defender'], 'quietdef': ['--lane', 'quietdef'], 'pawn': ['--lane', 'pawn'],
}

# --- engine servers (one process per distinct config/depth) ---
servers = {}


def serve(key, extra, depth):
    if key not in servers:
        servers[key] = subprocess.Popen(
            [EXE, '--serve', '--depth', str(depth), '--threads', '1'] + BASE + extra,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    return servers[key]


def ask(key, extra, depth, fen):
    s = serve(key, extra, depth)
    s.stdin.write(fen + '\n')
    s.stdin.flush()
    j = json.loads(s.stdout.readline())
    return None if 'error' in j else j


def best_move(key, extra, depth, fen):
    j = ask(key, extra, depth, fen)
    return j.get('uci') if j else None


def child_score(key, extra, depth, fen, uci):
    """search score of child(fen,uci) from the MOVER's POV; None if illegal."""
    b = chess.Board(fen)
    try:
        b.push(chess.Move.from_uci(uci))
    except Exception:
        return None
    if b.is_checkmate():
        return 10000
    if b.is_stalemate() or b.is_insufficient_material():
        return 0
    j = ask(key, extra, depth, b.fen())
    return None if j is None else -j['scoreCp']


DANGER_KEYS = ('hanging', 'king_danger', 'king_zone', 'see_losing')


def is_danger(fen):
    s = serve('cvsdump', [], 1)
    s.stdin.write(f'cvs {fen}\n')
    s.stdin.flush()
    j = json.loads(s.stdout.readline())
    return any(any(k in nm.lower() for k in DANGER_KEYS) for nm in j.get('activeNames', []))


def arbiter(fen, lanes):
    """gen7 main + lane candidates + v3 margins, gen7 verify d7."""
    main = best_move('g7d5', GEN7, 5, fen)
    if not main:
        return None
    support = {}
    for ln in lanes:
        m = best_move('lane-' + ln + '-d5', LANE_ARGS[ln], 5, fen)
        if m and m != main:
            support[m] = support.get(m, 0) + 1
    main_s = child_score('g7d7', GEN7, 7, fen, main)
    if main_s is None or not support:
        return main
    pick, pick_s = main, main_s
    for m, sup in support.items():
        sc = child_score('g7d7', GEN7, 7, fen, m)
        margin = M_SUP if sup >= 2 else M_UNSUP
        if sc is not None and sc >= main_s + margin and sc > pick_s:
            pick, pick_s = m, sc
    return pick


# --- transitions from real games ---
rng = random.Random(SEED)
transitions, seen = [], set()
with open(PGN, encoding='utf8', errors='ignore') as f:
    while len(transitions) < N:
        game = chess.pgn.read_game(f)
        if game is None:
            break
        moves = list(game.mainline_moves())
        if len(moves) < 24:
            continue
        b = game.board()
        k = rng.randrange(8, len(moves) - 6)
        for mv in moves[:k]:
            b.push(mv)
        fen = b.fen()
        if fen in seen:
            continue
        seen.add(fen)
        transitions.append((fen, moves[k].uci()))
print(f'{len(transitions)} transitions from {PGN}', flush=True)

# --- SF oracle + child evals on actual reply positions ---
sf = subprocess.Popen([SF], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
sf.stdin.write('uci\nisready\n')
sf.stdin.flush()
while 'readyok' not in sf.stdout.readline():
    pass
cache_sf = {}


def sf_go(fen, depth):
    sf.stdin.write(f'position fen {fen}\ngo depth {depth}\n')
    sf.stdin.flush()
    sc, bm = 0, None
    while True:
        ln = sf.stdout.readline()
        if ' score cp ' in ln:
            sc = int(ln.split(' score cp ')[1].split()[0])
        elif ' score mate ' in ln:
            sc = 10000 if int(ln.split(' score mate ')[1].split()[0]) > 0 else -10000
        elif ln.startswith('bestmove'):
            bm = ln.split()[1]
            return sc, bm


def sf_child_eval(fen, uci):
    key = (fen, uci)
    if key in cache_sf:
        return cache_sf[key]
    b = chess.Board(fen)
    try:
        b.push(chess.Move.from_uci(uci))
    except Exception:
        cache_sf[key] = None
        return None
    if b.is_checkmate():
        r = 10000
    elif b.is_stalemate() or b.is_insufficient_material():
        r = 0
    else:
        sc, _ = sf_go(b.fen(), 12)
        r = -sc
    cache_sf[key] = r
    return r


def cp_loss(fen, oracle_mv, uci):
    best = sf_child_eval(fen, oracle_mv)
    ce = sf_child_eval(fen, uci)
    return None if best is None or ce is None else max(0, best - ce)


# --- main loop ---
rows = []
for t, (fen, actual) in enumerate(transitions):
    b = chess.Board(fen)
    # predictor: rank opponent legal moves by gen7 d4 child verification
    ranked = []
    for mv in b.legal_moves:
        sc = child_score('g7d4', GEN7, 4, fen, mv.uci())
        if sc is not None:
            ranked.append((sc, mv.uci()))
    ranked.sort(reverse=True)
    predicted = [m for _, m in ranked[:TOPK]]

    # opponent-clock work -> caches keyed by child fen
    arb_cache, plain_cache, hyb_cache = {}, {}, {}
    for rank, pm in enumerate(predicted, 1):
        cb = chess.Board(fen)
        cb.push(chess.Move.from_uci(pm))
        cfen = cb.fen()
        if cb.is_game_over():
            continue
        plain_cache[cfen] = best_move('g7d7', GEN7, 7, cfen)
        if rank in LANE_SETS:
            arb_cache[cfen] = arbiter(cfen, LANE_SETS[rank])
            # hybrid: CVS danger decides WHEN to convene the lane panel
            hyb_cache[cfen] = arb_cache[cfen] if is_danger(cfen) else plain_cache[cfen]
        else:
            arb_cache[cfen] = best_move('g7d5', GEN7, 5, cfen)
            hyb_cache[cfen] = arb_cache[cfen]

    # actual reply
    ab = chess.Board(fen)
    ab.push(chess.Move.from_uci(actual))
    afen = ab.fen()
    if ab.is_game_over():
        continue
    oracle_sc, oracle_mv = sf_go(afen, 14)
    hit = afen in arb_cache

    g7_move = best_move('g7d5', GEN7, 5, afen)

    def with_verify(cached):
        """quick d6 verify: reject cached move if >VERIFY_REJECT_CP worse."""
        if cached is None:
            return g7_move, False
        j = ask('g7d6', GEN7, 6, afen)
        quick = j.get('uci') if j else None
        if quick is None or cached == quick:
            return cached, False
        cs = child_score('g7d6v', GEN7, 6, afen, cached)
        qs = child_score('g7d6v', GEN7, 6, afen, quick)
        if cs is not None and qs is not None and qs - cs > VERIFY_REJECT_CP:
            return quick, True
        return cached, False

    arb_move, arb_rej = with_verify(arb_cache.get(afen)) if hit else (g7_move, False)
    plain_move, plain_rej = with_verify(plain_cache.get(afen)) if hit else (g7_move, False)
    hyb_move, hyb_rej = with_verify(hyb_cache.get(afen)) if hit else (g7_move, False)

    rows.append({
        'hit': hit,
        'g7': cp_loss(afen, oracle_mv, g7_move),
        'plain': cp_loss(afen, oracle_mv, plain_move),
        'arb': cp_loss(afen, oracle_mv, arb_move),
        'hyb': cp_loss(afen, oracle_mv, hyb_move),
        'arb_rej': arb_rej, 'plain_rej': plain_rej, 'hyb_rej': hyb_rej,
    })
    if (t + 1) % 10 == 0:
        print(f'{t+1}/{len(transitions)} transitions (hits so far: '
              f'{sum(r["hit"] for r in rows)}/{len(rows)})', flush=True)

for s in servers.values():
    s.kill()
sf.kill()

n = len(rows)
hits = [r for r in rows if r['hit']]
print(f'\n# Bot-layer gate ({n} transitions, top-{TOPK} predictor, arbiter {M_SUP}/{M_UNSUP}, verify-reject {VERIFY_REJECT_CP}cp)')
print(f'cache hit rate: {100*len(hits)/n:.1f}%\n')
print('%-18s %7s %9s %9s %6s %6s %10s' % ('config', 'avgCP', 'avgCP-hit', 'avgCP-miss', 'bl100', 'bl200', 'verify-rej'))
for cfg in ('g7', 'plain', 'arb', 'hyb'):
    xs = [r[cfg] for r in rows if r[cfg] is not None]
    xh = [r[cfg] for r in hits if r[cfg] is not None]
    xm = [r[cfg] for r in rows if not r['hit'] and r[cfg] is not None]
    rej = sum(1 for r in hits if r.get(cfg + '_rej')) if cfg != 'g7' else 0
    name = {'g7': 'gen7-alone', 'plain': 'gen7+plain-ponder', 'arb': 'gen7+arb-cache',
            'hyb': 'gen7+hybrid(dngr)'}[cfg]
    print('%-18s %7.1f %9.1f %9.1f %5.1f%% %5.1f%% %10s' % (
        name, statistics.mean(xs), statistics.mean(xh) if xh else -1,
        statistics.mean(xm) if xm else -1,
        100 * sum(1 for x in xs if x >= 100) / len(xs),
        100 * sum(1 for x in xs if x >= 200) / len(xs),
        ('%d/%d' % (rej, len(hits))) if cfg != 'g7' else '—'))
json.dump(rows, open('f:/tmp/ponder-gate-rows.json', 'w'))
