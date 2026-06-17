import type { ModeId } from '../engine/led';
import type { PlyRecord } from '../engine/position';
import type { MoveAnalysis, Square } from '../engine/types';
import { buildBoardExport } from './exportState';

export type PlayOpponent = 'none' | 'cvs' | 'stockfish';

export interface PlayHistoryEntry {
  san: string;
  fen: string;
  from: Square;
  to: Square;
  uci: string;
}

export interface PlayCoachSummary {
  ply: number;
  summary?: string;
}

export interface PlayModeExportInput {
  history: PlayHistoryEntry[];
  startFen: string;
  fen: string;
  modeId: ModeId;
  selected?: Square | null;
  analyses: Map<number, MoveAnalysis>;
  coachLog: PlayCoachSummary[];
  annotations: {
    showThreats: boolean;
    showAllThreats: boolean;
    cascade: boolean;
    followMove: boolean;
  };
  playerSide: 'w' | 'b';
  opponent: PlayOpponent;
  reviewMoments: unknown[];
  exportedAt: string;
}

export function playHistoryToPlyRecords(history: PlayHistoryEntry[], startFen: string): PlyRecord[] {
  return history.map((h, i) => {
    const prevEntry = i === 0 ? undefined : history[i - 1];
    return {
      ply: i + 1,
      moveNumber: Math.floor(i / 2) + 1,
      color: i % 2 === 0 ? 'w' : 'b',
      san: h.san,
      from: h.from,
      to: h.to,
      fenBefore: prevEntry ? prevEntry.fen : startFen,
      fenAfter: h.fen,
    };
  });
}

export function playModePlayers(playerSide: 'w' | 'b', opponent: PlayOpponent): { White: string; Black: string } {
  return {
    White: playerSide === 'w' ? 'You' : opponent === 'none' ? 'Player 1' : opponent,
    Black: playerSide === 'b' ? 'You' : opponent === 'none' ? 'Player 2' : opponent,
  };
}

export function playModeCommentary(coachLog: PlayCoachSummary[]): Map<number, string> {
  const commentary = new Map<number, string>();
  coachLog.forEach((turn) => {
    if (turn.summary) commentary.set(turn.ply, turn.summary);
  });
  return commentary;
}

export function buildPlayModeExportPayload(input: PlayModeExportInput) {
  const plies = playHistoryToPlyRecords(input.history, input.startFen);
  const commentary = playModeCommentary(input.coachLog);
  const players = playModePlayers(input.playerSide, input.opponent);
  const baseExport = buildBoardExport({
    game: {
      headers: {
        Event: 'CVS Play Mode Game',
        Date: input.exportedAt.split('T')[0],
        ...players,
      },
    } as any,
    plies,
    view: input.history.length,
    fen: input.fen,
    modeId: input.modeId,
    selected: input.selected || undefined,
    ledMap: { mode: 'off' as any, squares: {} },
    arrows: [],
    analyses: input.analyses,
    commentary,
    annotations: input.annotations,
    exportedAt: input.exportedAt,
  });

  return {
    ...baseExport,
    reviewMoments: input.reviewMoments,
  };
}
