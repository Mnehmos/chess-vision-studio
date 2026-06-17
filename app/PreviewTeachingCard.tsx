import type { CSSProperties } from 'react';
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

function formatEval(move: AlternativeLineMove): string {
  if (move.mate !== undefined && move.mate !== null) return `M${move.mate}`;
  if (move.scoreCp === undefined) return '';
  const pawns = move.scoreCp / 100;
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
  const source = previewLine.alt.source === 'best-line'
    ? 'generated best line'
    : previewLine.alt.source === 'refutation'
      ? 'refutation'
      : 'variation';

  return (
    <section style={CARD}>
      <div style={KICKER}>TEACHING - {source}</div>
      <div style={LOG}>
        {firstVisible > 0 && (
          <div style={OLDER}>
            {firstVisible} earlier {firstVisible === 1 ? 'move' : 'moves'} in this line
          </div>
        )}
        {visibleMoves.map((move, index) => {
          const evalText = formatEval(move);
          const color = evalColor(move) ?? 'var(--accent-light)';
          const absoluteIndex = firstVisible + index;
          const current = absoluteIndex === moveIndex;
          return (
            <div key={`${move.uci}-${index}`} style={{ ...ROW, borderColor: current ? 'var(--accent)' : 'var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ color: 'var(--text)', fontSize: 14 }}>
                  {absoluteIndex + 1}. {move.san}
                </strong>
                <span style={{ ...BADGE, background: color }}>{qualityLabel(move)}</span>
                {evalText && <span style={EVAL}>{evalText}</span>}
              </div>
              <p style={TEXT}>{moveComment(move)}</p>
              {move.bestMoveSan && move.bestMoveUci !== move.uci && (
                <div style={HINT}>Best available: {move.bestMoveSan}</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const CARD: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--card)',
  borderRadius: 8,
  padding: 12,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const KICKER: CSSProperties = {
  color: 'var(--muted)',
  fontFamily: 'var(--mono)',
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  marginBottom: 10,
};

const BADGE: CSSProperties = {
  borderRadius: 4,
  color: '#fff',
  fontSize: 11,
  fontWeight: 700,
  padding: '2px 6px',
};

const LOG: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  flex: 1,
  justifyContent: 'flex-end',
  overflow: 'hidden',
};

const ROW: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--card2)',
  borderRadius: 8,
  padding: 9,
  minWidth: 0,
};

const OLDER: CSSProperties = {
  color: 'var(--muted)',
  fontSize: 11,
  textAlign: 'center',
};

const EVAL: CSSProperties = {
  marginLeft: 'auto',
  color: 'var(--text-soft)',
  fontFamily: 'var(--mono)',
  fontSize: 12,
  whiteSpace: 'nowrap',
};

const TEXT: CSSProperties = {
  color: 'var(--text)',
  fontSize: 12,
  lineHeight: 1.4,
  margin: '7px 0 0',
};

const HINT: CSSProperties = {
  color: 'var(--accent-light)',
  fontSize: 12,
  marginTop: 8,
};
