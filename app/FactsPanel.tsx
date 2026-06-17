// Facts panel - a relationship card for the inspected square plus this ply's
// move analysis. The loop: click square -> arrows show relationships -> this card
// explains in words -> LED preview mirrors it. A visual debugger for positions.
import { squareReport, type SquareStatus } from '../engine/relationship';
import type { InsightCandidate, MoveAnalysis, Square } from '../engine/types';
import type { FactValue, PieceRef, PositionFacts, SeeLosingFact } from '../engine/teaching/types';

type RowTone = 'danger' | 'good' | 'warning' | 'muted';

export function FactsPanel({
  fen,
  selected,
  analysis,
  move,
  focused,
  onFocus,
  enginePosition,
}: {
  fen: string;
  selected?: Square;
  analysis?: MoveAnalysis;
  move?: string;
  focused?: InsightCandidate | null;
  onFocus?: (ins: InsightCandidate) => void;
  // The Rust position facts matching the board, when available - the source of
  // truth for the inspected piece's attackers/defenders/SEE.
  enginePosition?: PositionFacts | null;
}) {
  const report = selected ? squareReport(fen, selected) : undefined;
  // Prefer engine-surfaced facts for the inspected piece; fall back to the legacy
  // chess.js report for empty squares or positions without a fact bundle.
  const enginePiece =
    selected && enginePosition
      ? enginePosition.pieces.find((piece) => piece.square === selected)
      : undefined;
  // Reject a stale artifact: only render an analysis that was computed for the board
  // currently shown (positionAfter === fen). Prevents a prior move's insights from
  // bleeding onto a different position (state-contamination guard).
  const liveAnalysis = analysis && analysis.positionAfter === fen ? analysis : undefined;
  // "What tactic depends on this square?" - insights whose squares include it.
  const dependentTactics =
    selected && liveAnalysis
      ? liveAnalysis.rankedInsights.filter((i) => i.squares.includes(selected))
      : [];

  return (
    <div className="facts-panel">
      <div className="facts-panel__header">
        <h3 className="facts-panel__title">Square facts</h3>
        <span className="facts-panel__hint">click any square</span>
      </div>

      {move && (
        <div className="facts-panel__move">
          <strong>{move}</strong>
          {liveAnalysis && (
            <span className={classificationClass(liveAnalysis.classification)}>
              {liveAnalysis.classification}
              {liveAnalysis.classification !== 'unclassified' &&
                ` -${liveAnalysis.cpLoss.toFixed(2)}`}
            </span>
          )}
        </div>
      )}
      {liveAnalysis && <div className="facts-panel__explanation">{liveAnalysis.topExplanation}</div>}

      {enginePiece ? (
        <div className="facts-panel__card facts-panel__card--piece">
          <div className="facts-panel__card-title">
            {enginePiece.square} - {enginePiece.side} {enginePiece.pieceType}{' '}
            <span className="facts-panel__source-pill">engine</span>
          </div>
          <Row label="Attacked by" items={enginePiece.attackers.map(pieceRefLabel)} tone="danger" />
          <Row label="Defended by" items={enginePiece.defenders.map(pieceRefLabel)} tone="good" />
          <div>
            <span className="facts-panel__label">SEE:</span> {seeText(enginePiece.see)}
          </div>
          {enginePiece.onlyDefenderOf.length > 0 && (
            <Row
              label="Only defender of"
              items={enginePiece.onlyDefenderOf.map(pieceRefLabel)}
              tone="warning"
            />
          )}
          <StatusLine status={engineStatus(enginePiece)} />
          <DependentTactics insights={dependentTactics} onFocus={onFocus} />
        </div>
      ) : report && report.occupied ? (
        <div className="facts-panel__card facts-panel__card--piece">
          <div className="facts-panel__card-title">
            {report.square} - {report.color} {report.pieceName?.toLowerCase()}
          </div>
          <Row label="Attacked by" items={report.attackedBy.map((a) => a.label)} tone="danger" />
          <Row label="Defended by" items={report.defendedBy.map((d) => d.label)} tone="good" />
          <div>
            <span className="facts-panel__label">SEE:</span>{' '}
            {report.safe ? 'safe' : `losing ${report.see}`}
          </div>
          <StatusLine status={{ label: report.statusLabel, className: legacyStatusClass(report.status) }} />
          <DependentTactics insights={dependentTactics} onFocus={onFocus} />
        </div>
      ) : report ? (
        <div className="facts-panel__card facts-panel__card--empty">
          <div className="facts-panel__card-title">{report.square} - empty square</div>
          <Row
            label="Can move here"
            items={(report.canMoveHere ?? []).map((m) => m.label)}
            tone="good"
          />
          <Row
            label="White controls"
            items={(report.controlledByWhite ?? []).map((m) => m.label)}
            tone="muted"
          />
          <Row
            label="Black controls"
            items={(report.controlledByBlack ?? []).map((m) => m.label)}
            tone="muted"
          />
          <DependentTactics insights={dependentTactics} onFocus={onFocus} />
        </div>
      ) : (
        <div className="facts-panel__empty">Click a square to inspect.</div>
      )}

      {liveAnalysis && liveAnalysis.rankedInsights.length > 0 && (
        <div className="facts-panel__insights">
          <h4 className="facts-panel__insights-title">
            Ranked insights{' '}
            {focused && (
              <button className="facts-panel__unfocus" onClick={() => onFocus?.(focused)}>
                unfocus
              </button>
            )}
          </h4>
          <ol className="facts-panel__insight-list">
            {liveAnalysis.rankedInsights.slice(0, 6).map((ins) => {
              const isFocused = focused === ins;
              return (
                <li key={ins.id} className="facts-panel__insight-item">
                  <span
                    className={`facts-panel__insight-button${isFocused ? ' is-focused' : ''}`}
                    onClick={() => onFocus?.(ins)}
                    title="focus the board on this insight"
                  >
                    <span className="facts-panel__saliency">[{ins.saliency.toFixed(2)}]</span>{' '}
                    {insightLabel(ins)}
                    {ins.squares.length ? ` on ${ins.squares.join(', ')}` : ''}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

function Row({ label, items, tone }: { label: string; items: string[]; tone: RowTone }) {
  return (
    <div className="facts-panel__row">
      <span className="facts-panel__label">{label}:</span>{' '}
      {items.length ? (
        items.map((it, i) => (
          <span key={it}>
            <span className={`facts-panel__row-item facts-panel__row-item--${tone}`}>{it}</span>
            {i < items.length - 1 ? ', ' : ''}
          </span>
        ))
      ) : (
        <span className="facts-panel__none">none</span>
      )}
    </div>
  );
}

function StatusLine({ status }: { status: { label: string; className: string } }) {
  return (
    <div className="facts-panel__relation">
      <span className="facts-panel__label">Status:</span>{' '}
      <span className={`facts-panel__status ${status.className}`}>{status.label}</span>
    </div>
  );
}

function DependentTactics({
  insights,
  onFocus,
}: {
  insights: InsightCandidate[];
  onFocus?: (ins: InsightCandidate) => void;
}) {
  if (insights.length === 0) return null;
  return (
    <div className="facts-panel__relation">
      <span className="facts-panel__label">Part of:</span>{' '}
      {insights.map((ins, i) => (
        <span key={ins.id}>
          <span className="facts-panel__relation-link" onClick={() => onFocus?.(ins)}>
            {insightLabel(ins)}
          </span>
          {i < insights.length - 1 ? ', ' : ''}
        </span>
      ))}
    </div>
  );
}

function classificationClass(classification: string): string {
  const allowed = new Set(['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']);
  const tone = allowed.has(classification) ? classification : 'default';
  return `facts-panel__classification facts-panel__classification--${tone}`;
}

function legacyStatusClass(status: SquareStatus): string {
  switch (status) {
    case 'hanging':
      return 'facts-panel__status--hanging';
    case 'defended_target':
      return 'facts-panel__status--attacked';
    case 'loose':
      return 'facts-panel__status--loose';
    case 'defended':
      return 'facts-panel__status--safe';
    case 'undefended':
      return 'facts-panel__status--muted';
    case 'empty':
    default:
      return 'facts-panel__status--muted';
  }
}

// Plain-language phrase per insight type so the card reads like a coach, not a
// schema dump ("now defended", "best reply wins material", not "pv_refutation").
const CHANGE_PHRASE: Record<string, string> = {
  piece_captured: 'wins material',
  now_undefended: 'left undefended',
  now_attacked: 'comes under attack',
  now_defended: 'now defended',
  now_see_losing: 'now loses material',
  defender_left: 'a defender moved away',
  line_opened: 'opens a line',
  line_closed: 'closes a line',
  check_created: 'gives check',
  mate_threat: 'threatens mate',
  pv_refutation: 'the punishing reply',
  perpetual_check: 'perpetual check (draw)',
  forcing_check_resource: 'a forcing check',
  development_improved: 'develops a piece',
  center_control_gained: 'gains the center',
  mobility_improved: 'frees the pieces',
  defense_improved: 'shores up the defense',
  king_safety_improved: 'improves king safety',
  king_safety_weakened: 'weakens the king',
  pawn_structure_weakened: 'weakens the pawns',
  escape_squares_changed: "changes the king's escape squares",
  repetition_conversion_warning: 'repeats a winning position (draw risk)',
};

const MOTIF_PHRASE: Record<string, string> = {
  fork: 'a fork',
  pin_absolute: 'a pin to the king',
  pin_relative: 'a pin',
  skewer: 'a skewer',
  discovered_attack: 'a discovered attack',
  discovered_check: 'a discovered check',
  back_rank: 'a back-rank mate',
  removal_of_guard: 'removal of the guard',
  mating_net: 'a mating net',
  overload: 'an overload',
  deflection: 'a deflection',
  decoy: 'a decoy',
  interference: 'interference',
  zwischenzug: 'an in-between move',
  trapped_piece: 'a trapped piece',
  x_ray: 'an x-ray',
};

const PIECE_WORD: Record<string, string> = {
  p: 'a pawn',
  n: 'a knight',
  b: 'a bishop',
  r: 'a rook',
  q: 'the queen',
  k: 'the king',
};

// Frame an insight by its source so an opponent's-reply or missed-chance fact never
// reads as a property of the selected piece, in plain language.
function insightLabel(ins: InsightCandidate): string {
  const who = ins.side === 'white' ? 'White' : 'Black';
  let phrase: string;
  if (ins.kind === 'motif') {
    phrase = MOTIF_PHRASE[ins.type] ?? ins.type.replace(/_/g, ' ');
  } else if (ins.type === 'piece_captured' && ins.victim) {
    phrase = `wins ${PIECE_WORD[ins.victim] ?? 'material'}`;
  } else {
    phrase = CHANGE_PHRASE[ins.type] ?? ins.type.replace(/_/g, ' ');
  }
  if (ins.source === 'refutation') return `${who}'s reply - ${phrase}`;
  if (ins.source === 'available') return `missed - ${phrase}`;
  return phrase;
}

function pieceRefLabel(ref: PieceRef): string {
  return `${ref.pieceType} ${ref.square}`;
}

function seeText(see: FactValue<SeeLosingFact>): string {
  if (see.status !== 'computed') return '-';
  if (!see.value.losing) return 'safe';
  const cp = see.value.scoreCp;
  return typeof cp === 'number' ? `losing ${(cp / 100).toFixed(1)}` : 'losing material';
}

function engineStatus(piece: {
  see: FactValue<SeeLosingFact>;
  attacked: boolean;
  loose: boolean;
}): { label: string; className: string } {
  if (piece.see.status === 'computed' && piece.see.value.losing) {
    return { label: 'hanging', className: 'facts-panel__status--hanging' };
  }
  if (piece.attacked) return { label: 'attacked', className: 'facts-panel__status--attacked' };
  if (piece.loose) return { label: 'undefended', className: 'facts-panel__status--loose' };
  return { label: 'safe', className: 'facts-panel__status--safe' };
}
