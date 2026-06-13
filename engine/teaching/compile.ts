import type { MoveAnalysis } from '../types';
import {
  TEACHING_EVENTS_SCHEMA_VERSION,
  type Side,
  type StructureDelta,
  type TeachingAnalysis,
  type TeachingEvent,
  type TeachingFactBundleV1,
} from './types';
import { compareCreatedStructures } from './counterfactual';
import { stableEventId, structureDeltaToFactRef } from './evidence';
import { renderPawnStructureDamage, type PawnDamageMode } from './render';
import { resolveTopicId, topicMeta } from './registry';
import { scorePawnStructureDamage } from './saliency';

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
  // Future slices append here: detectAllowedFork, detectMissedHangingPiece, ...

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

  const allDamage: StructureDelta[] =
    playedCreated.status === 'computed'
      ? playedCreated.items.filter((d) => d.side === mover && DAMAGE_KINDS.includes(d.kind))
      : [];
  if (allDamage.length === 0) return [];

  const comparison = compareCreatedStructures(
    playedCreated,
    facts.best?.deltas.createdStructures,
    mover,
    DAMAGE_KINDS,
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
