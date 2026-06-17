import type { ReviewMoment } from './play-mode-review';

export function PlayGameReview({
  reviewMoments,
  onExport,
}: {
  reviewMoments: ReviewMoment[];
  onExport: () => void;
}) {
  if (reviewMoments.length === 0) return null;

  return (
    <div className="play-game-review">
      <h4 className="play-game-review__title">Game Review</h4>
      <div className="play-game-review__body">
        <button className="play-game-review__export" onClick={onExport}>
          {'\u2b07'} Export JSON
        </button>
        <div className="play-game-review__list">
          {reviewMoments.map((m) => (
            <div key={m.id} className="play-game-review__item">
              <div className="play-game-review__item-title">Ply {m.ply + 1} break:</div>
              <div className="play-game-review__insight">{m.insight}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
