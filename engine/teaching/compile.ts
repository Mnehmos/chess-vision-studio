import type { MoveAnalysis } from '../types';
import {
  TEACHING_EVENTS_SCHEMA_VERSION,
  type FactCollection,
  type FactRef,
  type Side,
  type StructureDelta,
  type TeachingAnalysis,
  type TeachingEvent,
  type TeachingFactBundleV1,
} from './types';
import { compareCreatedStructures } from './counterfactual';
import { stableEventId, structureDeltaToFactRef } from './evidence';
import { renderAllowedFork, renderPawnStructureDamage, type PawnDamageMode } from './render';
import { resolveTopicId, topicMeta } from './registry';
import { scoreAllowedFork, scorePawnStructureDamage } from './saliency';

export interface CompileInput {
  analysis: MoveAnalysis;
  facts: TeachingFactBundleV1;
}

const DAMAGE_KINDS = ['doubled_pawns', 'isolated_pawn'];
const MISTAKE_BAND = new Set(['inaccuracy', 'mistake', 'blunder']);
const GOOD_BAND = new Set(['best', 'excellent', 'good']);

// Compile Rust facts + the Stockfish grade into committed teaching events.
// Propose → Validate → Attribute → Rank → Commit (plan §9). An empty event list
// with computed:true means "ran, found nothing" — never conflate with not-run.
export function compileTeachingEvents(input: CompileInput): TeachingAnalysis {
  if (input.facts.schemaVersion !== 1) {
    return { computed: false, reason: 'schema_mismatch' };
  }

  const events: TeachingEvent[] = [];
  events.push(...detectPawnStructureDamage(input));
  events.push(...detectAllowedFork(input));
  // Future slices append here: detectMissedHangingPiece, detectAllowedPin, ...

  if (events.length === 0) {
    return { computed: true, schemaVersion: TEACHING_EVENTS_SCHEMA_VERSION, events: [] };
  }
  // Rank by saliency; tie-break on stable id so output is deterministic.
  events.sort((a, b) => b.saliency - a.saliency || a.id.localeCompare(b.id));
  return {
    computed: true,
    schemaVersion: TEACHING_EVENTS_SCHEMA_VERSION,
    events,
    primaryEvent: events[0],
  };
}

// ── Pawn Structure Damage (plan §10.5) ──────────────────────────────────────
// The played move creates a doubled/isolated weakness on the MOVER's own side.
// Three honest modes: causally_supported (a mistake the best move avoids),
// accepted_tradeoff (a good move whose structural cost the eval absorbs), and
// descriptive (the weakness is real but not attributable as the cost's cause).
function detectPawnStructureDamage(input: CompileInput): TeachingEvent[] {
  const { facts, analysis } = input;
  const mover: Side = facts.before.sideToMove;
  const playedCreated = facts.played.deltas.createdStructures;
  const playedRemoved = facts.played.deltas.removedStructures;

  const createdDamage = damagingItems(playedCreated, mover);
  const removedDamage = damagingItems(playedRemoved, mover);
  // Net-new only: a pawn push relocates a weakness (isolated e2 -> isolated e4) and
  // must NOT read as new damage. A kind counts only when more were created than
  // removed on the mover's own side.
  const netNewKinds = new Set<string>();
  for (const kind of DAMAGE_KINDS) {
    const created = createdDamage.filter((d) => d.kind === kind).length;
    const removed = removedDamage.filter((d) => d.kind === kind).length;
    if (created > removed) netNewKinds.add(kind);
  }
  const allDamage: StructureDelta[] = createdDamage.filter((d) => netNewKinds.has(d.kind));
  if (allDamage.length === 0) return [];

  const comparison = compareCreatedStructures(
    playedCreated,
    facts.best?.deltas.createdStructures,
    mover,
    [...netNewKinds],
  );

  const classification = analysis.classification;
  const isMistake = MISTAKE_BAND.has(classification);
  const isGood = GOOD_BAND.has(classification);
  // Causal only with a real counterfactual difference AND a worse grade — never
  // from the structural fact alone (plan §10.5 / §19 Gate 3).
  const counterfactualSupported = isMistake && comparison.hasBest && comparison.avoided.length > 0;

  let mode: PawnDamageMode;
  let action: TeachingEvent['action'];
  let attribution: TeachingEvent['proof']['attribution'];
  let badge: TeachingEvent['proof']['badge'];
  if (counterfactualSupported) {
    mode = 'causally_supported';
    action = 'worsened';
    attribution = 'counterfactual_supported';
    badge = 'counterfactual_supported';
  } else if (isGood) {
    mode = 'accepted_tradeoff';
    action = 'accepted_tradeoff';
    attribution = 'descriptive_only';
    badge = 'structural_fact';
  } else {
    mode = 'descriptive';
    action = 'created';
    attribution = 'descriptive_only';
    badge = 'structural_fact';
  }

  // Explain the weaknesses the correction fixes (causal) or all of them otherwise.
  const explained = mode === 'causally_supported' ? comparison.avoided : allDamage;
  const mechanism = explained.some((d) => d.kind === 'doubled_pawns')
    ? 'doubled_pawn'
    : 'isolated_pawn';
  const topicId = resolveTopicId(action, mechanism);
  if (!topicId) return [];

  const winsMaterial = moverWinsMaterial(facts.fenBefore, facts.played.fenAfter, mover);
  const bestLabel = mode === 'causally_supported' ? bestMoveLabel(analysis) : undefined;
  const playedLabel = playedMoveLabel(analysis, facts.played.move.uci);
  const squares = [...new Set(explained.flatMap((d) => d.squares))].sort();

  const plan = renderPawnStructureDamage({
    mode,
    playedLabel,
    bestLabel,
    damage: explained,
    classification,
    winsMaterial,
  });

  const saliency = scorePawnStructureDamage({
    classification,
    cpLoss: analysis.cpLoss,
    weaknessCount: explained.length,
    counterfactualSupported,
  });

  const correction =
    mode === 'causally_supported' && facts.best
      ? {
          move: facts.best.move.uci,
          avoidedFacts: comparison.avoided.map(structureDeltaToFactRef),
          createdFacts: [],
        }
      : undefined;

  const event: TeachingEvent = {
    id: stableEventId(topicId, facts.played.move.uci, squares),
    topicId,
    family: topicMeta(topicId).family,
    action,
    mechanism,
    side: mover,
    playedMove: facts.played.move.uci,
    actors: [],
    targets: [],
    squares,
    consequence: { cpLoss: analysis.cpLoss, structuralChanges: explained },
    ...(correction ? { correction } : {}),
    proof: {
      validators: ['pawn_structure'],
      evidence: explained.map(structureDeltaToFactRef),
      attribution,
      badge,
    },
    saliency,
    plan,
  };
  return [event];
}

// ── Allowed Fork (plan §10.1) ───────────────────────────────────────────────
// The played move hands the opponent a validated fork (Rust-proven) that the best
// move would not. Committed only with move-causation evidence: the fork matches the
// Stockfish refutation, or the best-move counterfactual avoids it.
function detectAllowedFork(input: CompileInput): TeachingEvent[] {
  const { facts, analysis } = input;
  const mover: Side = facts.before.sideToMove;
  const opponent: Side = mover === 'white' ? 'black' : 'white';

  const playedMotifs = facts.played.position.availableMotifs;
  if (playedMotifs.status !== 'computed' || playedMotifs.items.length === 0) return [];

  const bestMotifs = facts.best?.position.availableMotifs;
  const bestForks = bestMotifs && bestMotifs.status === 'computed' ? bestMotifs.items : null;
  const bestAvoids = bestForks !== null && bestForks.length === 0;

  const refutationUci = facts.refutation?.move.uci;
  // Prefer the fork the engine actually plays as the punishment; else the heaviest.
  const forks = [...playedMotifs.items].sort(
    (a, b) => b.materialGain - a.materialGain || a.moveUci.localeCompare(b.moveUci),
  );
  const fork = forks.find((f) => f.moveUci === refutationUci) ?? forks[0];
  if (!fork) return [];

  const refutationMatch = fork.moveUci === refutationUci;
  // No move-causation evidence → do not claim the move "allowed" it.
  if (!refutationMatch && !bestAvoids) return [];

  const attribution = refutationMatch ? 'proven_refutation' : 'counterfactual_supported';
  const badge = refutationMatch ? 'engine_line' : 'counterfactual_supported';
  const playedLabel = playedMoveLabel(analysis, facts.played.move.uci);
  const bestLabel = bestAvoids ? bestMoveLabel(analysis) : undefined;
  const opponentName = opponent === 'white' ? 'White' : 'Black';

  const squares = [
    ...new Set([fork.forkingPiece.square, ...fork.targets.map((t) => t.square)]),
  ].sort();
  const forkRef: FactRef = { factId: `fork-${fork.moveUci}`, kind: 'fork', squares, side: opponent };
  const plan = renderAllowedFork({ playedLabel, bestLabel, fork, opponentName });
  const saliency = scoreAllowedFork({
    classification: analysis.classification,
    materialGain: fork.materialGain,
    kingTarget: fork.kingTarget,
    refutationMatch,
  });

  const correction =
    bestAvoids && facts.best
      ? { move: facts.best.move.uci, avoidedFacts: [forkRef], createdFacts: [] }
      : undefined;

  const event: TeachingEvent = {
    id: stableEventId('allowed_fork', facts.played.move.uci, squares),
    topicId: 'allowed_fork',
    family: 'tactics',
    action: 'allowed',
    mechanism: 'fork',
    side: mover,
    playedMove: facts.played.move.uci,
    actors: [fork.forkingPiece],
    targets: fork.targets,
    squares,
    consequence: { cpLoss: analysis.cpLoss, materialLoss: fork.materialGain / 100 },
    punishment: { move: fork.moveUci, line: [fork.moveUci] },
    ...(correction ? { correction } : {}),
    proof: { validators: ['fork_validation'], evidence: [forkRef], attribution, badge },
    saliency,
    plan,
  };
  return [event];
}

function damagingItems(collection: FactCollection<StructureDelta>, side: Side): StructureDelta[] {
  return collection.status === 'computed'
    ? collection.items.filter((d) => d.side === side && DAMAGE_KINDS.includes(d.kind))
    : [];
}

function playedMoveLabel(analysis: MoveAnalysis, uci: string): string {
  const san = stripMoveNumber(analysis.move);
  return san || uci;
}

function bestMoveLabel(analysis: MoveAnalysis): string | undefined {
  return analysis.evalBefore?.pv?.[0];
}

// "15. Qxg4" / "15... Qxg4" → "Qxg4"
function stripMoveNumber(move: string): string {
  return move.replace(/^\d+\.(\.\.)?\s*/, '').trim();
}

// Proven board fact: did the opponent lose material on the played move? Used only
// to phrase the accepted-tradeoff caveat — never to assert tactical causation.
function moverWinsMaterial(fenBefore: string, fenAfter: string, mover: Side): boolean {
  const opp: Side = mover === 'white' ? 'black' : 'white';
  return materialOf(fenAfter, opp) < materialOf(fenBefore, opp);
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function materialOf(fen: string, side: Side): number {
  const board = fen.split(' ')[0] ?? '';
  let total = 0;
  for (const ch of board) {
    if (ch === '/' || (ch >= '1' && ch <= '8')) continue;
    const sideOf: Side = ch >= 'A' && ch <= 'Z' ? 'white' : 'black';
    if (sideOf !== side) continue;
    total += PIECE_VALUE[ch.toLowerCase()] ?? 0;
  }
  return total;
}
