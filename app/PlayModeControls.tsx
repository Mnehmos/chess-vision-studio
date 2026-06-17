import type { ModeId } from '../engine/led';
import { MODES } from './modes';

export function PlayModeControls({
  mode,
  hasAnalysis,
  hideOverlays,
  onModeChange,
  onHideOverlaysChange,
}: {
  mode: ModeId;
  hasAnalysis: boolean;
  hideOverlays: boolean;
  onModeChange: (mode: ModeId) => void;
  onHideOverlaysChange: (hide: boolean) => void;
}) {
  return (
    <div className="play-control-row play-mode-controls">
      {MODES.map((candidate) => {
        const disabled = !!candidate.needsAnalysis && !hasAnalysis;
        return (
          <button
            key={candidate.id}
            disabled={disabled}
            onClick={() => onModeChange(candidate.id)}
            title={disabled ? 'Make a move with the engine loaded to populate this' : undefined}
            className={`play-mode-button${candidate.id === mode ? ' is-active' : ''}`}
          >
            {candidate.label}
          </button>
        );
      })}
      <button
        onClick={() => onHideOverlaysChange(!hideOverlays)}
        className={`play-mode-button play-mode-controls__overlay-toggle${hideOverlays ? ' is-active' : ''}`}
      >
        {hideOverlays ? 'Show Overlays' : 'Hide Overlays'}
      </button>
    </div>
  );
}
