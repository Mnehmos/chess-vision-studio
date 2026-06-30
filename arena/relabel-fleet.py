# SF relabel fleet — shard a FEN corpus and launch N detached, BelowNormal
# `sf-relabel-worker.py` processes that survive this shell and resume on restart.
#
#   python arena/relabel-fleet.py --source "arena/out/2b-shards/shard*.jsonl" \
#       --out-dir arena/out/nnue-d24 --workers 16 --depth 24 --hash 256
#
# Each worker labels one shard with local Stockfish (Threads=1, Hash from --hash)
# and is independently resumable (skips rows its output already has). The parent
# writes fleet.json (pids+shards) then EXITS — the workers keep running detached,
# so a closed terminal or ended agent session does not kill the job. Re-running
# the same command re-spawns workers over the same shard/out pairs; finished rows
# are skipped, so it is safe to restart anytime.
#
# Resource posture (8c/16t box): 16 workers × 1 thread saturates the logical cores
# while BelowNormal priority yields to the dev server, the analyze.exe pool, and the
# lichess bot. 16 × Hash MB stays trivial against ~90 GB free.
import argparse
import glob
import json
import os
import subprocess
import sys
import time

SF = 'f:/tools/stockfish/stockfish/stockfish-windows-x86-64-avx2.exe'
WORKER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sf-relabel-worker.py')
DEFAULT_STOCKFISH_REVIEW_DEPTH = 24


def read_rows(patterns):
    """Dedup rows by FEN (order-preserving) from FEN-bearing JSONL rows, PRESERVING every field
    so source/finder/split/seed provenance survives into the relabel (#34). Non-object lines
    (a bare FEN string, etc.) are skipped, as before."""
    seen, rows = set(), []
    for pat in patterns:
        for path in sorted(glob.glob(pat)):
            with open(path, encoding='utf8') as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        row = json.loads(line)
                        fen = row['fen']
                    except (ValueError, TypeError, KeyError):
                        continue
                    if fen not in seen:
                        seen.add(fen)
                        rows.append(row)
    return rows


def shard(rows, n, out_dir):
    """Round-robin into n shard files so each holds a similar position mix. Writes the FULL row
    (all provenance fields preserved, #34), not just the FEN."""
    buckets = [[] for _ in range(n)]
    for i, row in enumerate(rows):
        buckets[i % n].append(row)
    paths = []
    for k, bucket in enumerate(buckets):
        p = os.path.join(out_dir, f'shard{k:02d}.jsonl')
        with open(p, 'w', encoding='utf8') as fh:
            for row in bucket:
                fh.write(json.dumps(row) + '\n')
        paths.append(p)
    return paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', nargs='+', default=['arena/out/2b-shards/shard*.jsonl'])
    ap.add_argument('--out-dir', default='arena/out/nnue-d24')
    ap.add_argument('--workers', type=int, default=16)
    ap.add_argument('--depth', type=int, default=DEFAULT_STOCKFISH_REVIEW_DEPTH)
    ap.add_argument('--hash', type=int, default=256)
    ap.add_argument('--no-reshard', action='store_true', help='reuse existing shardNN.jsonl in out-dir')
    args = ap.parse_args()

    if not os.path.exists(SF):
        sys.exit(f'stockfish not found: {SF}')
    os.makedirs(args.out_dir, exist_ok=True)

    if args.no_reshard:
        shards = sorted(glob.glob(os.path.join(args.out_dir, 'shard*.jsonl')))
        if not shards:
            sys.exit('no existing shards to reuse; drop --no-reshard')
    else:
        rows = read_rows(args.source)
        if not rows:
            sys.exit('no FENs found in --source')
        shards = shard(rows, args.workers, args.out_dir)
        print(f'corpus: {len(rows)} unique FENs -> {len(shards)} shards in {args.out_dir}', flush=True)

    # Detached + BelowNormal so the fleet outlives this shell and yields the box.
    flags = (subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
             | subprocess.BELOW_NORMAL_PRIORITY_CLASS)
    fleet = []
    for shard_path in shards:
        base = os.path.splitext(os.path.basename(shard_path))[0]  # shardNN
        out_path = os.path.join(args.out_dir, base.replace('shard', 'labeled') + '.jsonl')
        log_path = out_path + '.log'
        log = open(log_path, 'a', encoding='utf8')
        proc = subprocess.Popen(
            [sys.executable, WORKER, shard_path, out_path, str(args.depth), str(args.hash)],
            stdout=log, stderr=subprocess.STDOUT, creationflags=flags,
        )
        fleet.append({'pid': proc.pid, 'shard': shard_path, 'out': out_path, 'log': log_path})

    manifest = os.path.join(args.out_dir, 'fleet.json')
    with open(manifest, 'w', encoding='utf8') as fh:
        json.dump({'startedEpoch': time.time(), 'depth': args.depth, 'hash': args.hash,
                   'workers': len(fleet), 'sf': SF, 'fleet': fleet}, fh, indent=2)
    print(f'launched {len(fleet)} workers (depth {args.depth}, Hash {args.hash}, BelowNormal, detached)', flush=True)
    print(f'manifest: {manifest}', flush=True)
    print(f'monitor:  type {os.path.join(args.out_dir, "labeled00.jsonl.log")}', flush=True)


if __name__ == '__main__':
    main()
