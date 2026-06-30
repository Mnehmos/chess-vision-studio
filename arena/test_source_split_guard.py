#!/usr/bin/env python3
"""Tests for the source-split + determinism guards (#33). No torch/numpy required — the seeding is
ImportError-guarded. Standalone: `python arena/test_source_split_guard.py`."""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import source_split_guard as g  # noqa: E402

_vspec = importlib.util.spec_from_file_location("verify_split", HERE / "verify-split.py")
vs = importlib.util.module_from_spec(_vspec)
_vspec.loader.exec_module(vs)


def _row(key=None, src=None):
    r = {"fen": "F"}
    if key is not None:
        r["splitKey"] = key
    if src is not None:
        r["source"] = src
    return r


# ---- stable_source_key ----
def test_key_splitkey_first():
    assert g.stable_source_key({"splitKey": "lichess/g1", "source": {"gameId": "other"}}) == "lichess/g1"


def test_key_source_id_and_game():
    assert g.stable_source_key(_row(src={"sourceId": "lichess", "gameId": "g1"})) == "lichess/g1"


def test_key_game_only():
    assert g.stable_source_key(_row(src={"gameId": "g1"})) == "g1"


def test_key_none_without_source():
    assert g.stable_source_key({"fen": "F"}) is None  # NO FEN fallback


def test_key_whitespace_is_absent():
    assert g.stable_source_key({"splitKey": "   "}) is None


def test_join_delimiter_ambiguity_is_fail_safe():
    # distinct (sourceId, gameId) pairs CAN collide on the joined key — fail-safe (over-refuses),
    # never masks a real same-game leak. Matches #9.
    assert g.stable_source_key({"source": {"sourceId": "a/b", "gameId": "c"}}) == "a/b/c"
    assert g.stable_source_key({"source": {"sourceId": "a", "gameId": "b/c"}}) == "a/b/c"


def test_source_not_a_dict_is_none():
    assert g.stable_source_key({"source": "lichess"}) is None  # str, not dict -> fail closed
    assert g.stable_source_key({"source": ["x"]}) is None


# ---- leakage_violations / assert_no_leakage ----
def test_clean_split_no_violations():
    train = [_row("a"), _row("b")]
    holdout = [_row("c"), _row("d")]
    assert g.leakage_violations(train, holdout) == []
    g.assert_no_leakage(train, holdout)  # no raise


def test_shared_key_is_leakage():
    train = [_row("a"), _row("b")]
    holdout = [_row("b")]  # 'b' in both
    v = g.leakage_violations(train, holdout)
    assert len(v) == 1 and "leakage" in v[0]
    try:
        g.assert_no_leakage(train, holdout)
        assert False, "expected SystemExit on leakage"
    except SystemExit:
        pass


def test_missing_key_fails_closed():
    train = [{"fen": "F"}]  # no key
    holdout = [_row("c")]
    assert any("train row 0" in x for x in g.leakage_violations(train, holdout))
    holdout_bad = [{"fen": "F"}]
    assert any("holdout row 0" in x for x in g.leakage_violations([_row("a")], holdout_bad))


# ---- seed_everything ----
def test_seed_records_and_seeds_random():
    rec = g.seed_everything(1234, deterministic=True)
    assert rec["seed"] == 1234 and rec["deterministic"] is True
    assert "random" in rec["seeded"]  # random always available


def test_seed_rejects_non_int():
    for bad in ("7", 7.0, None, True):  # bool is an int subclass but must be rejected
        try:
            g.seed_everything(bad)
            assert False, f"expected SystemExit for seed={bad!r}"
        except SystemExit:
            pass


def test_seed_records_broken_library_without_crashing():
    rec = {"seed": 1, "deterministic": True, "seeded": []}

    def boom():
        raise OSError("WinError 127: c10_cuda.dll not found")

    g._try_seed(rec, "torch", boom)  # a present-but-BROKEN lib must be recorded, not raised
    assert "torch" not in rec["seeded"]
    assert rec["seedFailures"]["torch"].startswith("OSError")


def test_seed_records_gpu_caveat_when_deterministic():
    assert "gpuNondeterminismCaveat" in g.seed_everything(1, deterministic=True)
    assert "gpuNondeterminismCaveat" not in g.seed_everything(1, deterministic=False)


# ---- resolve_split (uses temp files) ----
def _write(path, rows):
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf8")


def test_resolve_split_clean_is_promotable():
    with tempfile.TemporaryDirectory() as d:
        tr, va = Path(d) / "train.jsonl", Path(d) / "val.jsonl"
        _write(tr, [_row("a"), _row("b")])
        _write(va, [_row("c")])
        res = g.resolve_split(str(tr), str(va))
        assert res["promotable"] is True
        assert len(res["train"]) == 2 and str(va) in res["holdouts"]
        assert str(tr) in res["hashes"] and str(va) in res["hashes"]  # dataset hashes recorded


def test_resolve_split_leaky_refused():
    with tempfile.TemporaryDirectory() as d:
        tr, va = Path(d) / "train.jsonl", Path(d) / "val.jsonl"
        _write(tr, [_row("a")])
        _write(va, [_row("a")])  # leak
        try:
            g.resolve_split(str(tr), str(va))
            assert False, "expected SystemExit on leaky split"
        except SystemExit:
            pass


def test_resolve_split_unsplit_refused_unless_unsafe():
    with tempfile.TemporaryDirectory() as d:
        tr = Path(d) / "train.jsonl"
        _write(tr, [_row("a")])
        try:
            g.resolve_split(str(tr))  # no holdout, not unsafe
            assert False, "expected SystemExit refusing unsplit promotable run"
        except SystemExit:
            pass
        res = g.resolve_split(str(tr), allow_unsafe_row_split=True)
        assert res["promotable"] is False and "NON-PROMOTABLE" in res["note"]


def test_file_sha256_is_stable():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "x.jsonl"
        p.write_text("hello\n", encoding="utf8")
        assert g.file_sha256(str(p)) == g.file_sha256(str(p))


# ---- verify-split CLI gate ----
def test_verify_split_manifest_clean():
    with tempfile.TemporaryDirectory() as d:
        tr, va = Path(d) / "train.jsonl", Path(d) / "val.jsonl"
        _write(tr, [_row("a"), _row("b")])
        _write(va, [_row("c")])
        m = vs.build_manifest(str(tr), str(va), seed=7, deterministic=True)
        assert m["promotable"] is True and m["seed"]["seed"] == 7
        assert m["trainRows"] == 2 and str(tr) in m["datasetHashes"]


def test_verify_split_main_writes_manifest_and_refuses_leak():
    with tempfile.TemporaryDirectory() as d:
        tr, va, mo = Path(d) / "train.jsonl", Path(d) / "val.jsonl", Path(d) / "manifest.json"
        _write(tr, [_row("a")])
        _write(va, [_row("b")])
        rc = vs.main(["--train", str(tr), "--validation", str(va), "--seed", "3", "--manifest-out", str(mo)])
        assert rc == 0 and mo.exists()
        loaded = json.loads(mo.read_text(encoding="utf8"))
        assert loaded["promotable"] is True and loaded["seed"]["seed"] == 3
        _write(va, [_row("a")])  # now leaks 'a' -> CLI must fail closed
        try:
            vs.main(["--train", str(tr), "--validation", str(va)])
            assert False, "expected SystemExit on leaky split via CLI"
        except SystemExit:
            pass


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"ok   {fn.__name__}")
        except AssertionError as e:
            print(f"FAIL {fn.__name__}: {e}")
            failed += 1
    print(f"\n{len(fns)} tests, {failed} failed")
    sys.exit(1 if failed else 0)
