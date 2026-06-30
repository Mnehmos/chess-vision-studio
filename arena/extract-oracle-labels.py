#!/usr/bin/env python3
"""Extract STANDALONE oracle-label records from a relabeled corpus (#34 slice 2).

The relabel worker (#34 slice 1) writes fat rows that carry the oracle label NESTED under an
`oracleLabel` block. The corpus invariant linter (rust-engine #9 `lint_corpus.py`, schema
`training/schemas/oracle-label.schema.json`) instead validates STANDALONE oracle-label records
(`additionalProperties:false`, required `schemaVersion`/`seedId`/`labeler`/`score`/`labelStatus`).

This lifts each nested block to a standalone record and writes them to a sidecar `*.labels.jsonl`,
so the relabel output is directly consumable by #9's corpus tooling. Rows that cannot yield a valid
record (no oracle label, no seedId, or an incomplete labeler) are SKIPPED and counted — never
emitted as a malformed label. INV-4 (finder != labeler) holds by construction here: the labeler is
always Stockfish, never the CVS engine that found the seed.

    python arena/extract-oracle-labels.py <relabeled.jsonl> [out.labels.jsonl]
"""
import json
import sys

LABEL_STATUSES = ("usable", "quarantined", "conflict")
# Allowed keys per the #9 oracle-label schema (additionalProperties:false at BOTH levels).
_ALLOWED = {"schemaVersion", "seedId", "labeler", "score", "pv", "stabilization", "labelStatus"}
_ALLOWED_LABELER = {"engineId", "binarySha256", "version", "options", "budget"}


def to_oracle_label_record(fat_row):
    """Lift a worker fat row's nested `oracleLabel` block to a standalone #9 oracle-label record.
    Returns (record, None) on success or (None, reason) when the row cannot yield a valid record."""
    if not isinstance(fat_row, dict):
        return None, "row is not an object"
    ol = fat_row.get("oracleLabel")
    if not isinstance(ol, dict):
        return None, "no oracleLabel block"

    seed_id = ol.get("seedId") or fat_row.get("seedId")
    if not (isinstance(seed_id, str) and seed_id.strip()):
        return None, "missing seedId (oracle-label requires a non-empty seedId)"

    labeler = ol.get("labeler")
    if not isinstance(labeler, dict):
        return None, "missing labeler object"
    for field in ("engineId", "binarySha256", "version"):
        if not (isinstance(labeler.get(field), str) and labeler.get(field).strip()):
            return None, f"labeler.{field} must be a non-empty string"

    label_status = ol.get("labelStatus", "quarantined")
    if label_status not in LABEL_STATUSES:
        return None, f"labelStatus {label_status!r} not in {LABEL_STATUSES}"

    record = {
        "schemaVersion": 1,
        "seedId": seed_id.strip(),
        # Prune to the #9-schema-allowed labeler keys so a stray upstream field (engine telemetry,
        # etc.) can never make the emitted record fail the linter's labeler additionalProperties:false.
        "labeler": {k: labeler[k] for k in _ALLOWED_LABELER if k in labeler},
        "score": ol.get("score") if isinstance(ol.get("score"), dict) else {},
        "labelStatus": label_status,
    }
    # Carry the optional schema-allowed fields through when the upstream row has them.
    pv = ol.get("pv", fat_row.get("pv"))
    if isinstance(pv, list):
        record["pv"] = pv
    stab = ol.get("stabilization", fat_row.get("stabilization"))
    if isinstance(stab, dict):
        record["stabilization"] = stab

    # Defense in depth: never emit an unknown top-level key (would fail additionalProperties).
    assert set(record).issubset(_ALLOWED), f"unexpected keys {set(record) - _ALLOWED}"
    return record, None


def extract(rows):
    """Map fat rows to (records, skipped) where skipped is a list of (index, reason)."""
    records, skipped = [], []
    for i, row in enumerate(rows):
        rec, reason = to_oracle_label_record(row)
        if rec is None:
            skipped.append((i, reason))
        else:
            records.append(rec)
    return records, skipped


def main(argv):
    if len(argv) < 2:
        sys.exit("usage: extract-oracle-labels.py <relabeled.jsonl> [out.labels.jsonl]")
    in_path = argv[1]
    out_path = argv[2] if len(argv) > 2 else in_path.rsplit(".", 1)[0] + ".labels.jsonl"

    rows, parse_errors = [], 0
    with open(in_path, encoding="utf8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                parse_errors += 1  # a bad line is a counted skip, not a fatal abort
    records, skipped = extract(rows)

    with open(out_path, "w", encoding="utf8") as fh:
        for rec in records:
            fh.write(json.dumps(rec) + "\n")

    print(f"{in_path}: {len(records)} oracle-label records -> {out_path} "
          f"({len(skipped)} rows skipped, {parse_errors} unparseable lines)", flush=True)
    # Summarize skip reasons so a corpus operator sees what was dropped (no silent truncation).
    reasons = {}
    for _, reason in skipped:
        reasons[reason] = reasons.get(reason, 0) + 1
    for reason, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
        print(f"  skipped {n}: {reason}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
