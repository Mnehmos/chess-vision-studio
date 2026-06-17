import type { AlternativeLine } from './arrow-analysis-store';
import type { VariationPreviewPosition } from './variation-preview';

export type VariationPreviewLineState = {
  alt: AlternativeLine;
  currentIndex: number;
};

export type VariationPreviewGifJob = {
  running: boolean;
  done: number;
  total: number;
};

export function VariationPreviewPanel({
  previewLine,
  previewPositions,
  gifJob,
  firstLabel = 'Ref',
  lastLabel = 'End',
  onStep,
  onSave,
  onExportGif,
  onExit,
}: {
  previewLine: VariationPreviewLineState;
  previewPositions: VariationPreviewPosition[];
  gifJob: VariationPreviewGifJob;
  firstLabel?: string;
  lastLabel?: string;
  onStep: (index: number) => void;
  onSave: () => void;
  onExportGif: () => void;
  onExit: () => void;
}) {
  const atStart = previewLine.currentIndex === 0;
  const atEnd =
    previewPositions.length === 0 || previewLine.currentIndex >= previewPositions.length - 1;

  return (
    <div className="variation-preview-panel">
      <div className="variation-preview-panel__header">
        <span className="variation-preview-panel__title">Previewing Variation</span>
        <span className="variation-preview-panel__step">
          Step: {previewLine.currentIndex + 1} / {previewPositions.length}
        </span>
      </div>

      <div className="variation-preview-panel__moves">
        {previewPositions.map((pos, idx) => {
          if (!pos.san) return null;
          const active = idx === previewLine.currentIndex;
          return (
            <button
              key={`${pos.uci}-${idx}`}
              className={`variation-preview-panel__move${active ? ' is-active' : ''}`}
              onClick={() => onStep(idx)}
            >
              {pos.san}
            </button>
          );
        })}
      </div>

      <div className="variation-preview-panel__actions">
        <button
          className="play-button variation-preview-panel__nav"
          onClick={() => onStep(0)}
          disabled={atStart}
        >
          {firstLabel}
        </button>
        <button
          className="play-button variation-preview-panel__nav"
          onClick={() => onStep(previewLine.currentIndex - 1)}
          disabled={atStart}
        >
          {'\u25c0'}
        </button>
        <button
          className="play-button variation-preview-panel__nav"
          onClick={() => onStep(previewLine.currentIndex + 1)}
          disabled={atEnd}
        >
          {'\u25b6'}
        </button>
        <button
          className="play-button variation-preview-panel__nav"
          onClick={() => onStep(previewPositions.length - 1)}
          disabled={atEnd}
        >
          {lastLabel}
        </button>

        <button
          className="play-button play-button--primary variation-preview-panel__save"
          onClick={onSave}
          data-gif-exclude="true"
        >
          Save Variation
        </button>
        <button
          className="play-button variation-preview-panel__command"
          onClick={onExportGif}
          disabled={gifJob.running}
          data-gif-exclude="true"
        >
          {gifJob.running ? `GIF ${gifJob.done}/${gifJob.total}` : 'Export GIF'}
        </button>
        <button
          className="play-button variation-preview-panel__command"
          onClick={onExit}
          data-gif-exclude="true"
        >
          Exit (Esc)
        </button>
      </div>
    </div>
  );
}
