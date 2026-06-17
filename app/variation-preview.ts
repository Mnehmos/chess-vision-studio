import { Chess } from 'chess.js';
import type { Arrow } from './BoardArrows';
import type { AlternativeLine, AlternativeLineMove } from './arrow-analysis-store';
import { evalColor, getMoveSan } from './arrow-analysis-store';
import { getPositionAfterMove } from '../engine/teaching/node';
import type { Square } from '../engine/types';

export interface VariationPreviewPosition {
  fen: string;
  san: string;
  uci: string;
}

export function variationMoveUcis(alt: AlternativeLine): string[] {
  return [...alt.moves.map((m) => m.uci), ...alt.pv];
}

export function buildVariationPreviewPositions(
  alt: AlternativeLine,
  options: { includeRootPosition?: boolean } = {},
): VariationPreviewPosition[] {
  const out: VariationPreviewPosition[] = [];
  let currFen = alt.rootFen;

  for (const moveUci of variationMoveUcis(alt)) {
    const san = getMoveSan(
      currFen,
      moveUci.slice(0, 2) as Square,
      moveUci.slice(2, 4) as Square,
      moveUci.slice(4) || undefined,
    );
    const nextFen = getPositionAfterMove(currFen, moveUci);
    if (!nextFen) break;
    out.push({
      fen: options.includeRootPosition ? currFen : nextFen,
      san,
      uci: moveUci,
    });
    currFen = nextFen;
  }

  if (options.includeRootPosition) out.push({ fen: currFen, san: '', uci: '' });
  return out;
}

export function buildVariationPreviewArrows(params: {
  alt: AlternativeLine;
  previewPositions: Pick<VariationPreviewPosition, 'fen'>[];
  currentIndex: number;
}): Arrow[] {
  const { alt, previewPositions, currentIndex } = params;
  const moves = [
    ...alt.moves.map((m) => ({
      from: m.from,
      to: m.to,
      promotion: m.promotion,
      fenBefore: m.fenBefore,
      moveData: m,
    })),
    ...alt.pv.map((uci, idx) => {
      const fenBefore =
        idx === 0
          ? alt.moves.length > 0
            ? alt.moves[alt.moves.length - 1].fenAfter
            : alt.rootFen
          : (previewPositions[alt.moves.length + idx - 1]?.fen ?? '');
      return {
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        promotion: uci.slice(4) || undefined,
        fenBefore,
        moveData: null as AlternativeLineMove | null,
      };
    }),
  ];

  const out: Arrow[] = [];
  for (let i = currentIndex + 1; i < moves.length; i++) {
    const m = moves[i];
    if (!m || !m.fenBefore) continue;
    const sideToMove = new Chess(m.fenBefore).turn();
    const isEngineMove = i >= alt.moves.length;
    const defaultColor = sideToMove === 'w' ? '#ffffff' : '#1a1a1a';
    const playerColor = alt.revealed && m.moveData ? (evalColor(m.moveData) ?? defaultColor) : defaultColor;
    out.push({
      from: m.from,
      to: m.to,
      color: isEngineMove ? '#dd6b20' : playerColor,
      dashed: isEngineMove,
      pulse: i === currentIndex + 1,
      promotion: m.promotion,
      label: String(i + 1),
    });
  }
  return out;
}
