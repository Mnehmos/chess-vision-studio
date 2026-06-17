import type { Eval } from '../types';
import type {
  FactRef,
  MoveStateFacts,
  Side,
  TeachingEvent,
  TeachingFactBundleV1,
  TeachingTopicId,
} from './types';
import type { TeachingNode } from './node';

// Deepline-style two-stage lessons built from a committed teaching event:
//   Stage 1 — find the punishment (from the position after the mistake)
//   Stage 2 — find the prevention (from the position before the mistake)
// Pure: no board interaction here. The primary solution is the engine move the
// event already proved; the UI grader may WIDEN acceptableUci with the engine
// (any move that removes the hazard within an eval tolerance) — that needs
// Stockfish and lives app-side.

export interface PuzzleStage {
  kind: 'punishment' | 'prevention';
  fen: string;
  sideToMove: Side;
  prompt: string;
  solutionUci: string;
  acceptableUci: string[];
  requiredAvoidedFacts: FactRef[];
}

export interface TeachingPuzzle {
  topicId: TeachingTopicId | 'best_move';
  stages: PuzzleStage[];
}

const TOPIC_NOUN: Record<TeachingTopicId | 'best_move', string> = {
  allowed_fork: 'fork',
  allowed_pin: 'pin',
  missed_hanging_piece: 'free piece',
  failed_defense: 'threat',
  pawn_structure_damage: 'weakness',
  best_move: 'best move',
};

export function buildTeachingPuzzle(
  event: TeachingEvent | TeachingNode,
  facts: TeachingFactBundleV1,
): TeachingPuzzle | null {
  if ('conceptCode' in event) {
    const node = event;
    const isFork = node.conceptCode.endsWith('_multi_attack');
    const topicId: TeachingTopicId = isFork
      ? 'allowed_fork'
      : node.conceptCode === 'pin'
        ? 'allowed_pin'
        : node.conceptCode === 'failed_defense'
          ? 'failed_defense'
        : node.conceptCode === 'missed_hanging_piece'
          ? 'missed_hanging_piece'
          : node.conceptCode === 'pawn_structure_damage'
            ? 'pawn_structure_damage'
            : 'allowed_fork';

    const noun = TOPIC_NOUN[topicId] ?? 'mistake';
    const mover = facts.before.sideToMove;
    const moverName = mover === 'white' ? 'White' : 'Black';
    const stages: PuzzleStage[] = [];

    // Stage 1 — the opponent's punishment, from the position after the played move.
    if (node.verification.expectedMove) {
      stages.push({
        kind: 'punishment',
        fen: facts.played.fenAfter,
        sideToMove: facts.played.position.sideToMove,
        prompt: `${moverName} allowed a ${noun}. Find the punishment.`,
        solutionUci: node.verification.expectedMove,
        acceptableUci: [node.verification.expectedMove],
        requiredAvoidedFacts: [],
      });
    }

    // Stage 2 — the move that should have been played, from the position before it.
    if (facts.best?.move.uci) {
      const isMissed = node.conceptCode === 'missed_hanging_piece';
      const prompt = isMissed
        ? `Find the move that wins the ${noun}.`
        : `Find a move that avoids the ${noun}.`;
      stages.push({
        kind: 'prevention',
        fen: facts.fenBefore,
        sideToMove: mover,
        prompt,
        solutionUci: facts.best.move.uci,
        acceptableUci: [facts.best.move.uci],
        requiredAvoidedFacts: [],
      });
    }

    if (stages.length === 0) return null;
    return { topicId, stages };
  }

  const noun = TOPIC_NOUN[event.topicId] ?? 'mistake';
  const moverName = event.side === 'white' ? 'White' : 'Black';
  const stages: PuzzleStage[] = [];

  // Stage 1 — the opponent's punishment, from the position after the played move.
  if (event.punishment?.move) {
    stages.push({
      kind: 'punishment',
      fen: facts.played.fenAfter,
      sideToMove: facts.played.position.sideToMove,
      prompt: `${moverName} allowed a ${noun}. Find the punishment.`,
      solutionUci: event.punishment.move,
      acceptableUci: [event.punishment.move],
      requiredAvoidedFacts: [],
    });
  }

  // Stage 2 — the move that should have been played, from the position before it.
  if (event.correction?.move) {
    const prompt =
      event.action === 'missed'
        ? `Find the move that wins the ${noun}.`
        : `Find a move that avoids the ${noun}.`;
    stages.push({
      kind: 'prevention',
      fen: facts.fenBefore,
      sideToMove: facts.before.sideToMove,
      prompt,
      solutionUci: event.correction.move,
      acceptableUci: [event.correction.move],
      requiredAvoidedFacts: [...event.correction.avoidedFacts],
    });
  }

  if (stages.length === 0) return null;
  return { topicId: event.topicId, stages };
}

export function buildBestMovePuzzle(facts: TeachingFactBundleV1): TeachingPuzzle | null {
  const bestUci = facts.best?.move.uci;
  if (!bestUci) return null;

  return {
    topicId: 'best_move',
    stages: [
      {
        kind: 'prevention',
        fen: facts.fenBefore,
        sideToMove: facts.before.sideToMove,
        prompt: 'Find the stronger move.',
        solutionUci: bestUci,
        acceptableUci: [bestUci],
        requiredAvoidedFacts: [],
      },
    ],
  };
}

// Whether a played UCI move solves a stage. Promotion-tolerant: a bare from-to
// drop (no promotion suffix) matches a promoting solution on the same squares.
// The UI grader may widen acceptableUci with the engine before calling this.
export function isPuzzleSolution(stage: PuzzleStage, uci: string): boolean {
  return stage.acceptableUci.some(
    (sol) => sol === uci || (sol.length === 5 && sol.slice(0, 4) === uci.slice(0, 4)),
  );
}

// Accept an engine-checked alternative prevention only when it removes every
// deterministic fact the committed event says the correction must avoid and
// remains close enough to the engine's best evaluation.
export function isAlternativePuzzleSolution(
  stage: PuzzleStage,
  uci: string,
  candidateFacts: MoveStateFacts,
  bestEval: Eval,
  candidateAfterEval: Eval,
  toleranceCp = 50,
): boolean {
  if (stage.kind !== 'prevention' || stage.requiredAvoidedFacts.length === 0) return false;
  if (candidateFacts.move.uci !== uci) return false;
  if (stage.requiredAvoidedFacts.some((fact) => factStillPresent(fact, candidateFacts))) {
    return false;
  }

  const loss = candidateLossFromBest(bestEval, candidateAfterEval);
  return loss !== null && loss <= toleranceCp;
}

// bestEval is from the mover's perspective before the move. candidateAfterEval
// is from the opponent's perspective after it, so negate the latter first.
export function candidateLossFromBest(bestEval: Eval, candidateAfterEval: Eval): number | null {
  if (bestEval.status === 'unavailable' || candidateAfterEval.status === 'unavailable') return null;
  if (bestEval.cp === undefined || candidateAfterEval.cp === undefined) return null;
  return Math.max(0, bestEval.cp + candidateAfterEval.cp);
}

function factStillPresent(fact: FactRef, candidate: MoveStateFacts): boolean {
  if (fact.kind === 'fork') {
    const motifs = candidate.position.availableMotifs;
    if (motifs.status !== 'computed') return true;
    const moveUci = fact.factId.startsWith('fork-') ? fact.factId.slice(5) : '';
    return motifs.items.some((motif) => motif.kind === 'fork' && motif.moveUci === moveUci);
  }

  if (fact.kind === 'pin') {
    const pins = candidate.position.availablePins;
    if (pins.status !== 'computed') return true;
    const moveUci = fact.factId.startsWith('pin-') ? fact.factId.slice(4) : '';
    return pins.items.some((pin) => pin.moveUci === moveUci);
  }

  if (
    fact.kind === 'losing_material' ||
    fact.kind === 'fork_threat' ||
    fact.kind === 'pin_constraint' ||
    fact.kind === 'king_pressure' ||
    fact.kind === 'mate_threat'
  ) {
    const hazards = candidate.position.hazards;
    if (hazards.status !== 'computed') return true;
    return hazards.items.some((hazard) => hazard.id === fact.factId);
  }

  if (fact.kind === 'doubled' || fact.kind === 'isolated' || fact.kind === 'passed') {
    const structures = candidate.deltas.createdStructures;
    if (structures.status !== 'computed') return true;
    return structures.items.some((structure) => structure.factId === fact.factId);
  }

  // Unknown evidence cannot be safely declared absent.
  return true;
}
