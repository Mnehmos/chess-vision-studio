export function PlayBoardHelp({
  debug,
  onDebugChange,
}: {
  debug: boolean;
  onDebugChange: (debug: boolean) => void;
}) {
  return (
    <p className="play-board-help">
      Drag a piece or click from {'\u2192'} to. Only legal moves are allowed.
      <label
        className="play-board-help__toggle"
        title="dev overlay: artifact identity + eval status"
      >
        <input
          type="checkbox"
          checked={debug}
          onChange={(event) => onDebugChange(event.target.checked)}
        />{' '}
        debug
      </label>
    </p>
  );
}
