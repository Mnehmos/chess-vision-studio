import { Chess } from 'chess.js';
import type { PlayOpponent } from './play-mode-export';

export type PlaySide = 'w' | 'b';

export interface PlayStatus {
  text: string;
  over: boolean;
  tone: string;
}

export interface MoveHistoryRow {
  n: number;
  white?: string;
  black?: string;
}

export function playStatus(fen: string): PlayStatus {
  const c = new Chess(fen);
  const sideToMove = c.turn() === 'w' ? 'White' : 'Black';
  const winner = c.turn() === 'w' ? 'Black' : 'White';
  if (c.isCheckmate()) return { text: `Checkmate \u2014 ${winner} wins`, over: true, tone: 'var(--bad)' };
  if (c.isStalemate()) return { text: 'Stalemate \u2014 draw', over: true, tone: 'var(--text-soft)' };
  if (c.isInsufficientMaterial()) return { text: 'Draw \u2014 insufficient material', over: true, tone: 'var(--text-soft)' };
  if (c.isThreefoldRepetition()) return { text: 'Draw \u2014 threefold repetition', over: true, tone: 'var(--text-soft)' };
  if (c.isDraw()) return { text: 'Draw \u2014 fifty-move rule', over: true, tone: 'var(--text-soft)' };
  const check = c.inCheck() ? ' \u2014 check' : '';
  return { text: `${sideToMove} to move${check}`, over: false, tone: check ? '#b54708' : 'var(--text)' };
}

export function sideToMove(fen: string): PlaySide {
  return new Chess(fen).turn() as PlaySide;
}

export function isHumanTurn(fen: string, opponent: PlayOpponent, playerSide: PlaySide): boolean {
  return opponent === 'none' || sideToMove(fen) === playerSide;
}

export function moveHistoryRows(history: readonly { san: string }[]): MoveHistoryRow[] {
  const rows: MoveHistoryRow[] = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({ n: i / 2 + 1, white: history[i]?.san, black: history[i + 1]?.san });
  }
  return rows;
}
