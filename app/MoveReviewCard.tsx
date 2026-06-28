// MoveReviewCard — Stockfish's grade of the PLAYED move (classification, cp loss,
// post-move eval, refutation line, deep-check status). It does NOT call CVS and
// makes no engine-disagreement claim (plan §6 PR-03). Extracted from the former
// combined EngineComparisonPanel so move grading and engine opinion are separate.
import type { MoveAnalysis } from '../engine/types';

export function MoveReviewCard({
  stockfishState,
  analysis,
  move,
}: {
  stockfishState: 'loading' | 'ready' | 'off';
  analysis: MoveAnalysis | undefined;
  move: string | undefined;
}) {
  return (
    <section className="move-review">
      <div className="move-review__header">
        <h2 className="move-review__title">Move Review</h2>
        <span className="move-review__tag">Stockfish</span>
      </div>
      {stockfishState !== 'ready' ? (
        <p className="move-review__value">{stockfishState === 'loading' ? 'loading' : 'off'}</p>
      ) : analysis ? (
        <>
          <p className="move-review__value">
            {move ?? analysis.move}: {analysis.classification}, loss {analysis.cpLoss.toFixed(2)}
          </p>
          <p className="move-review__value move-review__value--small">
            eval {formatEval(analysis.evalAfter)} d{analysis.evalAfter.depth}
            {analysis.deepCheck ? ' · deep-checked' : ''}
          </p>
          <p className="move-review__value move-review__value--muted">
            {analysis.evalAfter.pv.slice(0, 6).join(' ') || 'no pv'}
          </p>
        </>
      ) : (
        <p className="move-review__value">waiting for a played move</p>
      )}
    </section>
  );
}

function formatEval(evalInfo: MoveAnalysis['evalAfter']): string {
  if (typeof evalInfo.mate === 'number') return `M${evalInfo.mate}`;
  if (typeof evalInfo.cp === 'number') return formatCp(evalInfo.cp);
  return evalInfo.status === 'terminal' ? 'terminal' : 'unavailable';
}

function formatCp(cp: number): string {
  const pawns = cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}
