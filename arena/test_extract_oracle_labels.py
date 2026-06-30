#!/usr/bin/env python3
"""Tests for the standalone oracle-label extractor (#34 slice 2). Standalone; no external deps.
The `_validate_oracle_label` helper mirrors rust-engine #9's oracle-label.schema.json +
lint_corpus.validate_label, so we prove the emitted records would pass #9's corpus linter without
coupling to the other repo. `python arena/test_extract_oracle_labels.py`."""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("extract_oracle_labels", HERE / "extract-oracle-labels.py")
x = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(x)


def _validate_oracle_label(rec):
    """Mirror of #9 oracle-label.schema.json (required fields, additionalProperties:false, enums)."""
    errs = []
    sv = rec.get("schemaVersion")
    if sv != 1 or isinstance(sv, bool):  # bool is an int subclass; #9 rejects True/False
        errs.append("schemaVersion must be the integer 1")
    if not (isinstance(rec.get("seedId"), str) and rec.get("seedId")):
        errs.append("seedId must be a non-empty string")
    if rec.get("labelStatus") not in ("usable", "quarantined", "conflict"):
        errs.append("labelStatus not in enum")
    if not isinstance(rec.get("score"), dict):
        errs.append("score must be an object")
    lbl = rec.get("labeler")
    if not isinstance(lbl, dict):
        errs.append("labeler must be an object")
    else:
        for f in ("engineId", "binarySha256", "version"):
            if not (isinstance(lbl.get(f), str) and lbl.get(f)):
                errs.append(f"labeler.{f} must be a non-empty string")
        if not set(lbl).issubset({"engineId", "binarySha256", "version", "options", "budget"}):
            errs.append("unknown labeler field")
    for k in ("schemaVersion", "seedId", "labeler", "score", "labelStatus"):
        if k not in rec:
            errs.append(f"missing required {k}")
    if not set(rec).issubset({"schemaVersion", "seedId", "labeler", "score", "pv", "stabilization", "labelStatus"}):
        errs.append("unknown top-level field (additionalProperties:false)")
    if "pv" in rec and not isinstance(rec["pv"], list):
        errs.append("pv must be an array")
    if "stabilization" in rec and not isinstance(rec["stabilization"], dict):
        errs.append("stabilization must be an object")
    return errs


def fat_row(**over):
    row = {
        "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        "res": 0.5,
        "seedId": "seed-1",
        "source": {"kind": "real_game", "sourceId": "lichess", "gameId": "g1", "ply": 12},
        "splitKey": "lichess/g1",
        "finder": {"engineId": "cvs-finder", "binarySha256": "cvs", "modelSha256": "m", "optionsHash": "o"},
        "sfCp": 34, "sfMate": None, "sfDepth": 24,
        "oracleLabel": {
            "schemaVersion": 1,
            "seedId": "seed-1",
            "labeler": {
                "engineId": "stockfish-16",
                "binarySha256": "abc123",
                "version": "Stockfish 16",
                "options": {"Threads": 1, "Hash": 256},
                "budget": {"depth": 24},
            },
            "score": {"cp": 34, "mate": None},
            "labelStatus": "usable",
        },
    }
    row.update(over)
    return row


def test_valid_row_yields_schema_conformant_record():
    rec, reason = x.to_oracle_label_record(fat_row())
    assert reason is None
    assert _validate_oracle_label(rec) == [], _validate_oracle_label(rec)
    assert rec["seedId"] == "seed-1" and rec["labelStatus"] == "usable"
    assert rec["score"] == {"cp": 34, "mate": None}


def test_inv4_labeler_is_stockfish_not_the_finder():
    rec, _ = x.to_oracle_label_record(fat_row())
    assert rec["labeler"]["engineId"].startswith("stockfish-")
    assert rec["labeler"]["engineId"] != fat_row()["finder"]["engineId"]  # INV-4 by construction


def test_quarantined_status_carried_and_valid():
    row = fat_row()
    row["oracleLabel"]["labelStatus"] = "quarantined"
    rec, reason = x.to_oracle_label_record(row)
    assert reason is None and rec["labelStatus"] == "quarantined"
    assert _validate_oracle_label(rec) == []


def test_missing_seed_id_is_skipped():
    row = fat_row()
    row.pop("seedId")
    row["oracleLabel"]["seedId"] = None  # the worker copies a missing seedId as None
    rec, reason = x.to_oracle_label_record(row)
    assert rec is None and "seedId" in reason


def test_incomplete_labeler_is_skipped():
    row = fat_row()
    row["oracleLabel"]["labeler"]["binarySha256"] = None  # e.g. SF exe not found
    rec, reason = x.to_oracle_label_record(row)
    assert rec is None and "binarySha256" in reason


def test_no_oracle_label_is_skipped():
    rec, reason = x.to_oracle_label_record({"fen": "x", "res": 1.0})
    assert rec is None and "oracleLabel" in reason


def test_unknown_label_status_is_skipped():
    row = fat_row()
    row["oracleLabel"]["labelStatus"] = "definitely-winning"
    rec, reason = x.to_oracle_label_record(row)
    assert rec is None and "labelStatus" in reason


def test_pv_and_stabilization_carried_when_present():
    row = fat_row()
    row["oracleLabel"]["pv"] = ["e2e4", "e7e5"]
    row["stabilization"] = {"status": "stable-at-budget"}
    rec, reason = x.to_oracle_label_record(row)
    assert reason is None
    assert rec["pv"] == ["e2e4", "e7e5"] and rec["stabilization"] == {"status": "stable-at-budget"}
    assert _validate_oracle_label(rec) == []


def test_extract_counts_records_and_skips():
    rows = [fat_row(), {"fen": "x", "res": 1.0}, fat_row(seedId=None, oracleLabel={"labeler": {}})]
    records, skipped = x.extract(rows)
    assert len(records) == 1 and len(skipped) == 2
    assert _validate_oracle_label(records[0]) == []


def test_extra_labeler_field_is_pruned_to_schema():
    # A stray upstream labeler field (e.g. engine telemetry) the #9 schema forbids must be pruned so
    # the emitted record stays conformant (labeler additionalProperties:false) — never emit malformed.
    row = fat_row()
    row["oracleLabel"]["labeler"]["nodes"] = 123456
    rec, reason = x.to_oracle_label_record(row)
    assert reason is None
    assert "nodes" not in rec["labeler"], "stray labeler field must be pruned"
    assert _validate_oracle_label(rec) == []
    assert rec["labeler"]["engineId"] == "stockfish-16"
    assert rec["labeler"]["options"] == {"Threads": 1, "Hash": 256}  # allowed fields survive


def test_main_tolerates_unparseable_lines():
    with tempfile.TemporaryDirectory() as d:
        inp, outp = Path(d) / "relabeled.jsonl", Path(d) / "out.labels.jsonl"
        inp.write_text(
            json.dumps(fat_row()) + "\n{not valid json}\n" + json.dumps(fat_row()) + "\n",
            encoding="utf8",
        )
        rc = x.main(["prog", str(inp), str(outp)])  # the bad line must NOT abort the run
        assert rc == 0
        recs = [json.loads(line) for line in outp.read_text(encoding="utf8").splitlines()]
        assert len(recs) == 2  # both valid rows emitted; the unparseable line skipped
        for r in recs:
            assert _validate_oracle_label(r) == []


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
