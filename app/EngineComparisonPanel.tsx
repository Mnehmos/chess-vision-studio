// Engine comparison card - Stockfish verdict vs native CVS engine, side by side.
// Extracted from App so Play mode can render the same panel.
import type { MoveAnalysis } from '../engine/types';
import { normalizedScoreFromSideToMove } from '../engine/analysis-frame';
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
  return (
    <section className="engine-comparison">
      <div className="engine-comparison__header">
        <h2 className="engine-comparison__title">Engine Analysis</h2>
        <span className="engine-comparison__tag">local WIP</span>
      </div>
      <div className="engine-comparison__grid">
        <div className="engine-comparison__column">
          <p className="engine-comparison__label">Stockfish</p>
          {stockfishState !== 'ready' ? (
            <p className="engine-comparison__value">
              {stockfishState === 'loading' ? 'loading' : 'off'}
            </p>
          ) : stockfishAnalysis ? (
            <>
              <p className="engine-comparison__value">
                {move ?? stockfishAnalysis.move}: {stockfishAnalysis.classification}, loss{' '}
                {stockfishAnalysis.cpLoss.toFixed(2)}
              </p>
              <p className="engine-comparison__value engine-comparison__value--small">
                eval {formatEval(stockfishAnalysis.evalAfter)} d{stockfishAnalysis.evalAfter.depth}
              </p>
              <p className="engine-comparison__value engine-comparison__value--muted">
                {stockfishAnalysis.evalAfter.pv.slice(0, 6).join(' ') || 'no pv'}
              </p>
            </>
          ) : (
            <p className="engine-comparison__value">waiting for a played move</p>
          )}
        </div>

        <div className="engine-comparison__column engine-comparison__column--cvs">
          <p className="engine-comparison__label">CVS Engine</p>
          <p className="engine-comparison__value engine-comparison__value--muted">{cvsContext}</p>
          {!cvsHealth.available ? (
            <p className="engine-comparison__value">
              {cvsHealth.error || 'local engine unavailable'}
            </p>
          ) : cvsError ? (
            <p className="engine-comparison__value engine-comparison__value--error">
              {cvsError}
            </p>
          ) : cvsAnalysis ? (
            <>
              <p className="engine-comparison__value">
                {cvsPlayedUci ? `played ${cvsPlayedUci}, ` : ''}best {cvsAnalysis.uci ?? 'none'}{' '}
                {formatCvsAgreement(cvsPlayedUci, cvsAnalysis.uci)} {cvsBusy ? '(updating)' : ''}
              </p>
              <p className="engine-comparison__value engine-comparison__value--small">
                eval {formatCvsEval(cvsAnalysis)} d{cvsAnalysis.depth} in {cvsAnalysis.timeMs}ms
              </p>
              <p className="engine-comparison__value engine-comparison__value--muted">
                {formatNodes(cvsAnalysis.nodes)} nodes, q {formatNodes(cvsAnalysis.qNodes)}, tt{' '}
                {cvsAnalysis.ttHits}
              </p>
              <p className="engine-comparison__value engine-comparison__value--muted">
                {cvsAnalysis.pv.slice(0, 6).join(' ') || 'no pv'}
              </p>
            </>
          ) : (
            <p className="engine-comparison__value">
              {cvsBusy ? `analyzing ${cvsContext}` : 'ready'}
            </p>
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

// CVS eval is reported side-to-move (UCI). Display it White-normalized so it
// reads on the same axis as the rest of the UI (plan §3.2/§6 PR-02); the "(W)"
// marker makes the perspective explicit. Raw side-to-move values remain on the
// result object for diagnostics.
function formatCvsEval(result: CvsEngineAnalysis): string {
  const score = normalizedScoreFromSideToMove({
    fen: result.fen,
    cp: result.scoreCp,
    mate: result.mate,
  });
  if (score.whiteMate !== null) return `M${score.whiteMate} (W)`;
  if (score.whiteCp !== null) return `${formatCp(score.whiteCp)} (W)`;
  return 'unavailable';
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
