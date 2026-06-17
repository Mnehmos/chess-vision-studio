import { useEffect, useRef } from 'react';
import type { MoveAnalysis } from '../engine/types';
import type { PlyRecord } from '../engine/position';
import { keepInView } from './analysis-scroll';

export function AnalysisMoveHistory({
  plies,
  view,
  onViewChange,
  setView,
  analyses,
  branchLabel,
  branchSourceLabel,
  onBackToBranchSource,
}: {
  plies: PlyRecord[];
  view: number;
  onViewChange?: (view: number) => void;
  setView?: (view: number) => void;
  analyses: Map<number, MoveAnalysis>;
  branchLabel?: string;
  branchSourceLabel?: string;
  onBackToBranchSource?: () => void;
}) {
  const changeView = onViewChange ?? setView ?? (() => {});
  const currentRef = useRef<HTMLTableRowElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    keepInView(currentRef.current, scrollRef.current, 'y');
  }, [view]);

  const rows: { no: number; w?: PlyRecord & { i: number }; b?: PlyRecord & { i: number } }[] =
    [];
  plies.forEach((ply, i) => {
    const row = rows.find((item) => item.no === ply.moveNumber) ?? { no: ply.moveNumber };
    if (!rows.includes(row)) rows.push(row);
    if (ply.color === 'w') row.w = { ...ply, i };
    else row.b = { ...ply, i };
  });

  const cell = (move?: PlyRecord & { i: number }) => {
    if (!move) return <td />;
    const analysis = analyses.get(move.i);
    const bad = analysis && (analysis.classification === 'blunder' || analysis.classification === 'mistake');
    const current = view === move.i + 1;
    return (
      <td
        className={`analysis-move-history__move${current ? ' is-current' : ''}${
          bad ? ' is-bad' : ''
        }`}
        onClick={() => changeView(move.i + 1)}
      >
        {move.san}
        {bad ? (analysis!.classification === 'blunder' ? ' ??' : ' ?!') : ''}
      </td>
    );
  };

  return (
    <div className="analysis-move-history">
      <h4 className="analysis-move-history__title">Move history</h4>
      {branchLabel && (
        <div className="analysis-move-history__branch">
          <div className="analysis-move-history__branch-label">{branchLabel}</div>
          {onBackToBranchSource && (
            <button
              className="analysis-move-history__branch-button"
              onClick={onBackToBranchSource}
              title={
                branchSourceLabel ? `Return to ${branchSourceLabel}` : 'Return to the source line'
              }
            >
              Back to source line
            </button>
          )}
        </div>
      )}
      <div ref={scrollRef} className="analysis-move-history__scroll">
        <table className="analysis-move-history__table">
          <tbody>
            {rows.map((row) => {
              const isCurrentRow = view === (row.w?.i ?? -2) + 1 || view === (row.b?.i ?? -2) + 1;
              return (
                <tr key={row.no} ref={isCurrentRow ? currentRef : undefined}>
                  <td className="analysis-move-history__number">{row.no}.</td>
                  {cell(row.w)}
                  {cell(row.b)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="analysis-move-history__hint">{'\u2190'} {'\u2192'} keys to step</div>
    </div>
  );
}
