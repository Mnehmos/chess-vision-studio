#!/usr/bin/env python3
"""Source-split + determinism guards for promotion-eligible NNUE training (#33).

The trainers historically derived a *position-level* holdout inside the trainer
(`hold = (np.arange(n) % 50) == 7`) over a single unsplit corpus. That leaks sibling positions
from the same game/source into both train and holdout, which invalidates P-EVAL-K/P-EVAL-C capacity
and corpus comparisons. Training was also unseeded, so artifacts were not reproducible.

This module provides the two invariants a promotion-eligible run must enforce BEFORE training:

  1. NO SOURCE LEAKAGE (INV-3): every train row and every holdout (validation/test) row must carry a
     stable source/game key, and NO key may appear in both train and holdout. The key is
     splitKey-first (matching rust-engine #9 `lint_corpus`), then `source.sourceId`/`source.gameId`;
     there is NO FEN fallback (a FEN is a position, not a source identity). Rows lacking a key FAIL
     CLOSED — we cannot prove non-leakage for an unkeyed row.
  2. DETERMINISM: a single integer seed seeds random / numpy / torch so runs are reproducible enough
     for controlled probes. Exact GPU bit-reproducibility is NOT guaranteed (torch EmbeddingBag
     backward uses non-deterministic CUDA atomic scatter); declare multiple seeds for variance.

Pure-Python; numpy/torch are imported lazily (and ImportError-guarded) inside `seed_everything`, so
this module imports and tests without the training stack.
"""
import hashlib
import json


def stable_source_key(row):
    """The row's source/game identity. splitKey-first (matches rust-engine #9 `lint_corpus`), then
    `source.sourceId`/`source.gameId` joined as 'sourceId/gameId'. Returns None when no stable key
    exists (NO FEN fallback) so callers FAIL CLOSED. Whitespace-only strings count as absent.

    The 'sid/gid' join (and the bare-gameId fallback) is delimiter-ambiguous, so distinct sources
    CAN collide on one key — but that only OVER-refuses (flags two different sources as a leak); it
    can never give two rows of the SAME game different keys, so it cannot mask a real leak. This
    matches the #9 reference (fail-safe, shared, accepted)."""
    sk = row.get("splitKey")
    if isinstance(sk, str) and sk.strip():
        return sk.strip()
    src = row.get("source")
    if isinstance(src, dict):
        gid = src.get("gameId")
        if isinstance(gid, str) and gid.strip():
            sid = src.get("sourceId")
            if isinstance(sid, str) and sid.strip():
                return f"{sid.strip()}/{gid.strip()}"
            return gid.strip()
    return None


def leakage_violations(train_rows, holdout_rows):
    """Return a list of human-readable split violations; empty list == clean. A row missing a stable
    key is itself a violation (we cannot prove it does not leak)."""
    violations = []
    train_keys = {}
    for i, r in enumerate(train_rows):
        k = stable_source_key(r)
        if k is None:
            violations.append(f"train row {i}: no stable source/game key (INV-3, no FEN fallback)")
        else:
            train_keys.setdefault(k, i)
    for j, r in enumerate(holdout_rows):
        k = stable_source_key(r)
        if k is None:
            violations.append(f"holdout row {j}: no stable source/game key (INV-3, no FEN fallback)")
        elif k in train_keys:
            violations.append(
                f"source key {k!r} appears in BOTH train (row {train_keys[k]}) and holdout (row {j}) — leakage"
            )
    return violations


def assert_no_leakage(train_rows, holdout_rows):
    """FAIL CLOSED (SystemExit) if train/holdout share any source key or any row lacks a key."""
    violations = leakage_violations(train_rows, holdout_rows)
    if violations:
        raise SystemExit(
            "REFUSED: source-split leakage / missing key (INV-3) — promotion-eligible training "
            "requires a clean source split:\n  - " + "\n  - ".join(violations)
        )


def load_jsonl(path):
    rows = []
    with open(path, encoding="utf8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def file_sha256(path):
    """Content hash of a dataset file, for the run manifest (the issue refuses 'missing dataset
    hashes' for promotion-eligible runs)."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _try_seed(record, label, thunk):
    """Run a library-seeding thunk: record success on `seeded`, skip silently if the library is
    ABSENT (ImportError), and RECORD on `seedFailures` (rather than crash) if the library is present
    but BROKEN — e.g. a torch whose CUDA DLL is missing raises OSError/RuntimeError, NOT ImportError
    (an actual field failure: WinError 127 c10_cuda.dll)."""
    try:
        thunk()
        record["seeded"].append(label)
    except ImportError:
        pass
    except Exception as e:  # present but broken — record, never crash the caller
        record.setdefault("seedFailures", {})[label] = f"{type(e).__name__}: {e}"


def _seed_numpy(seed):
    import numpy as np

    np.random.seed(seed)


def _seed_torch(seed, deterministic):
    import torch

    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    if deterministic:
        torch.backends.cudnn.deterministic = True
        torch.backends.cudnn.benchmark = False
        try:
            torch.use_deterministic_algorithms(True, warn_only=True)
        except Exception:
            pass


def seed_everything(seed, deterministic=True):
    """Seed random / numpy / torch from one integer (lazy, failure-tolerant imports). Returns a
    record of what was seeded for the run manifest. With deterministic=True also pins cuDNN +
    torch.use_deterministic_algorithms(warn_only). Absent libs are skipped; present-but-broken libs
    are recorded under `seedFailures` (never crash the caller). NOTE: exact GPU bit-reproducibility
    is NOT guaranteed — see gpuNondeterminismCaveat."""
    if not isinstance(seed, int) or isinstance(seed, bool):
        raise SystemExit(f"--seed must be an integer, got {seed!r}")
    record = {"seed": seed, "deterministic": deterministic, "seeded": []}

    import random

    random.seed(seed)
    record["seeded"].append("random")

    _try_seed(record, "numpy", lambda: _seed_numpy(seed))
    _try_seed(record, "torch", lambda: _seed_torch(seed, deterministic))

    if deterministic:
        record["gpuNondeterminismCaveat"] = (
            "torch EmbeddingBag(mode=sum) backward uses non-deterministic CUDA atomic scatter; exact "
            "GPU bit-reproducibility is NOT guaranteed even with the seed pinned. Declare multiple "
            "seeds for variance estimates."
        )

    return record


def resolve_split(train, validation=None, test=None, allow_unsafe_row_split=False):
    """Load + guard a promotion-eligible split. Refuses a single unsplit input (no holdout) unless
    allow_unsafe_row_split (dev-only, NON-PROMOTABLE). On a real split, verifies NO source leakage
    across train and the union of holdouts, and records each file's sha256.

    Returns {train, holdouts, hashes, promotable, note?}."""
    holdout_paths = [p for p in (validation, test) if p]
    if not holdout_paths:
        if allow_unsafe_row_split:
            return {
                "train": load_jsonl(train),
                "holdouts": {},
                "hashes": {train: file_sha256(train)},
                "promotable": False,
                "note": "allow_unsafe_row_split: dev-only row split, NON-PROMOTABLE",
            }
        raise SystemExit(
            "REFUSED: promotion-eligible training needs an explicit holdout (--validation/--test). "
            "A single unsplit input derives a row-level holdout that leaks sources. Pass "
            "--allow-unsafe-row-split for a clearly non-promotable dev run."
        )
    train_rows = load_jsonl(train)
    holdouts = {p: load_jsonl(p) for p in holdout_paths}
    all_holdout = [r for rows in holdouts.values() for r in rows]
    assert_no_leakage(train_rows, all_holdout)
    hashes = {train: file_sha256(train)}
    hashes.update({p: file_sha256(p) for p in holdout_paths})
    return {"train": train_rows, "holdouts": holdouts, "hashes": hashes, "promotable": True}
