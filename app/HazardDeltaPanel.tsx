// HazardDeltaPanel (AnalysisFrameV2 PR-10) — presentational EVIDENCE view of what
// a played move CHANGED: hazards created / removed / worsened and pawn structures
// created / removed. It is descriptive only — NO move grade, NO causal "because"
// claim. It renders hazardDeltaView(move) sections.
//
// Suppression rule (plan §11): a section whose validator RAN and found nothing
// (status 'computed', empty groups) is not rendered — an empty computed delta is a
// verified "no change", which we do not assert as text. Sections with
// `uncomputed` / `unavailable` status ARE surfaced (with reason) so the gap reads
// as "not computed", never "nothing changed". A dev `showAll` flag renders the
// empty computed sections too. The whole panel collapses to null only when EVERY
// section is computed-and-empty (and not showAll).
import type {
  HazardDeltaSection,
  HazardDeltaView,
  HazardGroup,
  StructureDeltaGroup,
  StructureDeltaSection,
} from '../engine/hazard-view';
import type { Side } from '../engine/teaching/types';

const HAZARD_KIND_LABEL: Record<string, string> = {
  mate_threat: 'mate threat',
  losing_material: 'losing material',
  fork_threat: 'fork threat',
  pin_constraint: 'pin',
  pin: 'pin',
  king_pressure: 'king pressure',
};

const STRUCTURE_KIND_LABEL: Record<string, string> = {
  doubled_pawns: 'doubled pawns',
  isolated_pawn: 'isolated pawn',
  backward_pawn: 'backward pawn',
  passed_pawn: 'passed pawn',
  connected_passed: 'connected passed pawns',
};

function hazardKindLabel(kind: string): string {
  return HAZARD_KIND_LABEL[kind] ?? kind.replace(/_/g, ' ');
}

function structureKindLabel(kind: string): string {
  return STRUCTURE_KIND_LABEL[kind] ?? kind.replace(/_/g, ' ');
}

function sideLabel(side: Side): string {
  return side === 'white' ? 'White' : 'Black';
}

function formatCp(cp: number): string {
  const pawns = cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

// A hazard section is renderable when it is non-computed (carries a reason) OR
// computed with at least one group — OR showAll forces the empty computed case.
function hazardSectionRenderable(section: HazardDeltaSection, showAll: boolean): boolean {
  if (section.status !== 'computed') return true;
  return showAll || section.groups.length > 0;
}

function structureSectionRenderable(
  section: StructureDeltaSection,
  showAll: boolean,
): boolean {
  if (section.status !== 'computed') return true;
  return showAll || section.groups.length > 0;
}

export function HazardDeltaPanel({
  view,
  showAll = false,
}: {
  view: HazardDeltaView;
  // Dev flag: render computed-but-empty ("no change") sections too.
  showAll?: boolean;
}) {
  const sections: { key: string; label: string; section: HazardDeltaSection }[] = [
    { key: 'created', label: 'Hazards created', section: view.createdHazards },
    { key: 'worsened', label: 'Hazards worsened', section: view.worsenedHazards },
    { key: 'removed', label: 'Hazards removed', section: view.removedHazards },
  ];
  const structureSections: {
    key: string;
    label: string;
    section: StructureDeltaSection;
  }[] = [
    { key: 'struct-created', label: 'Structures created', section: view.createdStructures },
    { key: 'struct-removed', label: 'Structures removed', section: view.removedStructures },
  ];

  const anyHazard = sections.some((s) => hazardSectionRenderable(s.section, showAll));
  const anyStructure = structureSections.some((s) =>
    structureSectionRenderable(s.section, showAll),
  );
  if (!anyHazard && !anyStructure) return null;

  return (
    <section className="hazards-panel hazards-panel--delta">
      <div className="hazards-panel__header">
        <h3 className="hazards-panel__title">
          Move effects <span className="hazards-panel__move">{view.moveUci}</span>
        </h3>
        <span className="hazards-panel__tag">evidence</span>
      </div>

      {sections.map(({ key, label, section }) =>
        hazardSectionRenderable(section, showAll) ? (
          <HazardSectionBlock key={key} label={label} section={section} />
        ) : null,
      )}

      {structureSections.map(({ key, label, section }) =>
        structureSectionRenderable(section, showAll) ? (
          <StructureSectionBlock key={key} label={label} section={section} />
        ) : null,
      )}
    </section>
  );
}

function HazardSectionBlock({
  label,
  section,
}: {
  label: string;
  section: HazardDeltaSection;
}) {
  return (
    <div className="hazards-panel__section">
      <h4 className="hazards-panel__section-title">{label}</h4>
      {section.status !== 'computed' ? (
        <p className="hazards-panel__status hazards-panel__status--muted">
          {section.status === 'uncomputed' ? 'not computed' : 'unavailable'}: {section.reason}
        </p>
      ) : section.groups.length === 0 ? (
        <p className="hazards-panel__status hazards-panel__status--good">no change</p>
      ) : (
        <ul className="hazards-panel__list">
          {section.groups.map((group) => (
            <HazardGroupRow key={`${group.side}-${group.kind}`} group={group} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StructureSectionBlock({
  label,
  section,
}: {
  label: string;
  section: StructureDeltaSection;
}) {
  return (
    <div className="hazards-panel__section">
      <h4 className="hazards-panel__section-title">{label}</h4>
      {section.status !== 'computed' ? (
        <p className="hazards-panel__status hazards-panel__status--muted">
          {section.status === 'uncomputed' ? 'not computed' : 'unavailable'}: {section.reason}
        </p>
      ) : section.groups.length === 0 ? (
        <p className="hazards-panel__status hazards-panel__status--good">no change</p>
      ) : (
        <ul className="hazards-panel__list">
          {section.groups.map((group) => (
            <StructureGroupRow key={`${group.side}-${group.kind}`} group={group} />
          ))}
        </ul>
      )}
    </div>
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

function StructureGroupRow({ group }: { group: StructureDeltaGroup }) {
  return (
    <li className={`hazards-panel__item hazards-panel__item--${group.side}`}>
      <span className="hazards-panel__kind">
        {sideLabel(group.side)} {structureKindLabel(group.kind)}
      </span>
      <span className="hazards-panel__squares">{group.squares.join(', ')}</span>
    </li>
  );
}
