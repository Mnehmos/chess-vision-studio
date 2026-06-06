// Facts panel — shared across modes. Shows the selected piece's PieceRelation +
// SEE status, plus this ply's classification and topExplanation.
import { buildRelationMap } from '../engine/relations';
import { seeOnSquare } from '../engine/see';
import type { MoveAnalysis, Square } from '../engine/types';

export function FactsPanel({
  fen,
  selected,
  analysis,
  move,
}: {
  fen: string;
  selected?: Square;
  analysis?: MoveAnalysis;
  move?: string;
}) {
  const rel = buildRelationMap(fen);
  const r = selected ? rel.bySquare[selected] : undefined;
  const see = selected ? seeOnSquare(fen, selected) : undefined;

  return (
    <div style={{ minWidth: 280, fontSize: 14, lineHeight: 1.5 }}>
      <h3 style={{ margin: '0 0 6px' }}>Facts</h3>
      {move && (
        <div style={{ marginBottom: 8 }}>
          <strong>{move}</strong>
          {analysis && (
            <span
              style={{
                marginLeft: 8,
                padding: '1px 6px',
                borderRadius: 4,
                background: classColor(analysis.classification),
                color: '#fff',
                fontSize: 12,
              }}
            >
              {analysis.classification} · −{analysis.cpLoss.toFixed(2)}
            </span>
          )}
        </div>
      )}
      {analysis && (
        <div style={{ marginBottom: 12, padding: 8, background: '#f3f1ea', borderRadius: 6 }}>
          {analysis.topExplanation}
        </div>
      )}

      {selected && r ? (
        <div>
          <div>
            <strong>{selected}</strong> — {r.piece}
          </div>
          <div>Attacked by: {r.attackedBy.length ? r.attackedBy.join(', ') : '—'}</div>
          <div>Defended by: {r.defendedBy.length ? r.defendedBy.join(', ') : '—'}</div>
          <div>
            SEE: {see!.swing > 0 ? `losing ${see!.swing}` : 'safe'}{' '}
            {see!.losingSideToMove ? '⚠️' : ''}
          </div>
        </div>
      ) : selected ? (
        <div style={{ color: '#888' }}>Empty square — {selected}</div>
      ) : (
        <div style={{ color: '#888' }}>Click a square to inspect.</div>
      )}

      {analysis && analysis.rankedInsights.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h4 style={{ margin: '0 0 4px' }}>Ranked insights</h4>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {analysis.rankedInsights.slice(0, 5).map((ins) => (
              <li key={ins.id} style={{ marginBottom: 2 }}>
                <span style={{ color: '#666' }}>[{ins.saliency.toFixed(2)}]</span>{' '}
                {ins.kind === 'motif' ? ins.type : ins.type} @ {ins.squares.join(',')}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function classColor(c: string): string {
  switch (c) {
    case 'best':
    case 'excellent':
      return '#3fbf5f';
    case 'good':
      return '#5a9bd4';
    case 'inaccuracy':
      return '#e8923b';
    case 'mistake':
      return '#e2603b';
    case 'blunder':
      return '#e23b3b';
    default:
      return '#888';
  }
}
