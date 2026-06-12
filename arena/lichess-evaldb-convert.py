# Convert the public Lichess eval database (database.lichess.org/lichess_db_eval.jsonl.zst)
# into our raw-NNUE training row format {fen, cp, res}.
#
#   python arena/lichess-evaldb-convert.py in.jsonl[.zst] out.jsonl [--min-depth 16]
#
# Lichess rows look like:
#   {"fen": "<fen>", "evals": [{"pvs": [{"cp": 53, "line": "..."} | {"mate": 5, ...}],
#                               "knodes": 12345, "depth": 28}, ...]}
# We take the DEEPEST eval >= --min-depth, its first pv (best line), and emit
# White-POV cp clamped to a mate-scale ceiling. res is set to the pure-eval
# sentinel (0.5) so the trainer's lambda blend can be driven to 1.0 for these
# rows — Lichess evals carry no game result. Teacher doctrine intact: this is
# Stockfish-on-Lichess cp, same target as our own relabeler; no CVS in label.
import json
import sys

MATE_CP = 10000


def arg(flag, dflt=None):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else dflt


EVALDB_URL = 'https://database.lichess.org/lichess_db_eval.jsonl.zst'


def open_maybe_zst(path):
    import zstandard  # pip install zstandard
    # path may be a local file or the literal "URL" to stream the public DB.
    if path == 'URL':
        import urllib.request
        resp = urllib.request.urlopen(EVALDB_URL)
        return zstandard.ZstdDecompressor().stream_reader(resp)
    if path.endswith('.zst'):
        return zstandard.ZstdDecompressor().stream_reader(open(path, 'rb'))
    return open(path, 'rb')


def line_iter(stream):
    # zstd stream_reader yields arbitrary byte chunks; rebuild lines ourselves
    # so we can stop early without decoding the whole 21GB.
    buf = b''
    while True:
        chunk = stream.read(1 << 20)
        if not chunk:
            break
        buf += chunk
        while b'\n' in buf:
            line, buf = buf.split(b'\n', 1)
            yield line


def cp_from_pv(pv):
    if 'cp' in pv:
        return max(-MATE_CP, min(MATE_CP, int(pv['cp'])))
    if 'mate' in pv:
        m = int(pv['mate'])
        return MATE_CP if m > 0 else -MATE_CP
    return None


def main():
    inp, out = sys.argv[1], sys.argv[2]
    min_depth = int(arg('--min-depth', '16'))
    cap = int(arg('--cap', '0'))  # 0 = no cap; else stop after this many kept
    # --max-pieces N: keep only endgame positions with <= N total pieces on
    # board (kings included). 12 ~ "real endgame"; conversion/fortress data.
    max_pieces = int(arg('--max-pieces', '0'))
    kept = skipped = 0
    src = open_maybe_zst(inp)
    rows = line_iter(src) if hasattr(src, 'read') and inp in ('URL',) or inp.endswith('.zst') else src
    with open(out, 'w', encoding='utf8') as w:
        for raw in rows:
            line = raw.decode('utf8') if isinstance(raw, (bytes, bytearray)) else raw
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
                fen = row['fen']
                if max_pieces:
                    board_part = fen.split(' ', 1)[0]
                    pieces = sum(1 for ch in board_part if ch.isalpha())
                    if pieces > max_pieces:
                        skipped += 1
                        continue
                evals = row.get('evals') or []
                best = max((e for e in evals if e.get('depth', 0) >= min_depth),
                           key=lambda e: e.get('depth', 0), default=None)
                if best is None or not best.get('pvs'):
                    skipped += 1
                    continue
                cp = cp_from_pv(best['pvs'][0])
                if cp is None:
                    skipped += 1
                    continue
                # Lichess eval cp is from White's POV already.
                w.write(json.dumps({'fen': fen, 'cp': cp, 'res': 0.5}) + '\n')
                kept += 1
                if cap and kept >= cap:
                    break
                if kept % 100000 == 0:
                    print(f'  kept {kept} (skipped {skipped})', flush=True)
            except Exception:
                skipped += 1
    print(f'kept {kept}, skipped {skipped} (min_depth {min_depth})')


if __name__ == '__main__':
    main()
