#!/usr/bin/env python3
"""Tests for the metadata-preserving Stockfish relabel worker (#34). No real Stockfish needed:
exercises the pure row-builder + labeler-identity functions. Standalone:
`python arena/test_sf_relabel_worker.py`."""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("sf_relabel_worker", HERE / "sf-relabel-worker.py")
w = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(w)  # the __main__ guard means this does NOT run the relabel loop

INPUT = {
    "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "res": 0.5,
    "seedId": "seed-1",
    "source": {"kind": "real_game", "sourceId": "lichess", "gameId": "g1", "ply": 12},
    "splitKey": "lichess/g1",
    "finder": {"engineId": "cvs-finder", "binarySha256": "aa", "modelSha256": "bb", "optionsHash": "cc"},
    "reason": "oracle_disagreement",
    "stabilization": {"status": "stable_at_budget"},
    "x-custom-namespace": {"keep": "me"},
}
LABELER = {
    "engineId": "stockfish-16",
    "binarySha256": "dd",
    "version": "Stockfish 16",
    "options": {"Threads": 1, "Hash": 256},
    "budget": {"depth": 24},
}


def test_preserves_all_input_fields():
    row = w.build_relabeled_row(INPUT, 34, None, 24, LABELER, True)
    for k, v in INPUT.items():
        assert row[k] == v, f"lost input field {k}"


def test_attaches_oracle_label():
    row = w.build_relabeled_row(INPUT, 34, None, 24, LABELER, True)
    ol = row["oracleLabel"]
    assert ol["schemaVersion"] == 1
    assert ol["seedId"] == "seed-1"
    assert ol["labeler"] == LABELER
    assert ol["score"] == {"cp": 34, "mate": None}
    assert ol["labelStatus"] == "usable"
    # legacy fields preserved for back-compat with existing consumers
    assert row["sfCp"] == 34 and row["sfMate"] is None and row["sfDepth"] == 24


def test_failed_row_is_quarantined():
    row = w.build_relabeled_row(INPUT, None, None, 24, LABELER, False)
    assert row["oracleLabel"]["labelStatus"] == "quarantined"


def test_mate_score_carried():
    row = w.build_relabeled_row(INPUT, None, 3, 24, LABELER, True)
    assert row["oracleLabel"]["score"] == {"cp": None, "mate": 3}
    assert row["sfMate"] == 3


def test_labeler_identity_from_id_name():
    lid = w.labeler_identity("/nonexistent/sf.exe", "Stockfish 16.1", 1, 256, 24)
    assert lid["engineId"] == "stockfish-16.1"
    assert lid["version"] == "Stockfish 16.1"
    assert lid["options"] == {"Threads": 1, "Hash": 256}
    assert lid["budget"] == {"depth": 24}
    assert lid["binarySha256"] is None  # missing file -> None, no crash


def test_labeler_identity_unknown_name():
    lid = w.labeler_identity("/nonexistent/sf.exe", "", 1, 256, 24)
    assert lid["engineId"] == "stockfish-unknown"


def test_seed_id_optional():
    row = w.build_relabeled_row({"fen": "x", "res": 1.0}, 10, None, 24, LABELER, True)
    assert row["oracleLabel"]["seedId"] is None  # no seedId in input -> None, not a KeyError


class FakeStockfish:
    """In-process Stockfish stand-in: handshake -> `id name` + `readyok`; every `go` -> one
    info+bestmove with a fixed score. Exercises the worker's real SF I/O loop, resumability, and
    provenance end-to-end without a binary (the coverage gap the review flagged)."""

    def __init__(self, *args, **kwargs):
        self.buf = []
        self.stdin = self
        self.stdout = self

    def write(self, s):
        for cmd in s.splitlines():
            c = cmd.strip()
            if c == "isready":
                self.buf += ["id name Stockfish 16\n", "readyok\n"]
            elif c.startswith("go"):
                self.buf += ["info depth 24 score cp 20 pv e2e4\n", "bestmove e2e4\n"]
        return len(s)

    def flush(self):
        pass

    def readline(self):
        return self.buf.pop(0) if self.buf else ""


def test_main_integration_preserves_provenance_and_resumes():
    real_popen = w.subprocess.Popen
    w.subprocess.Popen = FakeStockfish
    try:
        with tempfile.TemporaryDirectory() as d:
            shard = Path(d) / "shard.jsonl"
            out = Path(d) / "out.jsonl"
            rows_in = [
                {"fen": "F1", "res": 1.0, "seedId": "s1", "source": {"gameId": "g1"}, "splitKey": "k1"},
                {"fen": "F2", "res": 0.0, "seedId": "s2", "source": {"gameId": "g2"}, "splitKey": "k2"},
            ]
            shard.write_text("\n".join(json.dumps(r) for r in rows_in) + "\n", encoding="utf8")
            w.main(["prog", str(shard), str(out), "24", "256"])
            outrows = [json.loads(ln) for ln in out.read_text(encoding="utf8").splitlines()]
            assert len(outrows) == 2
            assert outrows[0]["seedId"] == "s1" and outrows[0]["splitKey"] == "k1"  # provenance kept
            assert outrows[0]["oracleLabel"]["score"] == {"cp": 20, "mate": None}
            assert outrows[0]["oracleLabel"]["labeler"]["version"] == "Stockfish 16"
            assert outrows[0]["oracleLabel"]["labelStatus"] == "usable"
            # resumability: a re-run skips already-labeled rows (no duplication)
            w.main(["prog", str(shard), str(out), "24", "256"])
            outrows2 = [json.loads(ln) for ln in out.read_text(encoding="utf8").splitlines()]
            assert len(outrows2) == 2
    finally:
        w.subprocess.Popen = real_popen


def test_fleet_sharding_preserves_full_rows():
    fleet_spec = importlib.util.spec_from_file_location("relabel_fleet", HERE / "relabel-fleet.py")
    fleet = importlib.util.module_from_spec(fleet_spec)
    fleet_spec.loader.exec_module(fleet)
    rows = [
        {"fen": "F1", "res": 1.0, "seedId": "s1", "source": {"gameId": "g1"}},
        {"fen": "F2", "res": 0.0, "seedId": "s2", "source": {"gameId": "g2"}},
    ]
    with tempfile.TemporaryDirectory() as d:
        paths = fleet.shard(rows, 1, d)
        written = [json.loads(ln) for ln in Path(paths[0]).read_text(encoding="utf8").splitlines()]
        assert written == rows  # FULL rows preserved through sharding, not stripped to {fen}


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
