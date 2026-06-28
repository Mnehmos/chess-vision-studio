// EngineDisagreementCard — Stockfish vs CVS on the SAME root position at the SAME
// budget (plan §6 PR-03). It answers "do the engines agree on the best move here?"
// — NOT "was the played move good?" (that's MoveReviewCard). Renders only the
// engines that computed for the matching root; mismatched/late results fail closed.
// This is engine disagreement, NOT a benchmark — do not read it as Elo/strength.
import type { NormalizedEngineScore } from '../engine/analysis-frame';
import {
  budgetLabel,
  type EngineDisagreementView,
  type EngineSlot,
} from './engine-disagreement';

export function EngineDisagreementCard({ view }: { view: EngineDisagreementView }) {
  const { stockfish, cvs, comparison } = view;
  return (
    <section className="engine-disagreement">
      <div className="engine-disagreement__header">
        <h2 className="engine-disagreement__title">Engine Disagreement</h2>
        <span className="engine-disagreement__tag">equal {budgetLabel(view.budget)}</span>
      </div>
      <p className="engine-disagreement__root" title={view.rootFen}>
        root {shortFen(view.rootFen)}
      </p>

      {comparison && (
        <p className="engine-disagreement__verdict">
          {comparison.bestMovesAgree ? 'engines agree' : 'engines disagree'}
          {comparison.comparable && comparison.whiteCpDiff !== null
            ? ` · Δ ${formatCp(comparison.whiteCpDiff)} (W)`
            : comparison.bestMovesAgree
              ? ''
              : ' · scores not directly comparable'}
        </p>
      )}

      <div className="engine-disagreement__grid">
        <EngineColumn label="Stockfish" slot={stockfish} />
        <EngineColumn label="CVS" slot={cvs} />
      </div>
    </section>
  );
}

function EngineColumn({ label, slot }: { label: string; slot: EngineSlot }) {
  return (
    <div className="engine-disagreement__column">
      <p className="engine-disagreement__label">{label}</p>
      {slot.status === 'idle' ? (
        <p className="engine-disagreement__value">—</p>
      ) : slot.status === 'pending' ? (
        <p className="engine-disagreement__value">analyzing…</p>
      ) : slot.status === 'unavailable' ? (
        <p className="engine-disagreement__value engine-disagreement__value--muted">
          unavailable: {slot.reason}
        </p>
      ) : (
        <>
          <p className="engine-disagreement__value">
            best {slot.result.bestMoveUci ?? 'none'} · {formatWhite(slot.result.score)}
          </p>
          <p className="engine-disagreement__value engine-disagreement__value--small">
            {provenanceLine(slot)}
          </p>
          <p className="engine-disagreement__value engine-disagreement__value--muted">
            {slot.result.pvUci.slice(0, 6).join(' ') || 'no pv'}
          </p>
        </>
      )}
    </div>
  );
}

function provenanceLine(slot: Extract<EngineSlot, { status: 'computed' }>): string {
  const r = slot.result;
  const parts: string[] = [];
  if (typeof r.depth === 'number') parts.push(`d${r.depth}`);
  if (typeof r.timeMs === 'number') parts.push(`${r.timeMs}ms`);
  if (typeof r.nodes === 'number') parts.push(`${formatNodes(r.nodes)} nodes`);
  return parts.join(' · ') || r.engine;
}

function formatWhite(score: NormalizedEngineScore): string {
  if (score.whiteMate !== null) return `M${score.whiteMate} (W)`;
  if (score.whiteCp !== null) return `${formatCp(score.whiteCp)} (W)`;
  return 'terminal';
}

function shortFen(fen: string): string {
  return fen.split(/\s+/).slice(0, 2).join(' ');
}

function formatCp(cp: number): string {
  const pawns = cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

function formatNodes(nodes: number): string {
  if (nodes >= 1_000_000) return `${(nodes / 1_000_000).toFixed(1)}M`;
  if (nodes >= 1_000) return `${(nodes / 1_000).toFixed(1)}k`;
  return String(nodes);
}
