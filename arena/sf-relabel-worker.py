# Stockfish relabel worker (one shard, one SF process). #34: metadata-preserving + oracle-identified.
#
#   python arena/sf-relabel-worker.py <shard.jsonl> <out.jsonl> [depth] [hash_mb]
#
# Reads rich input rows, labels each with SF at fixed depth, and appends a row that PRESERVES
# every input field (source/gameId/splitKey/seedId/finder/reason/stabilization/...) and attaches
# the oracle (Stockfish) label + labeler identity (engineId/binarySha256/version/options/budget),
# matching the rust-engine #9 oracle-label schema. RESUMABLE: skips as many input rows as the
# output already has. Failed FENs -> <out>.failed.txt.
# Teacher doctrine: SF labels train; SF never powers runtime eval.
import hashlib
import json
import subprocess
import sys
import time

SF = 'f:/tools/stockfish/stockfish/stockfish-windows-x86-64-avx2.exe'
DEFAULT_STOCKFISH_REVIEW_DEPTH = 24


def sha256_file(path):
    try:
        with open(path, 'rb') as f:
            return hashlib.sha256(f.read()).hexdigest()
    except OSError:
        return None


def labeler_identity(sf_path, sf_name, threads, hash_mb, depth):
    """The oracle's identity (matches #9 oracle-label.labeler). engineId derives from SF's
    `id name` (e.g. 'Stockfish 16' -> 'stockfish-16'); binarySha256 pins the exact binary."""
    parts = sf_name.split() if sf_name else []
    ver = parts[-1] if parts else 'unknown'
    return {
        'engineId': f'stockfish-{ver}',
        'binarySha256': sha256_file(sf_path),
        'version': sf_name,
        'options': {'Threads': threads, 'Hash': hash_mb},
        'budget': {'depth': depth},
    }


def build_relabeled_row(input_row, cp, mate, depth, labeler, success):
    """Preserve ALL input metadata and attach the oracle label + labeler identity. The legacy
    sfCp/sfMate/sfDepth fields are kept for back-compat; the oracleLabel block is a near-#9
    oracle-label record (schemaVersion/seedId/labeler/score/labelStatus)."""
    return {
        **input_row,
        'sfCp': cp,
        'sfMate': mate,
        'sfDepth': depth,
        'oracleLabel': {
            'schemaVersion': 1,
            'seedId': input_row.get('seedId'),
            'labeler': labeler,
            'score': {'cp': cp, 'mate': mate},
            'labelStatus': 'usable' if success else 'quarantined',
        },
    }


def start_sf(sf_path, threads, hash_mb):
    """Launch SF, set options, and capture its `id name` version string from the handshake."""
    p = subprocess.Popen([sf_path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
    p.stdin.write(f'uci\nsetoption name Threads value {threads}\nsetoption name Hash value {hash_mb}\nisready\n')
    p.stdin.flush()
    name = 'Stockfish'
    while True:
        ln = p.stdout.readline()
        if ln.startswith('id name '):
            name = ln[8:].strip()
        if 'readyok' in ln or not ln:
            break
    return p, name


def main(argv):
    shard, out_path = argv[1], argv[2]
    depth = int(argv[3]) if len(argv) > 3 else DEFAULT_STOCKFISH_REVIEW_DEPTH
    hash_mb = int(argv[4]) if len(argv) > 4 else 256
    threads = 1

    done = 0
    try:
        with open(out_path, encoding='utf8') as f:
            for _ in f:
                done += 1
    except FileNotFoundError:
        pass

    p, sf_name = start_sf(SF, threads, hash_mb)
    labeler = labeler_identity(SF, sf_name, threads, hash_mb, depth)

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
            success = False
            cp = mate = None
            for _attempt in range(2):
                try:
                    p.stdin.write(f'position fen {fen}\ngo depth {depth}\n')
                    p.stdin.flush()
                except OSError:
                    print(f'[{shard}] Stockfish crashed on write, restarting...', flush=True)
                    p, _ = start_sf(SF, threads, hash_mb)
                    continue

                crash = False
                while True:
                    ln = p.stdout.readline()
                    if not ln:
                        crash = True
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

                if crash:
                    print(f'[{shard}] Stockfish crashed on read, restarting...', flush=True)
                    p, _ = start_sf(SF, threads, hash_mb)
                    continue

                success = True
                break

            if not success:
                failed.write(fen + '\n')
                failed.flush()

            out.write(json.dumps(build_relabeled_row(j, cp, mate, depth, labeler, success)) + '\n')
            n += 1
            if n % 10 == 0:
                out.flush()
            if n % 500 == 0:
                rate = n / (time.time() - t0)
                print(f'{shard}: {done+n} labeled ({rate:.0f}/s)', flush=True)
    out.close()
    failed.close()
    print(f'{shard}: DONE {done+n} rows in {time.time()-t0:.0f}s', flush=True)


if __name__ == '__main__':
    main(sys.argv)
