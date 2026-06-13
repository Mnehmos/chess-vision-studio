// Engine comparison card — Stockfish verdict vs native CVS engine, side by side.
// Extracted from App so Play mode can render the same panel.
import type { MoveAnalysis } from '../engine/types';
import type { CvsEngineAnalysis, CvsEngineHealth } from './cvs-engine-client';

export function EngineComparisonPanel({
  stockfishState,
  stockfishAnalysis,
  move,
  cvsHealth,
  cvsAnalysis,
  cvsBusy,
  cvsError,
  cvsContext,
  cvsPlayedUci,
}: {
  stockfishState: 'loading' | 'ready' | 'off';
  stockfishAnalysis: MoveAnalysis | undefined;
  move: string | undefined;
  cvsHealth: CvsEngineHealth;
  cvsAnalysis: CvsEngineAnalysis | null;
  cvsBusy: boolean;
  cvsError: string | undefined;
  cvsContext: string;
  cvsPlayedUci: string | undefined;
}) {
  const labelStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' };
  const valueStyle: React.CSSProperties = { margin: 0, fontSize: 14, color: 'var(--text)', lineHeight: 1.45 };
  return (
    <section style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Engine Analysis</h2>
        <span style={{ color: 'var(--muted)', fontSize: 12, flexShrink: 0 }}>local WIP</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <p style={labelStyle}>Stockfish</p>
          {stockfishState !== 'ready' ? (
            <p style={valueStyle}>{stockfishState === 'loading' ? 'loading' : 'off'}</p>
          ) : stockfishAnalysis ? (
            <>
              <p style={valueStyle}>
                {move ?? stockfishAnalysis.move}: {stockfishAnalysis.classification}, loss {stockfishAnalysis.cpLoss.toFixed(2)}
              </p>
              <p style={{ ...valueStyle, fontSize: 13 }}>
                eval {formatEval(stockfishAnalysis.evalAfter)} d{stockfishAnalysis.evalAfter.depth}
              </p>
              <p style={{ ...valueStyle, color: 'var(--muted)', fontSize: 12 }}>{stockfishAnalysis.evalAfter.pv.slice(0, 6).join(' ') || 'no pv'}</p>
            </>
          ) : (
            <p style={valueStyle}>waiting for a played move</p>
          )}
        </div>
        <div style={{ minWidth: 0, borderLeft: '1px solid var(--border)', paddingLeft: 14 }}>
          <p style={labelStyle}>CVS Engine</p>
          <p style={{ ...valueStyle, color: 'var(--muted)', fontSize: 12 }}>{cvsContext}</p>
          {!cvsHealth.available ? (
            <p style={valueStyle}>{cvsHealth.error || 'local engine unavailable'}</p>
          ) : cvsError ? (
            <p style={{ ...valueStyle, color: 'var(--bad)' }}>{cvsError}</p>
          ) : cvsAnalysis ? (
            <>
              <p style={valueStyle}>
                {cvsPlayedUci ? `played ${cvsPlayedUci}, ` : ''}best {cvsAnalysis.uci ?? 'none'} {formatCvsAgreement(cvsPlayedUci, cvsAnalysis.uci)}{' '}
                {cvsBusy ? '(updating)' : ''}
              </p>
              <p style={{ ...valueStyle, fontSize: 13 }}>
                eval {formatCvsEval(cvsAnalysis)} d{cvsAnalysis.depth} in {cvsAnalysis.timeMs}ms
              </p>
              <p style={{ ...valueStyle, color: 'var(--muted)', fontSize: 12 }}>
                {formatNodes(cvsAnalysis.nodes)} nodes, q {formatNodes(cvsAnalysis.qNodes)}, tt {cvsAnalysis.ttHits}
              </p>
              <p style={{ ...valueStyle, color: 'var(--muted)', fontSize: 12 }}>{cvsAnalysis.pv.slice(0, 6).join(' ') || 'no pv'}</p>
            </>
          ) : (
            <p style={valueStyle}>{cvsBusy ? `analyzing ${cvsContext}` : 'ready'}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function formatEval(evalInfo: MoveAnalysis['evalAfter']): string {
  if (typeof evalInfo.mate === 'number') return `M${evalInfo.mate}`;
  if (typeof evalInfo.cp === 'number') return formatCp(evalInfo.cp);
  return evalInfo.status === 'terminal' ? 'terminal' : 'unavailable';
}

function formatCvsEval(result: CvsEngineAnalysis): string {
  if (typeof result.mate === 'number') return `M${result.mate}`;
  return formatCp(result.scoreCp);
}

function formatCvsAgreement(playedUci: string | undefined, bestUci: string | null): string {
  if (!playedUci || !bestUci) return '';
  return playedUci === bestUci ? '(agrees)' : '(prefers different move)';
}

function formatNodes(nodes: number): string {
  if (nodes >= 1_000_000) return `${(nodes / 1_000_000).toFixed(1)}M`;
  if (nodes >= 1_000) return `${(nodes / 1_000).toFixed(1)}k`;
  return String(nodes);
}

function formatCp(cp: number): string {
  const pawns = cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}
