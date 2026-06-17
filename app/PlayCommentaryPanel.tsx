export function PlayCommentaryPanel({
  narrationAvailable,
  canExplain,
  explaining,
  coachText,
  engineReady,
  onExplain,
}: {
  narrationAvailable: boolean;
  canExplain: boolean;
  explaining: boolean;
  coachText: string;
  engineReady: boolean;
  onExplain: () => void;
}) {
  return (
    <div className="play-panel play-commentary">
      <strong className="play-panel__title">Commentary</strong>
      {narrationAvailable ? (
        <>
          <button className="play-commentary__button" onClick={onExplain} disabled={!canExplain || explaining}>
            {explaining ? `Explaining${'\u2026'}` : 'Explain this move'}
          </button>
          {coachText && <p className="play-commentary__text">{coachText}</p>}
        </>
      ) : (
        engineReady && (
          <p className="play-commentary__empty">
            Add an OpenAI key (.env, server-side) for written commentary.
          </p>
        )
      )}
    </div>
  );
}
