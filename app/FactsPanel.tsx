// Facts panel — a "relationship card" for the inspected square plus this ply's
// move analysis. The loop: click square → arrows show relationships → this card
// explains in words → LED preview mirrors it. A visual debugger for positions.
import { squareReport, type SquareStatus } from '../engine/relationship';
import type { InsightCandidate, MoveAnalysis, Square } from '../engine/types';

const STATUS_COLOR: Record<SquareStatus, string> = {
  empty: '#9aa',
  hanging: '#e23b3b', // red — losing material
  defended_target: '#8a6d3b', // contested but holds
  loose: '#e8b33b', // yellow — loose / tactically relevant
  defended: '#3f813f', // green — safe & protected
  undefended: '#888',
};

export function FactsPanel({
  fen,
  selected,
  analysis,
  move,
  focused,
  onFocus,
}: {
  fen: string;
  selected?: Square;
  analysis?: MoveAnalysis;
  move?: string;
  focused?: InsightCandidate | null;
  onFocus?: (ins: InsightCandidate) => void;
}) {
  const report = selected ? squareReport(fen, selected) : undefined;
  // "What tactic depends on this square?" — insights whose squares include it.
  const dependentTactics =
    selected && analysis
      ? analysis.rankedInsights.filter((i) => i.squares.includes(selected))
      : [];

  return (
    <div style={{ minWidth: 300, fontSize: 14, lineHeight: 1.55 }}>
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

      {/* The relationship card */}
      {report && report.occupied ? (
        <div
          style={{
            border: '2px solid #2563c9', // blue outline = inspected piece
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {report.square} — {report.color} {report.pieceName?.toLowerCase()}
          </div>
          <Row label="Attacked by" items={report.attackedBy.map((a) => a.label)} color="#c53030" />
          <Row label="Defended by" items={report.defendedBy.map((d) => d.label)} color="#2f855a" />
          <div>
            <span style={{ color: '#666' }}>SEE:</span>{' '}
            {report.safe ? 'safe' : `losing ${report.see}`}
          </div>
          <div style={{ marginTop: 6 }}>
            <span style={{ color: '#666' }}>Status:</span>{' '}
            <span
              style={{
                padding: '1px 8px',
                borderRadius: 10,
                background: STATUS_COLOR[report.status],
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {report.statusLabel}
            </span>
          </div>
          {dependentTactics.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <span style={{ color: '#666' }}>Part of:</span>{' '}
              {dependentTactics.map((ins, i) => (
                <span key={ins.id}>
                  <span
                    onClick={() => onFocus?.(ins)}
                    style={{ color: '#b45309', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {ins.type.replace(/_/g, ' ')}
                  </span>
                  {i < dependentTactics.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : report ? (
        <div
          style={{
            border: '2px solid #cbd5e1', // grey outline = inspected empty square
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{report.square} — empty square</div>
          <Row
            label="Can move here"
            items={(report.canMoveHere ?? []).map((m) => m.label)}
            color="#2f855a"
          />
          <Row
            label="White controls"
            items={(report.controlledByWhite ?? []).map((m) => m.label)}
            color="#555"
          />
          <Row
            label="Black controls"
            items={(report.controlledByBlack ?? []).map((m) => m.label)}
            color="#555"
          />
          {dependentTactics.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <span style={{ color: '#666' }}>Part of:</span>{' '}
              {dependentTactics.map((ins, i) => (
                <span key={ins.id}>
                  <span
                    onClick={() => onFocus?.(ins)}
                    style={{ color: '#b45309', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {ins.type.replace(/_/g, ' ')}
                  </span>
                  {i < dependentTactics.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ color: '#888', marginBottom: 12 }}>Click a square to inspect.</div>
      )}

      {analysis && analysis.rankedInsights.length > 0 && (
        <div>
          <h4 style={{ margin: '0 0 4px' }}>
            Ranked insights{' '}
            {focused && (
              <button onClick={() => onFocus?.(focused)} style={{ fontSize: 11, marginLeft: 6 }}>
                unfocus
              </button>
            )}
          </h4>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {analysis.rankedInsights.slice(0, 6).map((ins) => {
              const isFocused = focused === ins;
              return (
                <li key={ins.id} style={{ marginBottom: 2 }}>
                  <span
                    onClick={() => onFocus?.(ins)}
                    title="focus the board on this insight"
                    style={{
                      cursor: 'pointer',
                      padding: '0 4px',
                      borderRadius: 4,
                      background: isFocused ? '#fde68a' : 'transparent',
                      fontWeight: isFocused ? 700 : 400,
                    }}
                  >
                    <span style={{ color: '#666' }}>[{ins.saliency.toFixed(2)}]</span> {ins.type} @{' '}
                    {ins.squares.join(',')}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

function Row({ label, items, color }: { label: string; items: string[]; color: string }) {
  return (
    <div>
      <span style={{ color: '#666' }}>{label}:</span>{' '}
      {items.length ? (
        items.map((it, i) => (
          <span key={it}>
            <span style={{ color }}>{it}</span>
            {i < items.length - 1 ? ', ' : ''}
          </span>
        ))
      ) : (
        <span style={{ color: '#999' }}>none</span>
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
