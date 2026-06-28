// NnueInspectorPanel — developer-only before/after evaluator + feature inspector
// (plan §6 PR-12). Disabled by default (render only when `enabled`). It shows
// activated/deactivated CVS-NNUE input features and the classical/NNUE evals; it
// makes NO causal claim (a feature is a model input, never "this feature caused
// N cp"). A registry/model mismatch blocks the direct feature diff.
import type { CvsFeatureInspectionV1 } from '../engine/analysis-frame';
import { diffFeatureInspections, nnueEvalComparison } from '../engine/feature-diff';

export function NnueInspectorPanel({
  enabled,
  before,
  after,
}: {
  enabled: boolean;
  before: CvsFeatureInspectionV1 | null;
  after: CvsFeatureInspectionV1 | null;
}) {
  if (!enabled) return null;
  if (!before || !after) {
    return (
      <section className="nnue-inspector">
        <h3 className="nnue-inspector__title">NNUE / feature inspector (dev)</h3>
        <p className="nnue-inspector__muted">Select a before/after position to inspect.</p>
      </section>
    );
  }

  const diff = diffFeatureInspections(before, after);
  const nnue = nnueEvalComparison(before, after);

  return (
    <section className="nnue-inspector">
      <h3 className="nnue-inspector__title">NNUE / feature inspector (dev)</h3>

      <div className="nnue-inspector__row">
        <span>classical (W):</span>
        <span>
          {before.classicalWhiteCp} → {after.classicalWhiteCp}
        </span>
      </div>
      <div className="nnue-inspector__row">
        <span>NNUE (W):</span>
        <span>
          {nnue.status === 'unavailable'
            ? 'unavailable (no --nnue)'
            : `${nnue.beforeWhiteCp} → ${nnue.afterWhiteCp} (Δ ${nnue.deltaWhiteCp})`}
        </span>
      </div>
      <div className="nnue-inspector__row">
        <span>registry:</span>
        <span>
          v{after.registryVersion} · {after.registryHash} · dim {after.inputDim}
        </span>
      </div>

      {diff.status === 'registry_mismatch' ? (
        <p className="nnue-inspector__warn">
          Registry/model differs between positions — feature diff blocked. {diff.reason}
        </p>
      ) : (
        <div className="nnue-inspector__features">
          <FeatureList title={`Activated (${diff.activated.length})`} refs={diff.activated} />
          <FeatureList title={`Deactivated (${diff.deactivated.length})`} refs={diff.deactivated} />
        </div>
      )}
      <p className="nnue-inspector__muted">
        Active features are model inputs, not causal explanations of the evaluation.
      </p>
    </section>
  );
}

function FeatureList({
  title,
  refs,
}: {
  title: string;
  refs: { id: number; name: string }[];
}) {
  return (
    <div className="nnue-inspector__feature-col">
      <h4 className="nnue-inspector__feature-title">{title}</h4>
      <ul className="nnue-inspector__feature-list">
        {refs.map((r) => (
          <li key={r.id}>
            <span className="nnue-inspector__feature-id">#{r.id}</span> {r.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
