#!/usr/bin/env python3
"""RSI orchestrator — the gated self-improvement loop that composes the merged substrate.

This is the assembly the components were built for: it drives ONE RSI generation through its phases
and ENFORCES the safety invariants at each gate, so a candidate can NEVER become champion unless it
earns it. The heavy phases (train, gauntlet) are injected as callables, so the gate logic runs and is
fully tested without a GPU or real games; the gates themselves are pure and always enforced.

Pipeline (each arrow is a fail-closed gate):

  config
    -> [GATE source-split #33]  resolve_split: train vs holdout must be source-clean (no game leak)
    -> train(split, seed) -> candidate            (deterministic, seeded; on the VERIFIED split)
    -> gauntlet(candidate, champion) -> sprt        (candidate vs the FROZEN champion)
    -> [GATE SPRT #5 / INV-1]  PROMOTE only if the log-likelihood ratio crosses the UPPER bound
    -> [LEDGER #12]            append the experiment to the append-only, hash-chained ledger
    -> PROMOTE (candidate becomes champion)  |  FREEZE (champion returned unchanged)

INV-1: a fixed-N or inconclusive gauntlet is a REJECT, never a promote. Champion safety: the frozen
champion is returned unchanged on any reject/abort — it is never overwritten speculatively.
"""
import hashlib
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from source_split_guard import resolve_split  # noqa: E402  (#33 source-split gate)


# ---------------------------------------------------------------- SPRT gate (#5 / INV-1)
def sprt_bounds(alpha, beta):
    """Wald SPRT log-likelihood-ratio boundaries for error rates (alpha, beta)."""
    return math.log(beta / (1 - alpha)), math.log((1 - beta) / alpha)  # (lower, upper)


def sprt_decision(llr, alpha=0.05, beta=0.05):
    """'accept' (H1: candidate is better), 'reject' (H0), or 'continue'. PROMOTE only on 'accept' —
    INV-1: crossing the UPPER bound is the *only* path to promotion; everything else holds the
    champion."""
    lower, upper = sprt_bounds(alpha, beta)
    if llr >= upper:
        return "accept"
    if llr <= lower:
        return "reject"
    return "continue"


# ---------------------------------------------------------------- append-only ledger (#12)
def _canonical(record):
    # hash over the record WITHOUT its own hash field, key-sorted, compact — matches #12's chain.
    return json.dumps(
        {k: record[k] for k in sorted(record) if k != "appendOnlyHash"},
        separators=(",", ":"),
        sort_keys=True,
    )


def chain_hash(prev_hash, record):
    return hashlib.sha256((prev_hash + _canonical(record)).encode("utf8")).hexdigest()


def ledger_append(ledger_path, record):
    """Append `record` to the hash-chained ledger; returns the record stamped with its
    `appendOnlyHash` (chained to the previous row, so any later edit is detectable)."""
    prev = ""
    try:
        with open(ledger_path, encoding="utf8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    prev = json.loads(line).get("appendOnlyHash", "")
    except FileNotFoundError:
        pass
    record = dict(record)
    record["appendOnlyHash"] = chain_hash(prev, record)
    with open(ledger_path, "a", encoding="utf8") as fh:
        fh.write(json.dumps(record) + "\n")
    return record


def verify_ledger(ledger_path):
    """Return the indices of rows whose `appendOnlyHash` does not match the recomputed chain (an
    empty list means intact). Detects ANY edit to a prior row's content OR hash, because each row's
    hash binds the previous row's hash — re-stamping an edited row still breaks the NEXT row."""
    rows = []
    with open(ledger_path, encoding="utf8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    broken, prev = [], ""
    for i, row in enumerate(rows):
        bare = {k: v for k, v in row.items() if k != "appendOnlyHash"}
        if row.get("appendOnlyHash") != chain_hash(prev, bare):
            broken.append(i)
        prev = row.get("appendOnlyHash", "")
    return broken


# ---------------------------------------------------------------- the gated generation
def run_generation(config, train_fn, gauntlet_fn, ledger_path):
    """Run one gated RSI generation.

    `train_fn(split, seed) -> candidate` and `gauntlet_fn(candidate, champion) -> {llr, wins, losses,
    draws, ...}` are injected (the heavy phases). Returns a decision dict; the frozen champion is
    returned unchanged unless the SPRT accepts. Raises SystemExit (fail-closed) on a leaky/unsplit
    corpus — BEFORE any training runs."""
    champion = config["champion"]  # the FROZEN champion id/hash — never mutated here
    alpha = config.get("alpha", 0.05)
    beta = config.get("beta", 0.05)
    seed = config.get("seed", 0)

    # GATE 1 — source-split (#33): fail closed before spending any GPU time if train/holdout leak.
    split = resolve_split(
        config["train"],
        config.get("validation"),
        config.get("test"),
        allow_unsafe_row_split=config.get("allow_unsafe_row_split", False),
    )

    # TRAIN + GAUNTLET — deterministic train on the verified split, then candidate vs the FROZEN
    # champion. A failure in either phase is fail-closed (champion untouched) AND ledgered as an
    # aborted run, so the audit trail has no silent gaps.
    try:
        candidate = train_fn(split=split, seed=seed)
        sprt = gauntlet_fn(candidate=candidate, champion=champion)
    except Exception as exc:
        ledger_append(
            ledger_path,
            {
                "kind": "rsi_generation",
                "champion": champion,
                "seed": seed,
                "outcome": "aborted",
                "error": f"{type(exc).__name__}: {exc}",
            },
        )
        raise

    llr = float(sprt["llr"])
    # A NON-FINITE llr (NaN/inf) is an anomalous/broken gauntlet result — fail safe: never promote on
    # it (a real SPRT LLR is a finite sum of log-ratios).
    decision = sprt_decision(llr, alpha, beta) if math.isfinite(llr) else "invalid"
    # PROMOTE only if the SPRT accepts AND the split is itself promotable: a non-promotable dev split
    # (allow_unsafe_row_split, source-leaking) can NEVER reach the champion even on a crossed SPRT.
    # This binds the two invariants together — INV-1 (SPRT) AND INV-3 (source-clean) — at promotion.
    promote = decision == "accept" and bool(split["promotable"])

    # LEDGER (#12) — record the full experiment, tamper-evident.
    record = ledger_append(
        ledger_path,
        {
            "kind": "rsi_generation",
            "champion": champion,
            "candidate": candidate,
            "seed": seed,
            "promotable": split["promotable"],
            "datasetHashes": split.get("hashes", {}),
            "sprt": {
                "llr": llr if math.isfinite(llr) else None,  # JSON-safe: never a bare NaN/Infinity
                "alpha": alpha,
                "beta": beta,
                "decision": decision,
                "wins": sprt.get("wins"),
                "losses": sprt.get("losses"),
                "draws": sprt.get("draws"),
            },
            "outcome": "promote" if promote else "freeze",
        },
    )

    # PROMOTE / FREEZE — only the accept path may change the champion.
    return {
        "decision": decision,
        "promote": promote,
        "new_champion": candidate if promote else champion,  # == champion unless promoted
        "frozen_champion": champion,
        "ledger_record": record,
    }
