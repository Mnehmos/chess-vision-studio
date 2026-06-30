#!/usr/bin/env python3
"""Tests for the RSI orchestrator — proves every gate fires (source-split abort, SPRT/INV-1 promote
gate, champion safety, ledger chain). No GPU/games: the train + gauntlet phases are injected.
Standalone: `python arena/test_rsi_orchestrator.py`."""
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import rsi_orchestrator as o  # noqa: E402


def _write(path, rows):
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf8")


def _clean_split(d):
    tr, va = Path(d) / "train.jsonl", Path(d) / "val.jsonl"
    _write(tr, [{"fen": "F1", "splitKey": "g1"}, {"fen": "F2", "splitKey": "g2"}])
    _write(va, [{"fen": "F3", "splitKey": "g3"}])
    return str(tr), str(va)


def _leaky_split(d):
    tr, va = Path(d) / "train.jsonl", Path(d) / "val.jsonl"
    _write(tr, [{"fen": "F1", "splitKey": "g1"}])
    _write(va, [{"fen": "F2", "splitKey": "g1"}])  # g1 in BOTH -> source leak
    return str(tr), str(va)


# ---- SPRT gate (#5 / INV-1) ----
def test_sprt_bounds_and_decision():
    lower, upper = o.sprt_bounds(0.05, 0.05)
    assert upper > 0 > lower
    assert o.sprt_decision(upper + 0.1) == "accept"
    assert o.sprt_decision(lower - 0.1) == "reject"
    assert o.sprt_decision(0.0) == "continue"  # between bounds -> keep going, never promote


# ---- ledger chain (#12) ----
def test_ledger_append_chains_tamper_evident():
    with tempfile.TemporaryDirectory() as d:
        led = str(Path(d) / "ledger.jsonl")
        r1 = o.ledger_append(led, {"kind": "a", "x": 1})
        r2 = o.ledger_append(led, {"kind": "b", "x": 2})
        assert r1["appendOnlyHash"] != r2["appendOnlyHash"]
        # r2's hash is chained to r1's (so editing r1 later breaks r2's chain)
        bare_r2 = {k: v for k, v in r2.items() if k != "appendOnlyHash"}
        assert r2["appendOnlyHash"] == o.chain_hash(r1["appendOnlyHash"], bare_r2)


# ---- the gated generation ----
def _run(d, llr, train_calls):
    tr, va = _clean_split(d)
    led = str(Path(d) / "ledger.jsonl")

    def train_fn(split, seed):
        train_calls.append((split, seed))
        return "cand-net"

    def gauntlet_fn(candidate, champion):
        return {"llr": llr, "wins": 10, "losses": 2, "draws": 8}

    cfg = {"champion": "champ-b23c75b8", "train": tr, "validation": va, "seed": 7}
    return o.run_generation(cfg, train_fn, gauntlet_fn, led), led


def test_promote_only_on_sprt_accept():
    with tempfile.TemporaryDirectory() as d:
        calls = []
        res, led = _run(d, 5.0, calls)  # llr 5 > upper(~2.94) -> accept
        assert res["promote"] is True and res["decision"] == "accept"
        assert res["new_champion"] == "cand-net"
        assert calls and calls[0][1] == 7  # train ran on the verified split, seeded
        rec = json.loads(Path(led).read_text(encoding="utf8").splitlines()[-1])
        assert rec["outcome"] == "promote" and rec["sprt"]["decision"] == "accept"
        assert rec["champion"] == "champ-b23c75b8" and rec["candidate"] == "cand-net"


def test_freeze_on_reject_champion_unchanged():
    with tempfile.TemporaryDirectory() as d:
        res, _ = _run(d, -5.0, [])  # llr -5 < lower -> reject
        assert res["promote"] is False and res["decision"] == "reject"
        assert res["new_champion"] == "champ-b23c75b8"  # CHAMPION NEVER OVERWRITTEN


def test_inconclusive_freezes_not_promotes():
    with tempfile.TemporaryDirectory() as d:
        res, _ = _run(d, 0.5, [])  # between bounds -> continue -> NOT a promote (INV-1)
        assert res["promote"] is False and res["new_champion"] == "champ-b23c75b8"


def test_leaky_split_aborts_before_training():
    with tempfile.TemporaryDirectory() as d:
        tr, va = _leaky_split(d)
        calls = []

        def train_fn(**_):
            calls.append(1)
            return "x"

        def gauntlet_fn(**_):
            return {"llr": 5.0}

        cfg = {"champion": "champ", "train": tr, "validation": va}
        try:
            o.run_generation(cfg, train_fn, gauntlet_fn, str(Path(d) / "l.jsonl"))
            assert False, "expected SystemExit on a leaky split"
        except SystemExit:
            pass
        assert calls == []  # training NEVER ran — fail-closed before any GPU time


def test_non_promotable_split_never_promotes_even_on_accept():
    # The allow_unsafe_row_split dev escape hatch yields promotable=False; even a crossed SPRT must
    # NOT let it reach the champion (Finding 1: bind INV-1 to INV-3 at promotion).
    with tempfile.TemporaryDirectory() as d:
        tr = Path(d) / "train.jsonl"
        _write(tr, [{"fen": "F1", "splitKey": "g1"}])  # single unsplit corpus -> promotable False
        led = str(Path(d) / "ledger.jsonl")
        cfg = {"champion": "champ", "train": str(tr), "allow_unsafe_row_split": True}
        res = o.run_generation(cfg, lambda split, seed: "cand", lambda candidate, champion: {"llr": 9.0}, led)
        assert res["decision"] == "accept"  # SPRT crossed...
        assert res["promote"] is False and res["new_champion"] == "champ"  # ...but champion frozen


def test_non_finite_llr_never_promotes_and_ledger_is_valid_json():
    with tempfile.TemporaryDirectory() as d:
        tr, va = _clean_split(d)
        led = str(Path(d) / "ledger.jsonl")
        cfg = {"champion": "champ", "train": tr, "validation": va}
        res = o.run_generation(cfg, lambda split, seed: "cand", lambda candidate, champion: {"llr": float("nan")}, led)
        assert res["promote"] is False and res["decision"] == "invalid"
        raw = Path(led).read_text(encoding="utf8")
        assert "NaN" not in raw  # no bare NaN token
        last = json.loads(raw.splitlines()[-1])  # strict-parses
        assert last["sprt"]["llr"] is None


def test_ledger_tamper_is_detectable():
    with tempfile.TemporaryDirectory() as d:
        led = str(Path(d) / "ledger.jsonl")
        o.ledger_append(led, {"kind": "a", "x": 1})
        o.ledger_append(led, {"kind": "b", "x": 2})
        assert o.verify_ledger(led) == []  # intact
        # tamper row 0's content AND re-stamp its own hash to look self-consistent
        rows = [json.loads(line) for line in Path(led).read_text(encoding="utf8").splitlines()]
        rows[0]["x"] = 999
        rows[0]["appendOnlyHash"] = o.chain_hash("", {k: v for k, v in rows[0].items() if k != "appendOnlyHash"})
        Path(led).write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf8")
        assert o.verify_ledger(led) == [1]  # row 1 chained to the OLD row-0 hash -> break detected


def test_phase_exception_ledgers_an_abort():
    with tempfile.TemporaryDirectory() as d:
        tr, va = _clean_split(d)
        led = str(Path(d) / "ledger.jsonl")

        def boom(**_):
            raise RuntimeError("gauntlet crashed")

        cfg = {"champion": "champ", "train": tr, "validation": va}
        try:
            o.run_generation(cfg, lambda split, seed: "cand", boom, led)
            assert False, "expected the exception to propagate"
        except RuntimeError:
            pass
        rec = json.loads(Path(led).read_text(encoding="utf8").splitlines()[-1])
        assert rec["outcome"] == "aborted" and "gauntlet crashed" in rec["error"]
        assert rec["champion"] == "champ"  # champion untouched on a crash


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
