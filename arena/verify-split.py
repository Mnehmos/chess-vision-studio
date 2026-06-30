#!/usr/bin/env python3
"""Pre-flight gate for promotion-eligible NNUE training (#33).

Verifies a source-clean train/holdout split and emits a dataset manifest (per-file sha256 + the
deterministic seed). Exits non-zero — failing the training pipeline BEFORE any GPU time — on
leakage, a row missing a stable source key, or a single unsplit promotable input. Run it ahead of
the trainer:

    python arena/verify-split.py --train train.jsonl --validation val.jsonl --test test.jsonl \
        --seed 1234 --deterministic --manifest-out arena/out/dataset-manifest.json

The split itself is produced upstream by the source-split tooling (rust-engine #9
`split_by_source.py`); this is the trainer-side defense-in-depth check + the run's provenance record.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_split_guard as ssg  # noqa: E402


def build_manifest(train, validation=None, test=None, seed=0, deterministic=False,
                   allow_unsafe_row_split=False):
    """Verify + describe the split. Raises SystemExit (fail-closed) on any split violation."""
    split = ssg.resolve_split(train, validation, test, allow_unsafe_row_split=allow_unsafe_row_split)
    seed_record = ssg.seed_everything(seed, deterministic=deterministic)
    manifest = {
        "promotable": split["promotable"],
        "seed": seed_record,
        "datasetHashes": split.get("hashes", {}),
        "trainRows": len(split["train"]),
        "holdoutFiles": {p: len(rows) for p, rows in split["holdouts"].items()},
    }
    if "note" in split:
        manifest["note"] = split["note"]
    return manifest


def main(argv=None):
    ap = argparse.ArgumentParser(description="Verify a source-clean NNUE train/holdout split (#33).")
    ap.add_argument("--train", required=True)
    ap.add_argument("--validation")
    ap.add_argument("--test")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--deterministic", action="store_true")
    ap.add_argument("--allow-unsafe-row-split", action="store_true",
                    help="dev-only: accept a single unsplit input; the manifest is marked NON-PROMOTABLE")
    ap.add_argument("--manifest-out", help="write the dataset manifest JSON here")
    args = ap.parse_args(argv)

    manifest = build_manifest(
        args.train, args.validation, args.test,
        seed=args.seed, deterministic=args.deterministic,
        allow_unsafe_row_split=args.allow_unsafe_row_split,
    )
    text = json.dumps(manifest, indent=2)
    if args.manifest_out:
        with open(args.manifest_out, "w", encoding="utf8") as fh:
            fh.write(text + "\n")
    print(text)
    status = "PROMOTABLE" if manifest["promotable"] else "NON-PROMOTABLE (dev)"
    print(f"split OK: {status}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
