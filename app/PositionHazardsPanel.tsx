// PositionHazardsPanel (AnalysisFrameV2 PR-10) — presentational EVIDENCE view of
// the Rust-computed hazards on the CURRENT position. It answers "what threats does
// the engine see on this board?" — NOT "was the last move good?" (no grade) and
// NOT "this move caused X" (no causal claim). It renders the
// positionHazardsView(position) groupings only.
//
// Suppression rule (plan §11): when the hazard validator RAN and found nothing
// (status 'computed', hasHazards false) the panel renders nothing — silence means
// "verified clean", which we do NOT spell out as a claim. An `uncomputed` /
// `unavailable` status is surfaced (with its reason) so the absence is never read
// as "no hazards". A dev `showAll` flag forces the empty/clean state to render.
import type { HazardGroup, PositionHazardsView } from '../engine/hazard-view';
import type { Side } from '../engine/teaching/types';

const HAZARD_KIND_LABEL: Record<string, string> = {
  mate_threat: 'mate threat',
  losing_material: 'losing material',
  fork_threat: 'fork threat',
  pin_constraint: 'pin',
  pin: 'pin',
  king_pressure: 'king pressure',
};

function hazardKindLabel(kind: string): string {
  return HAZARD_KIND_LABEL[kind] ?? kind.replace(/_/g, ' ');
}

function sideLabel(side: Side): string {
  return side === 'white' ? 'White' : 'Black';
}

function formatCp(cp: number): string {
  const pawns = cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

export function PositionHazardsPanel({
  view,
  showAll = false,
}: {
  view: PositionHazardsView;
  // Dev flag: render the computed-but-empty ("verified clean") state too.
  showAll?: boolean;
}) {
  if (view.status !== 'computed') {
    return (
      <section className="hazards-panel hazards-panel--position">
        <div className="hazards-panel__header">
          <h3 className="hazards-panel__title">Position hazards</h3>
          <span className="hazards-panel__tag">evidence</span>
        </div>
        <p className="hazards-panel__status hazards-panel__status--muted">
          {view.status === 'uncomputed' ? 'not computed' : 'unavailable'}: {view.reason}
        </p>
      </section>
    );
  }

  if (!view.hasHazards) {
    if (!showAll) return null;
    return (
      <section className="hazards-panel hazards-panel--position">
        <div className="hazards-panel__header">
          <h3 className="hazards-panel__title">Position hazards</h3>
          <span className="hazards-panel__tag">evidence</span>
        </div>
        <p className="hazards-panel__status hazards-panel__status--good">
          no hazards found
        </p>
      </section>
    );
  }

  return (
    <section className="hazards-panel hazards-panel--position">
      <div className="hazards-panel__header">
        <h3 className="hazards-panel__title">Position hazards</h3>
        <span className="hazards-panel__tag">evidence</span>
      </div>
      <ul className="hazards-panel__list">
        {view.groups.map((group) => (
          <HazardGroupRow key={`${group.side}-${group.kind}`} group={group} />
        ))}
      </ul>
    </section>
  );
}

function HazardGroupRow({ group }: { group: HazardGroup }) {
  return (
    <li className={`hazards-panel__item hazards-panel__item--${group.side}`}>
      <span className="hazards-panel__kind">
        {sideLabel(group.side)} {hazardKindLabel(group.kind)}
      </span>
      {typeof group.magnitudeCp === 'number' && (
        <span className="hazards-panel__magnitude">{formatCp(group.magnitudeCp)}</span>
      )}
      <span className="hazards-panel__squares">{group.squares.join(', ')}</span>
      {group.moveUcis.length > 0 && (
        <span className="hazards-panel__moves">via {group.moveUcis.join(', ')}</span>
      )}
    </li>
  );
}
