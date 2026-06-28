import { Chess } from 'chess.js';
import type {
  TeachingFactBundleV1,
  TeachingFactsRequestV1,
  PieceRef,
  FactCollection,
} from './types';

export const TEACHING_NODE_SCHEMA_VERSION = 1;

export type TeachingClaimStatus =
  | 'confirmed'
  | 'refuted'
  | 'unverified'
  | 'unavailable';

export type TeachingNodeKind =
  | 'tactic'
  | 'counterfactual'
  | 'structural'
  | 'king-safety'
  | 'development'
  | 'mobility'
  | 'defense'
  | 'conversion';

export interface TeachingVerification {
  required: boolean;
  status: TeachingClaimStatus;

  engine?: 'stockfish' | 'cvs';
  depth?: number;
  nodes?: number;

  rootMove?: string;
  expectedMove?: string;
  principalVariation?: string[];

  scoreBefore?: number;
  scoreAfter?: number;
  scoreDifference?: number;

  conclusionCode?:
    | 'wins_material'
    | 'does_not_win_material'
    | 'forced_mate'
    | 'not_forced'
    | 'preserves_evaluation'
    | 'loses_evaluation'
    | 'equivalent'
    | 'inconclusive';
}

export interface TeachingBoardPayload {
  arrows?: { from: string; to: string; color?: string; style?: 'dashed' | 'solid' }[];
  squares?: { square: string; color?: string }[];
}

export interface TeachingNode {
  schemaVersion: number;
  id: string;

  rootPositionKey: string;
  subjectMove: string;

  kind: TeachingNodeKind;
  conceptCode: string;

  claimStatus: TeachingClaimStatus;
  confidence: number;

  title: string;
  summary: string;
  why?: string;
  betterMove?: string;
  betterExplanation?: string;

  involvedSquares: string[];
  boardPayload: TeachingBoardPayload;

  verification: TeachingVerification;

  provenance: {
    factIds: string[];
    detectorIds: string[];
    pipelineVersion: string;
  };
}

export interface VerificationPolicy {
  tacticalClaims: 'required';
  counterfactualClaims: 'required';
  betterMoveClaims: 'required';
  structuralClaims: 'deterministic-or-engine';
  minimumDepth: number;
  timeoutMs: number;
}

export interface TeachingRequest {
  rootFen: string;
  subjectMove: string; // UCI move (e.g. dxc4 represented as d5c4)

  previousFen?: string;
  resultingFen: string;

  principalVariation?: string[];
  candidateMoves?: string[];

  verificationPolicy: VerificationPolicy;
  facts?: TeachingFactBundleV1;
  factsLoader?: (request: TeachingFactsRequestV1) => Promise<TeachingFactBundleV1>;
  engine?: {
    evaluate: (params: { fen: string; depth: number }) => Promise<{ cp?: number; mate?: number; status?: string }>;
  };
}

export function uciToSan(fen: string, uci: string): string {
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4) || undefined,
    });
    return move ? move.san : uci;
  } catch {
    return uci;
  }
}

function capitalize(s: string): string {
  return s.length ? (s[0]?.toUpperCase() ?? '') + s.slice(1) : s;
}

function pieceLabel(ref: PieceRef): string {
  return `the ${ref.pieceType} on ${ref.square}`;
}

function targetList(targets: PieceRef[]): string {
  const labels = targets.map(pieceLabel);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

export function getPositionAfterMove(fen: string, moveUci: string): string | null {
  try {
    const chess = new Chess(fen);
    const moved = chess.move({
      from: moveUci.slice(0, 2),
      to: moveUci.slice(2, 4),
      promotion: moveUci.slice(4) || undefined,
    });
    return moved ? chess.fen() : null;
  } catch {
    return null;
  }
}

export function getTacticPositionAfter(
  conceptCode: string,
  expectedMove: string,
  facts: TeachingFactBundleV1
): string | null {
  if (conceptCode.endsWith('_multi_attack')) {
    return getPositionAfterMove(facts.played.fenAfter, expectedMove);
  }
  if (conceptCode === 'pin') {
    return getPositionAfterMove(facts.played.fenAfter, expectedMove);
  }
  if (conceptCode === 'failed_defense') {
    return facts.refutation?.fenAfter ?? null;
  }
  if (conceptCode === 'missed_hanging_piece') {
    return facts.best?.fenAfter ?? null;
  }
  return null;
}

function computedItems<T>(collection: FactCollection<T> | null | undefined): T[] | null {
  return collection?.status === 'computed' ? collection.items : null;
}

// ────────────────────────────────────────────────────────────────────────────
// The Canonical Builder
// ────────────────────────────────────────────────────────────────────────────

export async function buildTeachingNodes(
  request: TeachingRequest,
): Promise<TeachingNode[]> {
  const facts = await extractTeachingFacts(request);
  const hypotheses = proposeTeachingHypotheses(facts, request);
  const verified = await verifyTeachingHypotheses(
    request,
    hypotheses,
    facts
  );

  return commitTeachingNodes(facts, verified);
}

export async function extractTeachingFacts(
  request: TeachingRequest,
): Promise<TeachingFactBundleV1> {
  if (request.facts) {
    return request.facts;
  }

  const uci = request.subjectMove;
  const bestLine = request.principalVariation || [];
  if (!request.factsLoader) {
    throw new Error('Teaching facts unavailable: provide request.facts or request.factsLoader');
  }
  return request.factsLoader({
    schemaVersion: 1,
    fenBefore: request.rootFen,
    playedMoveUci: uci,
    bestMoveUci: bestLine[0],
    refutationUci: bestLine[1],
    principalVariationUci: bestLine.length ? bestLine : undefined,
    options: { includeMotifOpportunities: true, includeCounterfactual: true },
  });
}

export function proposeTeachingHypotheses(
  facts: TeachingFactBundleV1,
  request: TeachingRequest,
): TeachingNode[] {
  const hypotheses: TeachingNode[] = [];
  const mover = facts.before.sideToMove;

  // 1. Fork / Multi-Attack
  const playedMotifs = computedItems(facts.played.position.availableMotifs);
  const beforeMotifs = computedItems(facts.before.opponentAvailableMotifs);
  const bestForks = computedItems(facts.best?.position.availableMotifs);
  const refutationUci = facts.refutation?.move.uci;

  if (playedMotifs && beforeMotifs) {
    const newForks = playedMotifs.filter((candidate) => {
      const isNew = !beforeMotifs.some((before) => before.moveUci === candidate.moveUci);
      const matchesRefutation = candidate.moveUci === refutationUci;
      const avoidedByBest =
        bestForks !== null && !bestForks.some((best) => best.moveUci === candidate.moveUci);
      return isNew && (matchesRefutation || avoidedByBest);
    });

    for (const fork of newForks) {
      const pieceType = fork.forkingPiece.pieceType;
      const conceptCode = `${pieceType}_multi_attack`;
      const id = `fork:${request.subjectMove}:${fork.moveUci}`;
      const involvedSquares = [
        ...new Set([fork.forkingPiece.square, ...fork.targets.map((t) => t.square)]),
      ].sort();

      const node: TeachingNode = {
        schemaVersion: TEACHING_NODE_SCHEMA_VERSION,
        id,
        rootPositionKey: request.rootFen,
        subjectMove: request.subjectMove,
        kind: 'tactic',
        conceptCode,
        claimStatus: 'unverified',
        confidence: 0.8,
        title: `Possible ${capitalize(pieceType)} Fork`,
        summary: `Verifying whether ${request.subjectMove} allowed a fork...`,
        involvedSquares,
        boardPayload: {
          arrows: fork.targets.map((t) => ({
            from: fork.forkingPiece.square,
            to: t.square,
            color: 'red',
            style: 'solid',
          })),
          squares: involvedSquares.map((sq) => ({ square: sq, color: 'red' })),
        },
        verification: {
          required: true,
          status: 'unverified',
          rootMove: request.subjectMove,
          expectedMove: fork.moveUci,
        },
        provenance: {
          factIds: [`fork-${fork.moveUci}`],
          detectorIds: ['fork_validation'],
          pipelineVersion: '1',
        },
      };
      hypotheses.push(node);
    }
  }

  // 2. Pin
  const playedPins = computedItems(facts.played.position.availablePins);
  const beforePins = computedItems(facts.before.opponentAvailablePins);
  const bestPins = computedItems(facts.best?.position.availablePins);

  if (playedPins && beforePins) {
    const newPins = playedPins.filter((candidate) => {
      const isNew = !beforePins.some((before) => before.moveUci === candidate.moveUci);
      const matchesRefutation = candidate.moveUci === refutationUci;
      const avoidedByBest =
        bestPins !== null && !bestPins.some((best) => best.moveUci === candidate.moveUci);
      return isNew && (matchesRefutation || avoidedByBest);
    });

    for (const pin of newPins) {
      const id = `pin:${request.subjectMove}:${pin.moveUci}`;
      const involvedSquares = [
        ...new Set([pin.pinner.square, pin.pinned.square, pin.anchor.square, ...pin.ray]),
      ].sort();

      const node: TeachingNode = {
        schemaVersion: TEACHING_NODE_SCHEMA_VERSION,
        id,
        rootPositionKey: request.rootFen,
        subjectMove: request.subjectMove,
        kind: 'tactic',
        conceptCode: 'pin',
        claimStatus: 'unverified',
        confidence: 0.8,
        title: `Possible Pin`,
        summary: `Verifying whether the move allowed a pin...`,
        involvedSquares,
        boardPayload: {
          arrows: [
            { from: pin.pinner.square, to: pin.pinned.square, color: 'red', style: 'solid' },
            { from: pin.pinned.square, to: pin.anchor.square, color: 'red', style: 'solid' },
          ],
          squares: involvedSquares.map((sq) => ({ square: sq, color: 'red' })),
        },
        verification: {
          required: true,
          status: 'unverified',
          rootMove: request.subjectMove,
          expectedMove: pin.moveUci,
        },
        provenance: {
          factIds: [`pin-${pin.moveUci}`],
          detectorIds: ['pin_validation'],
          pipelineVersion: '1',
        },
      };
      hypotheses.push(node);
    }
  }

  // 3. Failed Defense
  const beforeHazards = computedItems(facts.before.hazards);
  const afterHazards = computedItems(facts.played.position.hazards);
  const bestHazards = computedItems(facts.best?.position.hazards);

  if (beforeHazards && afterHazards && bestHazards && refutationUci) {
    const supportedKinds = new Set([
      'losing_material',
      'fork_threat',
      'pin_constraint',
      'king_pressure',
      'mate_threat',
    ]);
    const hazard = beforeHazards.find(
      (candidate) =>
        candidate.side === mover &&
        supportedKinds.has(candidate.kind) &&
        candidate.moveUci === refutationUci &&
        afterHazards.some((after) => after.id === candidate.id) &&
        !bestHazards.some((best) => best.id === candidate.id),
    );

    if (hazard) {
      const id = `failed_defense:${request.subjectMove}:${refutationUci}`;
      const involvedSquares = [...new Set(hazard.squares)].sort();

      const node: TeachingNode = {
        schemaVersion: TEACHING_NODE_SCHEMA_VERSION,
        id,
        rootPositionKey: request.rootFen,
        subjectMove: request.subjectMove,
        kind: 'defense',
        conceptCode: 'failed_defense',
        claimStatus: 'unverified',
        confidence: 0.8,
        title: `Possible Failed Defense`,
        summary: `Verifying unanswered threat...`,
        involvedSquares,
        boardPayload: {
          squares: involvedSquares.map((sq) => ({ square: sq, color: 'red' })),
        },
        verification: {
          required: true,
          status: 'unverified',
          rootMove: request.subjectMove,
          expectedMove: refutationUci,
        },
        provenance: {
          factIds: [hazard.id],
          detectorIds: ['hazard_detector'],
          pipelineVersion: '1',
        },
      };
      hypotheses.push(node);
    }
  }

  // 4. Missed Hanging Piece
  const bestUci = facts.best?.move.uci;
  if (bestUci) {
    const target = facts.before.pieces.find(
      (p) =>
        p.side !== mover &&
        p.see.status === 'computed' &&
        p.see.value.losing &&
        p.see.value.bestCaptureUci === bestUci,
    );

    const continuation = facts.refutation?.position;
    if (target && target.see.status === 'computed' && continuation) {
      const remainsAvailable = continuation.pieces.some(
        (piece) =>
          piece.id === target.id &&
          piece.see.status === 'computed' &&
          piece.see.value.losing,
      );

      if (!remainsAvailable && request.subjectMove !== bestUci) {
        const id = `missed_hanging_piece:${request.subjectMove}:${bestUci}`;
        const involvedSquares = [target.square];

        const node: TeachingNode = {
          schemaVersion: TEACHING_NODE_SCHEMA_VERSION,
          id,
          rootPositionKey: request.rootFen,
          subjectMove: request.subjectMove,
          kind: 'tactic',
          conceptCode: 'missed_hanging_piece',
          claimStatus: 'unverified',
          confidence: 0.8,
          title: `Possible Missed Hanging Piece`,
          summary: `Verifying missed capture opportunity...`,
          involvedSquares,
          boardPayload: {
            squares: involvedSquares.map((sq) => ({ square: sq, color: 'orange' })),
          },
          verification: {
            required: true,
            status: 'unverified',
            rootMove: request.subjectMove,
            expectedMove: bestUci,
          },
          provenance: {
            factIds: [`hanging-${target.id}`],
            detectorIds: ['see', 'attack_map'],
            pipelineVersion: '1',
          },
        };
        hypotheses.push(node);
      }
    }
  }

  // 5. Pawn Structure Damage
  const playedCreated = facts.played.deltas.createdStructures;
  const playedRemoved = facts.played.deltas.removedStructures;
  if (playedCreated?.status === 'computed' && playedRemoved?.status === 'computed') {
    const createdDamage = playedCreated.items.filter(
      (d) => d.side === mover && ['doubled_pawns', 'isolated_pawn'].includes(d.kind),
    );
    const removedDamage = playedRemoved.items.filter(
      (d) => d.side === mover && ['doubled_pawns', 'isolated_pawn'].includes(d.kind),
    );

    const netNewKinds = new Set<string>();
    for (const kind of ['doubled_pawns', 'isolated_pawn']) {
      const created = createdDamage.filter((d) => d.kind === kind).length;
      const removed = removedDamage.filter((d) => d.kind === kind).length;
      if (created > removed) netNewKinds.add(kind);
    }

    const explained = createdDamage.filter((d) => netNewKinds.has(d.kind));
    if (explained.length > 0) {
      const involvedSquares = [...new Set(explained.flatMap((d) => d.squares))].sort();
      const id = `pawn_structure_damage:${request.subjectMove}:${involvedSquares.join('-')}`;

      const node: TeachingNode = {
        schemaVersion: TEACHING_NODE_SCHEMA_VERSION,
        id,
        rootPositionKey: request.rootFen,
        subjectMove: request.subjectMove,
        kind: 'structural',
        conceptCode: 'pawn_structure_damage',
        claimStatus: 'confirmed',
        confidence: 1.0,
        title: 'Pawn Structure Damage',
        summary: 'Pawn structure damage created.',
        involvedSquares,
        boardPayload: {
          squares: involvedSquares.map((sq) => ({ square: sq, color: 'gray' })),
        },
        verification: {
          required: false,
          status: 'confirmed',
          conclusionCode: 'preserves_evaluation',
        },
        provenance: {
          factIds: explained.map((d) => d.factId),
          detectorIds: ['pawn_structure'],
          pipelineVersion: '1',
        },
      };
      hypotheses.push(node);
    }
  }

  // If there are multiple tactics, rank/sort them so they are deterministic
  return hypotheses.sort((a, b) => a.id.localeCompare(b.id));
}

export async function verifyTeachingHypotheses(
  request: TeachingRequest,
  hypotheses: TeachingNode[],
  facts: TeachingFactBundleV1,
): Promise<TeachingNode[]> {
  const verified = [...hypotheses];
  for (const node of verified) {
    if (!node.verification.required) {
      continue;
    }

    const expectedMove = node.verification.expectedMove;
    if (!expectedMove) continue;

    // Default status if no engine check runs is based on whether it matches the refutation
    const refutationUci = facts.refutation?.move.uci;
    const refutationMatch = expectedMove === refutationUci;

    // If we have an engine, run it
    if (request.engine) {
      const fen = getTacticPositionAfter(node.conceptCode, expectedMove, facts);
      if (!fen) {
        node.claimStatus = 'unavailable';
        node.verification.status = 'unavailable';
        continue;
      }

      try {
        const depth = request.verificationPolicy.minimumDepth || 14;
        const ev = await request.engine.evaluate({ fen, depth });
        const cp = typeof ev.mate === 'number' ? (ev.mate > 0 ? 100000 : -100000) : (ev.cp ?? 0);
        const attackerCp = -cp;

        node.verification.depth = depth;
        node.verification.scoreAfter = attackerCp;
        node.verification.engine = 'stockfish';

        if (attackerCp >= 50) {
          node.claimStatus = 'confirmed';
          node.verification.status = 'confirmed';
          node.verification.conclusionCode = 'wins_material';
        } else {
          node.claimStatus = 'refuted';
          node.verification.status = 'refuted';
          node.verification.conclusionCode = 'does_not_win_material';
        }
      } catch (e) {
        node.claimStatus = 'unavailable';
        node.verification.status = 'unavailable';
      }
    } else {
      // Fallback: if it matches refutation or if we don't need engine, we can use the facts refutation match
      if (refutationMatch) {
        node.claimStatus = 'confirmed';
        node.verification.status = 'confirmed';
        node.verification.conclusionCode = 'wins_material';
      } else {
        node.claimStatus = 'unverified';
        node.verification.status = 'unverified';
      }
    }
  }
  return verified;
}

export function formatTeachingNode(
  node: TeachingNode,
  facts: TeachingFactBundleV1,
): TeachingNode {
  const mover = facts.before.sideToMove;
  const opponent = mover === 'white' ? 'black' : 'white';
  const opponentName = opponent === 'white' ? 'White' : 'Black';

  const playedLabel = uciToSan(facts.fenBefore, node.subjectMove);
  const bestLabel = facts.best ? uciToSan(facts.fenBefore, facts.best.move.uci) : undefined;

  const status = node.claimStatus;

  // 1. Fork / Multi-Attack
  if (node.conceptCode.endsWith('_multi_attack')) {
    const pieceType = node.conceptCode.replace('_multi_attack', '');
    const expectedMove = node.verification.expectedMove || '';
    const tacticMoveLabel = uciToSan(facts.played.fenAfter, expectedMove);

    // Find targets list
    const playedMotifs = computedItems(facts.played.position.availableMotifs) || [];
    const motif = playedMotifs.find((m) => m.moveUci === expectedMove);
    const targetListText = motif ? targetList(motif.targets) : 'several targets';

    if (status === 'confirmed') {
      node.title = `${capitalize(pieceType)} Fork`;
      node.summary = `${playedLabel} allowed ${tacticMoveLabel}, which wins material after best defense.`;
      node.why = `${capitalize(pieceType)} to ${expectedMove.slice(2, 4)} attacks ${targetListText}.`;
      if (bestLabel) {
        node.betterMove = bestLabel;
        node.betterExplanation = `${bestLabel} prevents ${tacticMoveLabel} and avoids the threat.`;
      }
    } else if (status === 'refuted') {
      node.title = `Apparent ${capitalize(pieceType)} Fork`;
      node.summary = `${playedLabel} permitted ${tacticMoveLabel}, creating a multi-attack on ${targetListText}. After best defense, the sequence does not win material.`;
      if (bestLabel) {
        node.betterMove = bestLabel;
        node.betterExplanation = `${bestLabel} prevents ${tacticMoveLabel} and avoids the pressure.`;
      }
    } else if (status === 'unverified') {
      node.title = `Possible ${capitalize(pieceType)} Fork`;
      node.summary = `${tacticMoveLabel} creates a multi-attack. Verifying whether it wins material…`;
    } else {
      node.title = `${capitalize(pieceType)} Multi-Attack`;
      node.summary = `${tacticMoveLabel} attacks ${targetListText}. The tactical result has not been verified.`;
    }
  }

  // 2. Pin
  if (node.conceptCode === 'pin') {
    const expectedMove = node.verification.expectedMove || '';
    const tacticMoveLabel = uciToSan(facts.played.fenAfter, expectedMove);

    const playedPins = computedItems(facts.played.position.availablePins) || [];
    const pin = playedPins.find((p) => p.moveUci === expectedMove);

    const pinnerType = pin?.pinner.pieceType || 'piece';
    const pinnedType = pin?.pinned.pieceType || 'piece';
    const anchorType = pin?.anchor.pieceType || 'piece';
    const pinnedSq = pin?.pinned.square || '';
    const anchorSq = pin?.anchor.square || '';

    if (status === 'confirmed') {
      node.title = `${capitalize(pinnerType)} Pin`;
      node.summary = `${playedLabel} allowed ${tacticMoveLabel}, which pins the ${pinnedType} on ${pinnedSq} to the ${anchorType} on ${anchorSq}.`;
      node.why = `${capitalize(pinnerType)} to ${expectedMove.slice(2, 4)} pins the ${pinnedType} to the ${anchorType}.`;
      if (bestLabel) {
        node.betterMove = bestLabel;
        node.betterExplanation = `${bestLabel} prevents the pin.`;
      }
    } else if (status === 'refuted') {
      node.title = `Apparent ${capitalize(pinnerType)} Pin`;
      node.summary = `${playedLabel} permitted ${tacticMoveLabel}, pinning the ${pinnedType} on ${pinnedSq} to the ${anchorType} on ${anchorSq}, but the sequence does not win material.`;
      if (bestLabel) {
        node.betterMove = bestLabel;
        node.betterExplanation = `${bestLabel} prevents the pin and avoids the pressure.`;
      }
    } else if (status === 'unverified') {
      node.title = `Possible ${capitalize(pinnerType)} Pin`;
      node.summary = `${tacticMoveLabel} pins the ${pinnedType} on ${pinnedSq} to the ${anchorType} on ${anchorSq}. Verifying whether it wins material…`;
    } else {
      node.title = `${capitalize(pinnerType)} Pin Constraint`;
      node.summary = `${tacticMoveLabel} pins the ${pinnedType} on ${pinnedSq} to the ${anchorType} on ${anchorSq}. The tactical result has not been verified.`;
    }
  }

  // 3. Failed Defense
  if (node.conceptCode === 'failed_defense') {
    const expectedMove = node.verification.expectedMove || '';
    const refutationLabel = uciToSan(facts.played.fenAfter, expectedMove);

    const beforeHazards = computedItems(facts.before.hazards) || [];
    const hazard = beforeHazards.find((h) => h.moveUci === expectedMove);
    const pieceHazard = hazard?.kind === 'losing_material';

    if (status === 'confirmed') {
      node.title = 'Failed Defense';
      node.summary = pieceHazard
        ? `${playedLabel} left a piece hanging on ${hazard.squares[0]}.`
        : `${playedLabel} failed to defend a threat on ${hazard?.squares.join(', ') || ''}.`;
      node.why = `${opponentName} answers with ${refutationLabel}, exploiting the threat.`;
      if (bestLabel) {
        node.betterMove = bestLabel;
        node.betterExplanation = `${bestLabel} neutralizes the threat.`;
      }
    } else if (status === 'refuted') {
      node.title = 'Apparent Failed Defense';
      node.summary = `${playedLabel} left the threat unanswered, but the opponent's reply is not winning.`;
      if (bestLabel) {
        node.betterMove = bestLabel;
        node.betterExplanation = `${bestLabel} avoids the pressure.`;
      }
    } else if (status === 'unverified') {
      node.title = 'Possible Failed Defense';
      node.summary = `${playedLabel} left a threat unanswered. Verifying whether it is winning...`;
    } else {
      node.title = 'Unanswered Threat';
      node.summary = `${playedLabel} left a threat unanswered. The tactical result has not been verified.`;
    }
  }

  // 4. Missed Hanging Piece
  if (node.conceptCode === 'missed_hanging_piece') {
    const expectedMove = node.verification.expectedMove || '';
    const captureLabel = uciToSan(facts.fenBefore, expectedMove);

    const target = facts.before.pieces.find(
      (p) => p.side !== mover && p.see.status === 'computed' && p.see.value.bestCaptureUci === expectedMove,
    );
    const pieceType = target?.pieceType || 'piece';
    const sq = target?.square || '';

    if (status === 'confirmed') {
      node.title = 'Missed Hanging Piece';
      node.summary = `${playedLabel} missed a free ${pieceType} on ${sq}.`;
      node.why = `${captureLabel} would have won the ${pieceType}.`;
      if (bestLabel) {
        node.betterMove = bestLabel;
        node.betterExplanation = `${bestLabel} wins the ${pieceType}.`;
      }
    } else if (status === 'refuted') {
      node.title = 'Apparent Missed Hanging Piece';
      node.summary = `${playedLabel} missed a free ${pieceType} on ${sq}, but capturing it is refuted.`;
      if (bestLabel) {
        node.betterMove = bestLabel;
        node.betterExplanation = `${bestLabel} avoids the line.`;
      }
    } else if (status === 'unverified') {
      node.title = 'Possible Missed Hanging Piece';
      node.summary = `${playedLabel} missed a free ${pieceType} on ${sq}. Verifying whether it wins material...`;
    } else {
      node.title = 'Missed Capture Opportunity';
      node.summary = `${playedLabel} missed a free ${pieceType} on ${sq}. The tactical result has not been verified.`;
    }
  }

  // 5. Pawn Structure Damage
  if (node.conceptCode === 'pawn_structure_damage') {
    const playedCreated = facts.played.deltas.createdStructures;
    if (playedCreated?.status === 'computed') {
      const createdDamage = playedCreated.items.filter((d) => d.side === mover);
      const doubled = createdDamage.filter((d) => d.kind === 'doubled_pawns');
      const isolated = createdDamage.filter((d) => d.kind === 'isolated_pawn');

      const hasDoubled = doubled.length > 0;
      const hasIsolated = isolated.length > 0;

      if (hasDoubled && hasIsolated) node.title = 'Doubled and Isolated Pawns';
      else if (hasDoubled) node.title = 'Doubled Pawns';
      else if (hasIsolated) node.title = 'Isolated Pawn';
      else node.title = 'Pawn Structure Damage';

      const files = [...new Set(doubled.map((d) => d.squares[0]?.[0] || ''))].filter(Boolean);
      const filesStr = files.join(', ');

      node.summary = `${playedLabel} created pawn structure damage on ${
        filesStr ? `${filesStr}-file` : 'the board'
      }.`;
      if (bestLabel) {
        node.betterMove = bestLabel;
        node.betterExplanation = `${bestLabel} keeps the pawns healthy and avoids the weakness.`;
      }
    }
  }

  return node;
}

export function commitTeachingNodes(
  facts: TeachingFactBundleV1,
  verifiedNodes: TeachingNode[],
): TeachingNode[] {
  return verifiedNodes.map((node) => formatTeachingNode(node, facts));
}
