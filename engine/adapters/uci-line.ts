import { Chess } from 'chess.js';
import type { PlyRecord } from '../position';

export function sanMoveToUci(fen: string, san: string): string | null {
  try {
    const chess = new Chess(fen);
    const move = chess.move(san);
    if (!move) return null;
    return `${move.from}${move.to}${move.promotion ?? ''}`;
  } catch {
    return null;
  }
}

export function sanLineToUci(fen: string, sanMoves: string[]): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const san of sanMoves) {
    try {
      const move = chess.move(san);
      if (!move) break;
      out.push(`${move.from}${move.to}${move.promotion ?? ''}`);
    } catch {
      break;
    }
  }
  return out;
}

export function plyRecordToUci(ply: PlyRecord): string {
  const uci = sanMoveToUci(ply.fenBefore, ply.san);
  if (!uci) throw new Error(`move_conversion_failed: ${ply.san} is illegal for ${ply.fenBefore}`);
  return uci;
}
