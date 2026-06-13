import type { Side, TeachingEvent, TeachingFactBundleV1, TeachingTopicId } from './types';

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
}

export interface TeachingPuzzle {
  topicId: TeachingTopicId;
  stages: PuzzleStage[];
}

const TOPIC_NOUN: Record<TeachingTopicId, string> = {
  allowed_fork: 'fork',
  allowed_pin: 'pin',
  missed_hanging_piece: 'free piece',
  failed_defense: 'threat',
  pawn_structure_damage: 'weakness',
};

export function buildTeachingPuzzle(
  event: TeachingEvent,
  facts: TeachingFactBundleV1,
): TeachingPuzzle | null {
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
    });
  }

  if (stages.length === 0) return null;
  return { topicId: event.topicId, stages };
}

// Whether a played UCI move solves a stage. Promotion-tolerant: a bare from-to
// drop (no promotion suffix) matches a promoting solution on the same squares.
// The UI grader may widen acceptableUci with the engine before calling this.
export function isPuzzleSolution(stage: PuzzleStage, uci: string): boolean {
  return stage.acceptableUci.some(
    (sol) => sol === uci || (sol.length === 5 && sol.slice(0, 4) === uci.slice(0, 4)),
  );
}
