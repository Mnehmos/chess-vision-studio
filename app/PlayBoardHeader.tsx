import type { PlayStatus } from './play-mode-state';

export function PlayBoardHeader({
  status,
  hasHistory,
  onUndo,
  onFlip,
  onExport,
  onNewGame,
}: {
  status: PlayStatus;
  hasHistory: boolean;
  onUndo: () => void;
  onFlip: () => void;
  onExport: () => void;
  onNewGame: () => void;
}) {
  return (
    <div className="play-board-header">
      <strong data-testid="play-status" className="play-board-header__status" style={{ color: status.tone }}>
        {status.text}
      </strong>
      <div className="play-board-header__actions">
        <button className="play-button" onClick={onUndo} disabled={!hasHistory}>
          Undo
        </button>
        <button className="play-button" onClick={onFlip}>
          Flip
        </button>
        <button className="play-button" onClick={onExport} disabled={!hasHistory}>
          Export
        </button>
        <button className="play-button play-button--primary" onClick={onNewGame}>
          New game
        </button>
      </div>
    </div>
  );
}
