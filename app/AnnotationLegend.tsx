// The arrow legend + annotation toggles, shared by the analysis Board view and
// Play mode. Color key (attacks / defends / tactical line / played move) plus the
// four switches: follow move, threat line, all threats, cascade.
import { ARROW } from './BoardArrows';

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
}) {
  const swatch = (color: string, label: string) => (
    <span style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
      <span
        style={{
          display: 'inline-block',
          width: 14,
          height: 4,
          background: color,
          borderRadius: 2,
          marginRight: 4,
          verticalAlign: 'middle',
        }}
      />
      {label}
    </span>
  );
  return (
    <div style={{ marginTop: 8, fontSize: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
      <strong style={{ marginRight: 6 }}>Arrows:</strong>
      {swatch(ARROW.attack, 'attacks / threats')}
      {swatch(ARROW.defend, 'defends / protects')}
      {swatch(ARROW.tactical, 'tactical line (1·2·3)')}
      {swatch(ARROW.move, 'played move')}
      <label style={{ marginLeft: 8, cursor: 'pointer' }} title="track the move that just happened">
        <input type="checkbox" checked={followMove} onChange={(e) => setFollowMove(e.target.checked)} />{' '}
        follow move
      </label>
      <label style={{ marginLeft: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={showThreats} onChange={(e) => setShowThreats(e.target.checked)} />{' '}
        threat line
      </label>
      <label style={{ marginLeft: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={showAllThreats}
          onChange={(e) => setShowAllThreats(e.target.checked)}
        />{' '}
        all threats
      </label>
      <label style={{ marginLeft: 8, cursor: 'pointer' }} title="surface the next hop in the chain">
        <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />{' '}
        cascade
      </label>
      {hasSelection && (
        <button onClick={onClear} style={{ marginLeft: 6, fontSize: 11 }}>
          clear selection
        </button>
      )}
    </div>
  );
}
