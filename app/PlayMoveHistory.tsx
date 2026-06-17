import type { MoveHistoryRow } from './play-mode-state';

export function PlayMoveHistory({ rows }: { rows: MoveHistoryRow[] }) {
  return (
    <div className="play-panel play-move-history">
      <strong className="play-panel__title">Moves</strong>
      {rows.length === 0 ? (
        <p className="play-move-history__empty">No moves yet {'\u2014'} White to start.</p>
      ) : (
        <ol className="play-move-history__list">
          {rows.map((r) => (
            <li key={r.n} className="play-move-history__row">
              <span className="play-move-history__number">{r.n}.</span>
              <span className="play-move-history__move">{r.white}</span>
              <span className="play-move-history__move play-move-history__move--black">
                {r.black ?? ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
