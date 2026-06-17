export function AnnotationCommandList() {
  return (
    <div className="annotation-command-list cvsControlsLegend">
      <h4 className="annotation-command-list__title">Legend & Keys</h4>

      <div className="annotation-command-list__items">
        <div>
          <strong className="annotation-command-list__term">Right-Drag</strong>
          Draw sequential prediction arrows (White / Black)
        </div>
        <div>
          <strong className="annotation-command-list__term">Right-Click Arrow</strong>
          Delete that arrow and all subsequent steps
        </div>
        <div>
          <strong className="annotation-command-list__term">Left-Click/Drag</strong>
          Make legal move or inspect square facts
        </div>
        <div>
          <strong className="annotation-command-list__term">Pin / Preview</strong>
          Pin card / preview prediction on board
        </div>
        <div>
          <strong className="annotation-command-list__term">Reveal Analysis</strong>
          Show move evaluations and principal variations
        </div>

        <div className="annotation-command-list__shortcuts">
          <span className="annotation-command-list__shortcut-title">Keyboard Shortcuts</span>
          <div className="annotation-command-list__shortcut-list">
            <div className="annotation-command-list__shortcut-row">
              <span>Game Move</span>
              <span className="annotation-command-list__shortcut-key">
                {'\u2190'} / {'\u2192'}
              </span>
            </div>
            <div className="annotation-command-list__shortcut-row">
              <span>Jump Start/End</span>
              <span className="annotation-command-list__shortcut-key">Home / End</span>
            </div>
            <div className="annotation-command-list__shortcut-row">
              <span>Exit Preview</span>
              <span className="annotation-command-list__shortcut-key">Esc</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
