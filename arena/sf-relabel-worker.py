# Stockfish relabel worker (one shard, one SF process).
#
#   python arena/sf-relabel-worker.py <shard.jsonl> <out.jsonl> [depth]
#
# Reads {fen,res} rows, labels each with SF at fixed depth, appends
# {fen,res,sfCp,sfMate,sfDepth} to <out.jsonl>. RESUMABLE: skips as many input
# rows as the output already has. Failed FENs -> <out>.failed.txt.
# Teacher doctrine: SF labels train; SF never powers runtime eval.
import json
import subprocess
import sys
import time

SF = 'f:/tools/stockfish/stockfish/stockfish-windows-x86-64-avx2.exe'
shard, out_path = sys.argv[1], sys.argv[2]
depth = int(sys.argv[3]) if len(sys.argv) > 3 else 12
hash_mb = int(sys.argv[4]) if len(sys.argv) > 4 else 256  # was hardcoded 64; 256 cuts TT overwrites at d20 (95GB free, trivial even x16 workers)

done = 0
try:
    with open(out_path, encoding='utf8') as f:
        for _ in f:
            done += 1
except FileNotFoundError:
    pass

p = subprocess.Popen([SF], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
p.stdin.write(f'uci\nsetoption name Threads value 1\nsetoption name Hash value {hash_mb}\nisready\n')
p.stdin.flush()
while 'readyok' not in p.stdout.readline():
    pass

out = open(out_path, 'a', encoding='utf8')
failed = open(out_path + '.failed.txt', 'a', encoding='utf8')
t0 = time.time()
n = 0
with open(shard, encoding='utf8') as fh:
    for i, line in enumerate(fh):
        if i < done:
            continue
        try:
            j = json.loads(line)
            fen = j['fen']
        except Exception:
            continue
        p.stdin.write(f'position fen {fen}\ngo depth {depth}\n')
        p.stdin.flush()
        cp = mate = None
        while True:
            ln = p.stdout.readline()
            if not ln:
                failed.write(fen + '\n')
                break
            if ln.startswith('info') and ' score ' in ln:
                t = ln.split()
                try:
                    k = t.index('score')
                    if t[k + 1] == 'cp':
                        cp, mate = int(t[k + 2]), None
                    elif t[k + 1] == 'mate':
                        mate, cp = int(t[k + 2]), None
                except (ValueError, IndexError):
                    pass
            elif ln.startswith('bestmove'):
                break
        out.write(json.dumps({'fen': fen, 'res': j.get('res'), 'sfCp': cp,
                              'sfMate': mate, 'sfDepth': depth}) + '\n')
        n += 1
        if n % 500 == 0:  # was 5000; tighter flush = a kill loses ~seconds of work, not ~25min (we got bitten by this)
            out.flush()
            rate = n / (time.time() - t0)
            print(f'{shard}: {done+n} labeled ({rate:.0f}/s)', flush=True)
out.close()
failed.close()
print(f'{shard}: DONE {done+n} rows in {time.time()-t0:.0f}s', flush=True)
