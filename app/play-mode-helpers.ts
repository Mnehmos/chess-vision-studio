import { Chess } from 'chess.js';
import { ARROW, type Arrow } from './BoardArrows';
import { allSquares } from '../engine/led';
import { sanLineToUci } from '../engine/adapters/uci-line';
import type { LedMap, MoveAnalysis, Square } from '../engine/types';
import type { TeachingFactsRequestV1, TeachingEvent, TeachingFactBundleV1, TeachingAnalysis } from '../engine/teaching/types';
import type { TeachingNode } from '../engine/teaching/node';
import type { UciEngine } from '../engine/evaluation';

export type VerboseMove = { from: string; to: string; san: string; flags: string; promotion?: string };

export function legalMovesFrom(fen: string, sq: Square): VerboseMove[] {
  try {
    return new Chess(fen).moves({ square: sq as never, verbose: true }) as unknown as VerboseMove[];
  } catch {
    return [];
  }
}

export function legalDotsFor(fen: string, sq: Square): Square[] | undefined {
  try {
    const c = new Chess(fen);
    const ms = c.moves({ square: sq as never, verbose: true }) as unknown as { to: string }[];
    return ms.length ? (ms.map((m) => m.to) as Square[]) : undefined;
  } catch {
    return undefined;
  }
}

export function teachingRequestForLiveMove(
  fenBefore: string,
  playedMoveUci: string,
  analysis: MoveAnalysis,
): TeachingFactsRequestV1 | null {
  const bestLine = sanLineToUci(fenBefore, analysis.evalBefore.pv);
  const refutationLine = sanLineToUci(analysis.positionAfter, analysis.evalAfter.pv);
  if (analysis.evalBefore.pv.length !== bestLine.length) return null;
  if (analysis.evalAfter.pv.length !== refutationLine.length) return null;
  return {
    schemaVersion: 1,
    fenBefore,
    playedMoveUci,
    ...(bestLine[0] ? { bestMoveUci: bestLine[0] } : {}),
    ...(refutationLine[0] ? { refutationUci: refutationLine[0] } : {}),
    ...(bestLine.length ? { principalVariationUci: bestLine } : {}),
    options: { includeMotifOpportunities: true, includeCounterfactual: true },
  };
}

export function teachingNodeArrows(node: TeachingNode): Arrow[] {
  const out: Arrow[] = [];
  const arrow = (uci: string, color: string, extra?: Partial<Arrow>): void => {
    if (uci.length < 4) return;
    out.push({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, color, ...extra });
  };
  arrow(node.subjectMove, ARROW.move, { move: true });

  if (node.boardPayload.arrows) {
    for (const arr of node.boardPayload.arrows) {
      out.push({
        from: arr.from as Square,
        to: arr.to as Square,
        color: arr.color === 'red' ? ARROW.attack : ARROW.defend,
        dashed: arr.style === 'dashed',
      });
    }
  } else if (node.verification.expectedMove) {
    arrow(node.verification.expectedMove, ARROW.attack, { label: '!' });
  }
  return out;
}

export function teachingLedMap(node: TeachingNode): LedMap {
  const squares = {} as LedMap['squares'];
  for (const square of allSquares()) squares[square] = 'off';
  if (node.boardPayload.squares) {
    for (const sq of node.boardPayload.squares) {
      squares[sq.square as Square] = sq.color === 'red' ? 'red' : sq.color === 'gray' ? 'off' : 'orange';
    }
  } else {
    for (const square of node.involvedSquares) {
      squares[square as Square] = 'orange';
    }
  }
  return { mode: 'teaching', squares };
}

const TACTIC_TOPICS = new Set(['allowed_fork', 'allowed_pin', 'failed_defense', 'missed_hanging_piece']);

function firstMotifMove(c: { status: string; items?: { moveUci: string }[] }): string | undefined {
  return c.status === 'computed' ? c.items?.[0]?.moveUci : undefined;
}

function appliedFen(fen: string, uci: string | undefined): string | null {
  if (!uci || uci.length < 4) return null;
  try {
    const board = new Chess(fen);
    const moved = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    return moved ? board.fen() : null;
  } catch {
    return null;
  }
}

function tacticPositionAfter(event: TeachingEvent, facts: TeachingFactBundleV1): string | null {
  switch (event.topicId) {
    case 'allowed_fork':
      return appliedFen(facts.played.fenAfter, firstMotifMove(facts.played.position.availableMotifs));
    case 'allowed_pin':
      return appliedFen(facts.played.fenAfter, firstMotifMove(facts.played.position.availablePins));
    case 'failed_defense':
      return facts.refutation?.fenAfter ?? null;
    case 'missed_hanging_piece':
      return facts.best?.fenAfter ?? null;
    default:
      return null;
  }
}

export async function validateExposedTactics(
  teaching: TeachingAnalysis | null,
  facts: TeachingFactBundleV1,
  engine: UciEngine,
  depth: number,
): Promise<TeachingAnalysis | null> {
  if (!teaching?.computed) return teaching;
  const events = await Promise.all(
    teaching.events.map(async (event) => {
      if (!TACTIC_TOPICS.has(event.topicId)) return event;
      const fen = tacticPositionAfter(event, facts);
      if (!fen) return event;
      try {
        const ev = await engine.evaluate({ fen, depth });
        if (ev.status === 'unavailable') return event;
        const cp = typeof ev.mate === 'number' ? (ev.mate > 0 ? 100000 : -100000) : (ev.cp ?? 0);
        return { ...event, engineCheck: { attackerCp: -cp, depth } };
      } catch {
        return event;
      }
    }),
  );
  return { ...teaching, events };
}
