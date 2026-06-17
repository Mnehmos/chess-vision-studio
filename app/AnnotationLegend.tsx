// The arrow legend + annotation toggles, shared by the analysis Board view and
// Play mode. Color key (attacks / defends / tactical line / played move) plus the
// four switches: follow move, threat line, all threats, cascade.

type SwatchKind = 'attack' | 'defend' | 'tactical' | 'move';

export function AnnotationLegend({
  showThreats,
  setShowThreats,
  showAllThreats,
  setShowAllThreats,
  cascade,
  setCascade,
  followMove,
  setFollowMove,
  hasSelection,
  onClear,
  hideOverlays,
  setHideOverlays,
}: {
  showThreats: boolean;
  setShowThreats: (v: boolean) => void;
  showAllThreats: boolean;
  setShowAllThreats: (v: boolean) => void;
  cascade: boolean;
  setCascade: (v: boolean) => void;
  followMove: boolean;
  setFollowMove: (v: boolean) => void;
  hasSelection: boolean;
  onClear: () => void;
  hideOverlays?: boolean;
  setHideOverlays?: (v: boolean) => void;
}) {
  const swatch = (kind: SwatchKind, label: string) => (
    <span className="annotation-legend__swatch-item">
      <span className={`annotation-legend__swatch annotation-legend__swatch--${kind}`} />
      {label}
    </span>
  );

  return (
    <div className="annotation-legend">
      <strong className="annotation-legend__title">Arrows:</strong>
      {swatch('attack', 'attacks / threats')}
      {swatch('defend', 'defends / protects')}
      {swatch('tactical', 'tactical line (1-2-3)')}
      {swatch('move', 'played move')}
      <label className="annotation-legend__toggle" title="track the move that just happened">
        <input
          type="checkbox"
          checked={followMove}
          onChange={(event) => setFollowMove(event.target.checked)}
        />{' '}
        follow move
      </label>
      <label className="annotation-legend__toggle">
        <input
          type="checkbox"
          checked={showThreats}
          onChange={(event) => setShowThreats(event.target.checked)}
        />{' '}
        threat line
      </label>
      <label className="annotation-legend__toggle">
        <input
          type="checkbox"
          checked={showAllThreats}
          onChange={(event) => setShowAllThreats(event.target.checked)}
        />{' '}
        all threats
      </label>
      <label className="annotation-legend__toggle" title="surface the next hop in the chain">
        <input
          type="checkbox"
          checked={cascade}
          onChange={(event) => setCascade(event.target.checked)}
        />{' '}
        cascade
      </label>
      {setHideOverlays && (
        <label
          className="annotation-legend__toggle annotation-legend__toggle--accent"
          title="hide all board overlay data, LEDs, and mode lines (except prediction arrows)"
        >
          <input
            type="checkbox"
            checked={!!hideOverlays}
            onChange={(event) => setHideOverlays(event.target.checked)}
          />{' '}
          hide overlays
        </label>
      )}
      {hasSelection && (
        <button className="annotation-legend__clear" onClick={onClear}>
          clear selection
        </button>
      )}
    </div>
  );
}
