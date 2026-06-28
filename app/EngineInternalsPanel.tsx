// EngineInternalsPanel — the full CVS search telemetry, collapsed by default
// (plan §6 PR-11). Analyze-only by default; raw counters plus pure derived
// metrics. No metric is framed as a strength claim. Default layout is unchanged
// while collapsed.
import type { ReactNode } from 'react';
import type { CvsSearchTelemetryV2 } from '../engine/analysis-frame';
import { deriveTelemetryMetrics, populatedBranchingPlies } from '../engine/search-telemetry';

export function EngineInternalsPanel({ telemetry }: { telemetry: CvsSearchTelemetryV2 | null }) {
  if (!telemetry) return null;
  const d = deriveTelemetryMetrics(telemetry);
  const plies = populatedBranchingPlies(telemetry);
  return (
    <details className="engine-internals">
      <summary className="engine-internals__summary">Engine internals (CVS search telemetry)</summary>

      <Section title="Search summary">
        <Stat label="nodes" value={telemetry.nodes} />
        <Stat label="main / q nodes" value={`${telemetry.mainNodes} / ${telemetry.qNodes}`} />
        <Stat label="q-node share" value={pct(d.qNodeShare)} />
        <Stat label="max q depth" value={telemetry.maxQDepth} />
        <Stat label="time" value={`${telemetry.timeMs}ms`} />
      </Section>

      <Section title="Transposition table">
        <Stat label="probes" value={telemetry.ttProbes} />
        <Stat label="hit rate" value={pct(d.ttHitRate)} />
        <Stat label="cutoff rate" value={pct(d.ttCutoffRate)} />
        <Stat label="entries" value={telemetry.ttEntries} />
        <Stat label="cold / contended miss" value={`${telemetry.ttMissCold} / ${telemetry.ttMissContended}`} />
      </Section>

      <Section title="Move ordering">
        <Stat label="cutoffs" value={telemetry.cutoffs} />
        <Stat label="first-move cutoff" value={pct(d.firstMoveCutoffRate)} />
        <Stat label="hash-move cutoff" value={pct(d.hashMoveCutoffRate)} />
        <Stat label="killer / history cutoffs" value={`${telemetry.killerCutoffs} / ${telemetry.historyCutoffs}`} />
        <Stat label="avg cutoff index" value={d.avgCutoffMoveIndex.toFixed(2)} />
        <Stat label="avg legal moves" value={d.avgLegalMoves.toFixed(2)} />
      </Section>

      <Section title="Pruning">
        <Stat label="pruned share" value={pct(d.prunedShare)} />
        <Stat label="null cutoff" value={pct(d.nullCutoffRate)} />
        <Stat label="rfp / futility skips" value={`${telemetry.rfpCutoffs} / ${telemetry.futilitySkips}`} />
        <Stat label="lmp / see / delta skips" value={`${telemetry.lmpSkips} / ${telemetry.seePruneSkips} / ${telemetry.deltaSkips}`} />
        <Stat label="lmr re-search" value={pct(d.lmrResearchRate)} />
        <Stat label="pvs / aspiration re-search" value={`${telemetry.pvsResearches} / ${telemetry.aspirationResearches}`} />
      </Section>

      <Section title="Specialist lanes">
        <Stat label="danger extension plies" value={telemetry.dangerExtensionPlies} />
        <Stat label="foreign hints" value={telemetry.foreignHints.join(', ') || '—'} />
        <Stat label="foreign cutoffs" value={`${d.foreignCutoffTotal} (${telemetry.foreignCutoffs.join(', ')})`} />
      </Section>

      <Section title="Per-ply branching">
        {plies.length === 0 ? (
          <div className="engine-internals__stat">no per-ply data</div>
        ) : (
          plies.map((row) => (
            <Stat
              key={row.ply}
              label={`ply ${row.ply}`}
              value={`${row.nodes} nodes · ${row.childSearches} children · b≈${row.effectiveBranching.toFixed(2)}`}
            />
          ))
        )}
      </Section>
    </details>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="engine-internals__section">
      <h4 className="engine-internals__section-title">{title}</h4>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="engine-internals__stat">
      <span className="engine-internals__stat-label">{label}</span>
      <span className="engine-internals__stat-value">{value}</span>
    </div>
  );
}

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
