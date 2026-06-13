// Facts panel — a "relationship card" for the inspected square plus this ply's
// move analysis. The loop: click square → arrows show relationships → this card
// explains in words → LED preview mirrors it. A visual debugger for positions.
import { squareReport, type SquareStatus } from '../engine/relationship';
import type { InsightCandidate, MoveAnalysis, Square } from '../engine/types';
import type { FactValue, PieceRef, PositionFacts, SeeLosingFact } from '../engine/teaching/types';

const STATUS_COLOR: Record<SquareStatus, string> = {
  empty: '#9aa',
  hanging: '#e23b3b', // red — losing material
  defended_target: '#8a6d3b', // contested but holds
  loose: '#e8b33b', // yellow — loose / tactically relevant
  defended: '#3f813f', // green — safe & protected
  undefended: 'var(--muted)',
};

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
  // The Rust position facts matching the board, when available — the source of
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
  // "What tactic depends on this square?" — insights whose squares include it.
  const dependentTactics =
    selected && liveAnalysis
      ? liveAnalysis.rankedInsights.filter((i) => i.squares.includes(selected))
      : [];

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, minWidth: 0, fontSize: 14, lineHeight: 1.55 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>Square facts</h3>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>click any square</span>
      </div>

      {move && (
        <div style={{ marginBottom: 8 }}>
          <strong>{move}</strong>
          {liveAnalysis && (
            <span
              style={{
                marginLeft: 8,
                padding: '1px 6px',
                borderRadius: 4,
                background: classColor(liveAnalysis.classification),
                color: '#fff',
                fontSize: 12,
              }}
            >
              {liveAnalysis.classification}
              {liveAnalysis.classification !== 'unclassified' && ` · −${liveAnalysis.cpLoss.toFixed(2)}`}
            </span>
          )}
        </div>
      )}
      {liveAnalysis && (
        <div style={{ marginBottom: 12, padding: 8, background: 'var(--track)', borderRadius: 6 }}>
          {liveAnalysis.topExplanation}
        </div>
      )}

      {/* The relationship card — engine facts are the source of truth for a piece */}
      {enginePiece ? (
        <div
          style={{
            border: '2px solid #2563c9',
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {enginePiece.square} — {enginePiece.side} {enginePiece.pieceType}{' '}
            <span
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 10,
                color: 'var(--muted)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '0 4px',
              }}
            >
              engine
            </span>
          </div>
          <Row
            label="Attacked by"
            items={enginePiece.attackers.map(pieceRefLabel)}
            color="#c53030"
          />
          <Row
            label="Defended by"
            items={enginePiece.defenders.map(pieceRefLabel)}
            color="var(--good)"
          />
          <div>
            <span style={{ color: 'var(--muted)' }}>SEE:</span> {seeText(enginePiece.see)}
          </div>
          {enginePiece.onlyDefenderOf.length > 0 && (
            <Row
              label="Only defender of"
              items={enginePiece.onlyDefenderOf.map(pieceRefLabel)}
              color="#b45309"
            />
          )}
          <div style={{ marginTop: 6 }}>
            <span style={{ color: 'var(--muted)' }}>Status:</span>{' '}
            {(() => {
              const s = engineStatus(enginePiece);
              return (
                <span
                  style={{
                    padding: '1px 8px',
                    borderRadius: 10,
                    background: s.color,
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {s.label}
                </span>
              );
            })()}
          </div>
          {dependentTactics.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <span style={{ color: 'var(--muted)' }}>Part of:</span>{' '}
              {dependentTactics.map((ins, i) => (
                <span key={ins.id}>
                  <span
                    onClick={() => onFocus?.(ins)}
                    style={{ color: '#b45309', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {insightLabel(ins)}
                  </span>
                  {i < dependentTactics.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : report && report.occupied ? (
        <div
          style={{
            border: '2px solid #2563c9', // blue outline = inspected piece
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {report.square} — {report.color} {report.pieceName?.toLowerCase()}
          </div>
          <Row label="Attacked by" items={report.attackedBy.map((a) => a.label)} color="#c53030" />
          <Row label="Defended by" items={report.defendedBy.map((d) => d.label)} color="var(--good)" />
          <div>
            <span style={{ color: 'var(--muted)' }}>SEE:</span>{' '}
            {report.safe ? 'safe' : `losing ${report.see}`}
          </div>
          <div style={{ marginTop: 6 }}>
            <span style={{ color: 'var(--muted)' }}>Status:</span>{' '}
            <span
              style={{
                padding: '1px 8px',
                borderRadius: 10,
                background: STATUS_COLOR[report.status],
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {report.statusLabel}
            </span>
          </div>
          {dependentTactics.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <span style={{ color: 'var(--muted)' }}>Part of:</span>{' '}
              {dependentTactics.map((ins, i) => (
                <span key={ins.id}>
                  <span
                    onClick={() => onFocus?.(ins)}
                    style={{ color: '#b45309', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {insightLabel(ins)}
                  </span>
                  {i < dependentTactics.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : report ? (
        <div
          style={{
            border: '2px solid #cbd5e1', // grey outline = inspected empty square
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{report.square} — empty square</div>
          <Row
            label="Can move here"
            items={(report.canMoveHere ?? []).map((m) => m.label)}
            color="var(--good)"
          />
          <Row
            label="White controls"
            items={(report.controlledByWhite ?? []).map((m) => m.label)}
            color="var(--muted)"
          />
          <Row
            label="Black controls"
            items={(report.controlledByBlack ?? []).map((m) => m.label)}
            color="var(--muted)"
          />
          {dependentTactics.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <span style={{ color: 'var(--muted)' }}>Part of:</span>{' '}
              {dependentTactics.map((ins, i) => (
                <span key={ins.id}>
                  <span
                    onClick={() => onFocus?.(ins)}
                    style={{ color: '#b45309', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {insightLabel(ins)}
                  </span>
                  {i < dependentTactics.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ color: 'var(--muted)', marginBottom: 12 }}>Click a square to inspect.</div>
      )}

      {liveAnalysis && liveAnalysis.rankedInsights.length > 0 && (
        <div>
          <h4 style={{ margin: '0 0 4px' }}>
            Ranked insights{' '}
            {focused && (
              <button onClick={() => onFocus?.(focused)} style={{ fontSize: 11, marginLeft: 6 }}>
                unfocus
              </button>
            )}
          </h4>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {liveAnalysis.rankedInsights.slice(0, 6).map((ins) => {
              const isFocused = focused === ins;
              return (
                <li key={ins.id} style={{ marginBottom: 2 }}>
                  <span
                    onClick={() => onFocus?.(ins)}
                    title="focus the board on this insight"
                    style={{
                      cursor: 'pointer',
                      padding: '0 4px',
                      borderRadius: 4,
                      background: isFocused ? '#fde68a' : 'transparent',
                      fontWeight: isFocused ? 700 : 400,
                    }}
                  >
                    <span style={{ color: 'var(--muted)' }}>[{ins.saliency.toFixed(2)}]</span>{' '}
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

function Row({ label, items, color }: { label: string; items: string[]; color: string }) {
  return (
    <div>
      <span style={{ color: 'var(--muted)' }}>{label}:</span>{' '}
      {items.length ? (
        items.map((it, i) => (
          <span key={it}>
            <span style={{ color }}>{it}</span>
            {i < items.length - 1 ? ', ' : ''}
          </span>
        ))
      ) : (
        <span style={{ color: 'var(--muted)' }}>none</span>
      )}
    </div>
  );
}

// Plain-language phrase per insight type — so the card reads like a coach, not a
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
  escape_squares_changed: 'changes the king’s escape squares',
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
  if (ins.source === 'refutation') return `${who}’s reply — ${phrase}`;
  if (ins.source === 'available') return `missed — ${phrase}`;
  return phrase;
}

function classColor(c: string): string {
  switch (c) {
    case 'best':
    case 'excellent':
      return '#3fbf5f';
    case 'good':
      return 'var(--accent-light)';
    case 'inaccuracy':
      return '#e8923b';
    case 'mistake':
      return '#e2603b';
    case 'blunder':
      return '#e23b3b';
    default:
      return 'var(--muted)';
  }
}

function pieceRefLabel(ref: PieceRef): string {
  return `${ref.pieceType} ${ref.square}`;
}

function seeText(see: FactValue<SeeLosingFact>): string {
  if (see.status !== 'computed') return '—';
  if (!see.value.losing) return 'safe';
  const cp = see.value.scoreCp;
  return typeof cp === 'number' ? `losing ${(cp / 100).toFixed(1)}` : 'losing material';
}

function engineStatus(piece: {
  see: FactValue<SeeLosingFact>;
  attacked: boolean;
  loose: boolean;
}): { label: string; color: string } {
  if (piece.see.status === 'computed' && piece.see.value.losing) {
    return { label: 'hanging', color: '#e23b3b' };
  }
  if (piece.attacked) return { label: 'attacked', color: '#8a6d3b' };
  if (piece.loose) return { label: 'undefended', color: '#e8b33b' };
  return { label: 'safe', color: '#3f813f' };
}
