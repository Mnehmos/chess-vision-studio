import type { AlternativeLine, AlternativeLineMove } from './arrow-analysis-store';
import { evalColor } from './arrow-analysis-store';

type PreviewLineState = { alt: AlternativeLine; currentIndex: number };
const PREVIEW_WINDOW = 4;

function qualityLabel(move: AlternativeLineMove): string {
  switch (move.moveQuality) {
    case 'forced':
      return 'forced';
    case 'best':
      return 'best';
    case 'best-resistance':
      return 'best resistance';
    case 'equivalent':
      return 'equivalent';
    case 'inaccuracy':
    case 'mistake':
    case 'blunder':
      return move.moveQuality;
    default:
      return move.origin === 'engine' ? 'engine line' : 'candidate';
  }
}

// move.scoreCp / move.mate are from the MOVER's POV, so they flip sign every ply.
// Normalize to White (like the main teaching log) so the line reads as a steady
// "who's winning" number instead of flip-flopping.
function moverIsWhite(move: AlternativeLineMove): boolean {
  return move.fenBefore.split(' ')[1] === 'w';
}

export function formatEval(move: AlternativeLineMove): string {
  const sign = moverIsWhite(move) ? 1 : -1;
  if (move.mate !== undefined && move.mate !== null) {
    const m = move.mate * sign;
    return `${m >= 0 ? 'M' : 'M-'}${Math.abs(m)}`;
  }
  if (move.scoreCp === undefined) return '';
  const pawns = (move.scoreCp * sign) / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

function moveComment(move: AlternativeLineMove): string {
  const san = move.san;
  if (move.legalMoveCount === 1 || move.moveQuality === 'forced') {
    return `${san} is forced; there is no useful choice in this position.`;
  }
  if (move.moveQuality === 'best-resistance') {
    return `${san} is the best way to hold a worse position.`;
  }
  if (move.moveQuality === 'best') {
    return `${san} is the engine's top move and keeps the line on track.`;
  }
  if (move.moveQuality === 'equivalent') {
    return `${san} keeps the evaluation essentially unchanged.`;
  }
  if (move.cpLoss !== undefined && move.cpLoss > 50) {
    const better = move.bestMoveSan ? ` Better was ${move.bestMoveSan}.` : '';
    return `${san} loses ${(move.cpLoss / 100).toFixed(2)} pawns.${better}`;
  }
  if (move.origin === 'engine') {
    return `${san} is part of the generated engine continuation.`;
  }
  return `${san} is the current candidate move in this line.`;
}

export function PreviewTeachingCard({ previewLine }: { previewLine: PreviewLineState }) {
  const moves = previewLine.alt.moves;
  if (moves.length === 0) return null;
  const moveIndex = Math.min(Math.max(0, previewLine.currentIndex), moves.length - 1);
  const firstVisible = Math.max(0, moveIndex - PREVIEW_WINDOW + 1);
  const visibleMoves = moves.slice(firstVisible, moveIndex + 1);
  const source =
    previewLine.alt.source === 'best-line'
      ? 'generated best line'
      : previewLine.alt.source === 'refutation'
        ? 'refutation'
        : 'variation';

  return (
    <section className="preview-teaching-card">
      <div className="preview-teaching-card__kicker">TEACHING - {source}</div>
      <div className="preview-teaching-card__log">
        {firstVisible > 0 && (
          <div className="preview-teaching-card__older">
            {firstVisible} earlier {firstVisible === 1 ? 'move' : 'moves'} in this line
          </div>
        )}
        {visibleMoves.map((move, index) => {
          const evalText = formatEval(move);
          const color = evalColor(move) ?? 'var(--accent-light)';
          const absoluteIndex = firstVisible + index;
          const current = absoluteIndex === moveIndex;
          return (
            <div
              key={`${move.uci}-${index}`}
              className="preview-teaching-card__row"
              style={{ borderColor: current ? 'var(--accent)' : 'var(--border)' }}
            >
              <div className="preview-teaching-card__row-header">
                <strong className="preview-teaching-card__move">
                  {absoluteIndex + 1}. {move.san}
                </strong>
                <span className="preview-teaching-card__badge" style={{ background: color }}>
                  {qualityLabel(move)}
                </span>
                {evalText && <span className="preview-teaching-card__eval">{evalText}</span>}
              </div>
              <p className="preview-teaching-card__text">{moveComment(move)}</p>
              {move.bestMoveSan && move.bestMoveUci !== move.uci && (
                <div className="preview-teaching-card__hint">
                  Best available: {move.bestMoveSan}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
