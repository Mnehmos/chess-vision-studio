import type { CSSProperties } from 'react';
import type { TeachingAnalysis, TeachingEvent, TeachingFactBundleV1 } from '../engine/teaching/types';
import type { MoveIdea } from '../engine/teaching/moveIdea';
import type { DetectedOpening } from '../engine/teaching/openings';
import type { MoveAnalysis } from '../engine/types';
import { TeachingMoveBody, OpeningCard } from './TeachingPanel';

// The running teaching log — ONE component for every surface (play vs an engine,
// off-mode review, and Analyze). Each move appends a turn rendered by the shared
// TeachingMoveBody (the same card the analyze panel uses); the current opening sits
// as a header card; newest move at the bottom, bounded to a sliding window.

const COACH_WINDOW = 8; // keep only the last N plies of the log in view

const card: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
};

// One move in the running log — yours and the coach's, each keeping its own teaching.
export interface CoachTurn {
  ply: number; // 0-based half-move index
  who: 'you' | 'coach';
  side: 'w' | 'b'; // the mover — for White/Black labels in review
  san: string;
  classification?: string;
  cpLoss?: number;
  betterMove?: string; // engine's preferred move (SAN), shown when this move is a mistake
  teaching: TeachingAnalysis | null;
  idea: MoveIdea | null; // what the move accomplishes (fork/pin/winning capture)
  summary: string; // the move's top ranked-insight ("Gains the center on d5")
  evalText: string; // position eval after the move, ALWAYS White's perspective ("+1.2")
  evalCp: number | null; // same, in centipawns (±10000 for mate) — drives the eval bar
  hazardNote?: string; // "leaves the X on Y hanging" — surfaced from the raw facts
  opening: DetectedOpening | null;
  status: 'analyzing' | 'done';
}

// Format a short list of pieces straight from fact refs: "the knight on d6",
// "the bishop on g3 and knight on f3".
function namePieces(refs: { pieceType: string; square: string }[]): string {
  const names = refs.map((r) => `${r.pieceType} on ${r.square}`);
  if (names.length <= 1) return names[0] ? `the ${names[0]}` : '';
  return `the ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// Surface a hanging piece the move left behind, straight from the facts (the same
// SEE-losing data the Square Facts panel shows): name the piece, how much it costs,
// and who attacks it. Skipped when the compiler already committed a hanging/defense
// topic, so it's a pure fallback for the gap where a move leaves material hanging
// but matched no named pattern.
export function hangingNote(facts: TeachingFactBundleV1, teaching: TeachingAnalysis | null): string | undefined {
  if (
    teaching?.computed &&
    teaching.events.some((e) => e.topicId === 'failed_defense' || e.topicId === 'missed_hanging_piece')
  ) {
    return undefined;
  }
  const mover = facts.before.sideToMove;
  const hung = facts.played.position.pieces.find(
    (p) => p.side === mover && p.pieceType !== 'king' && p.see.status === 'computed' && p.see.value.losing,
  );
  if (!hung) return undefined;
  const loss = hung.see.status === 'computed' ? hung.see.value.scoreCp : undefined;
  const pawns = typeof loss === 'number' ? Math.round(Math.abs(loss) / 100) : 0;
  const amount = pawns > 0 ? ` (~${pawns} pawn${pawns === 1 ? '' : 's'})` : '';
  const by = hung.attackers.length ? ` — attacked by ${namePieces(hung.attackers)}` : '';
  return `Leaves the ${hung.pieceType} on ${hung.square} hanging${amount}${by}. The opponent can win it.`;
}

// Position eval after a move, normalized to White's perspective so the number doesn't
// flip sign every ply — makes "who's winning" legible across the log.
export function whiteEvalText(a: MoveAnalysis, mover: 'w' | 'b'): string {
  const e = a.evalAfter;
  const flip = mover === 'w' ? -1 : 1; // evalAfter is side-to-move (the opponent) → White
  if (typeof e.mate === 'number') {
    const m = e.mate * flip;
    return `#${m >= 0 ? '' : '-'}${Math.abs(m)}`;
  }
  const pawns = ((e.cp ?? 0) * flip) / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

// Same eval in centipawns (White's perspective); mate maps to a saturating ±10000 so
// the eval bar fills fully.
export function whiteEvalCp(a: MoveAnalysis, mover: 'w' | 'b'): number {
  const e = a.evalAfter;
  const flip = mover === 'w' ? -1 : 1;
  if (typeof e.mate === 'number') return e.mate * flip >= 0 ? 10000 : -10000;
  return (e.cp ?? 0) * flip;
}

export function TeachingLog({
  log,
  title,
  opening,
  bothSides,
  coachName,
  thinking,
  latestPly,
  focusedId,
  onShow,
  scrollRef,
  emptyHint,
  onPractice,
}: {
  log: CoachTurn[];
  title: string;
  opening: DetectedOpening | null;
  bothSides: boolean;
  coachName?: string;
  thinking?: boolean;
  latestPly: number;
  focusedId: string | null;
  onShow: (event: TeachingEvent | null) => void;
  scrollRef?: { current: HTMLDivElement | null };
  emptyHint?: string;
  onPractice?: (event: TeachingEvent) => void;
}) {
  const labelFor = (turn: CoachTurn) =>
    bothSides ? (turn.side === 'w' ? 'White' : 'Black') : turn.who === 'you' ? 'You' : coachName ?? 'Coach';
  const accentFor = (turn: CoachTurn) =>
    (bothSides ? turn.side === 'w' : turn.who === 'you') ? 'var(--accent)' : '#3182ce';
  return (
    <section data-testid="teaching-log" style={{ ...card, padding: 12 }}>
      <div
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 10,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {opening?.inBook && (
        <div style={{ marginBottom: 8 }}>
          <OpeningCard opening={opening} />
        </div>
      )}
      {log.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          {emptyHint ?? 'Make a move — every move is taught here, newest at the bottom.'}
        </div>
      ) : (
        <div
          ref={scrollRef}
          style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}
        >
          {log.length > COACH_WINDOW && (
            <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', paddingBottom: 2 }}>
              …{log.length - COACH_WINDOW} earlier {log.length - COACH_WINDOW === 1 ? 'move' : 'moves'} (full game in Moves)
            </div>
          )}
          {log.slice(-COACH_WINDOW).map((turn) => (
            <TeachingLogRow
              key={turn.ply}
              turn={turn}
              label={labelFor(turn)}
              accent={accentFor(turn)}
              canShow={turn.ply === latestPly}
              focusedId={focusedId}
              onShow={onShow}
              onPractice={onPractice}
            />
          ))}
          {thinking && coachName && (
            <div data-testid="coach-thinking" style={{ color: 'var(--accent)', fontSize: 12 }}>
              {coachName} is thinking…
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TeachingLogRow({
  turn,
  label,
  accent,
  canShow,
  focusedId,
  onShow,
  onPractice,
}: {
  turn: CoachTurn;
  label: string;
  accent: string;
  canShow: boolean;
  focusedId: string | null;
  onShow: (event: TeachingEvent | null) => void;
  onPractice?: (event: TeachingEvent) => void;
}) {
  const moveNo = Math.floor(turn.ply / 2) + 1;
  const marker = turn.ply % 2 === 0 ? `${moveNo}.` : `${moveNo}…`;
  const events = turn.teaching?.computed ? turn.teaching.events : [];
  return (
    <div
      data-testid="coach-turn"
      style={{ borderLeft: `3px solid ${accent}`, background: 'var(--card2)', borderRadius: 6, padding: '6px 9px' }}
    >
      <div style={{ fontSize: 12, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <strong style={{ color: 'var(--text)' }}>{label}</strong>
        <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-soft)' }}>
          {marker} {turn.san}
        </span>
        {turn.classification && <QualityBadge classification={turn.classification} cpLoss={turn.cpLoss ?? 0} />}
        {turn.evalCp !== null && (
          <span style={{ marginLeft: 'auto' }}>
            <EvalBar cp={turn.evalCp} text={turn.evalText} />
          </span>
        )}
      </div>
      {turn.status === 'analyzing' ? (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>analyzing…</div>
      ) : (
        <TeachingMoveBody
          events={events}
          idea={turn.idea}
          summary={turn.summary}
          opening={turn.opening}
          classification={turn.classification}
          betterMove={turn.betterMove}
          focusedId={focusedId}
          onShow={onShow}
          canShow={canShow}
          onPractice={canShow ? onPractice : undefined}
        />
      )}
      {turn.status !== 'analyzing' && turn.hazardNote && (
        <div data-testid="hazard-note" style={{ marginTop: 6, fontSize: 12, color: '#d43b3b' }}>
          ⚠ {turn.hazardNote}
        </div>
      )}
    </div>
  );
}

// The MOVE's own grade (distinct from the position eval) — Stockfish's classification
// plus the centipawn loss, e.g. "best · 0.00", "mistake · −2.10".
const QUALITY: Record<string, string> = {
  best: '#2f855a',
  excellent: '#2f855a',
  good: '#38a169',
  inaccuracy: '#b7791f',
  mistake: '#dd6b20',
  blunder: '#c53030',
};

function QualityBadge({ classification, cpLoss }: { classification: string; cpLoss: number }) {
  const color = QUALITY[classification] ?? 'var(--muted)';
  const loss = cpLoss > 0 ? `−${cpLoss.toFixed(2)}` : '0.00';
  return (
    <span
      title={`Move quality: ${classification} (lost ${cpLoss.toFixed(2)})`}
      style={{ fontSize: 10, color: '#fff', background: color, padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}
    >
      {classification} · {loss}
    </span>
  );
}

// A standard eval bar for the POSITION odds: White fills from the left in proportion
// to the win expectation (logistic of the centipawn score), with the signed eval.
function EvalBar({ cp, text }: { cp: number; text: string }) {
  const whiteFrac = Math.max(0.04, Math.min(0.96, 1 / (1 + Math.exp(-cp / 400))));
  return (
    <span title="Engine eval — position odds (White’s perspective)" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span
        style={{
          position: 'relative',
          width: 34,
          height: 9,
          borderRadius: 2,
          overflow: 'hidden',
          background: '#1a1a1a',
          border: '1px solid var(--border)',
          display: 'inline-block',
        }}
      >
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${whiteFrac * 100}%`, background: '#e8e8e8' }} />
      </span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-soft)', minWidth: 26, textAlign: 'right' }}>
        {text}
      </span>
    </span>
  );
}
