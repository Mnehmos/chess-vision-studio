import { useEffect, useRef } from 'react';
import type { TeachingFactBundleV1, TeachingAnalysis } from '../engine/teaching/types';
import type { MoveIdea } from '../engine/teaching/moveIdea';
import type { DetectedOpening } from '../engine/teaching/openings';
import type { MoveAnalysis } from '../engine/types';
import type { TeachingNode } from '../engine/teaching/node';
import { TeachingMoveBody, OpeningCard } from './TeachingPanel';

// The running teaching log — ONE component for every surface (play vs an engine,
// off-mode review, and Analyze). Each move appends a turn rendered by the shared
// TeachingMoveBody (the same card the analyze panel uses); the current opening sits
// as a header card; newest move at the bottom, bounded to a sliding window.

const COACH_WINDOW = 8; // keep only the last N plies of the log in view

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
  nodes?: TeachingNode[]; // Unified nodes list
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

// Surface a hanging piece the move left behind, straight from the facts: name the piece, how much it costs,
// and who attacks it.
export function hangingNote(facts: TeachingFactBundleV1, nodes: TeachingNode[]): string | undefined {
  if (
    nodes.some((n) => n.conceptCode === 'failed_defense' || n.conceptCode === 'missed_hanging_piece')
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
  onShow: (node: TeachingNode | null) => void;
  scrollRef?: { current: HTMLDivElement | null };
  emptyHint?: string;
  onPractice?: (node: TeachingNode) => void;
}) {
  const internalScrollRef = useRef<HTMLDivElement | null>(null);
  const setScrollElement = (node: HTMLDivElement | null) => {
    internalScrollRef.current = node;
    if (scrollRef) scrollRef.current = node;
  };

  // Keep the newest row pinned to the bottom. The teaching cards render a summary
  // first and grow taller once the on-demand facts arrive, so a one-shot scroll
  // would leave the latest move below the fold. A MutationObserver re-pins on every
  // content change, and the effect re-runs on each new move (and when the list
  // first mounts at view 0). `overflow-anchor: none` on the list (CSS) stops the
  // browser's scroll-anchoring from fighting the pin as the bottom card grows.
  useEffect(() => {
    const node = scrollRef?.current ?? internalScrollRef.current;
    if (!node) return;
    const pin = () => {
      node.scrollTop = node.scrollHeight;
    };
    pin();
    const observer = new MutationObserver(pin);
    observer.observe(node, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [scrollRef, log.length, latestPly, thinking, focusedId]);

  const labelFor = (turn: CoachTurn) =>
    bothSides ? (turn.side === 'w' ? 'White' : 'Black') : turn.who === 'you' ? 'You' : coachName ?? 'Coach';
  const accentFor = (turn: CoachTurn) =>
    (bothSides ? turn.side === 'w' : turn.who === 'you') ? 'var(--accent)' : '#3182ce';
  return (
    <section data-testid="teaching-log" className="teaching-log">
      <div className="teaching-log__kicker">{title}</div>
      {opening?.inBook && (
        <div className="teaching-log__opening">
          <OpeningCard opening={opening} />
        </div>
      )}
      {log.length === 0 ? (
        <div className="teaching-log__empty">
          {emptyHint ?? 'Make a move — every move is taught here, newest at the bottom.'}
        </div>
      ) : (
        <div ref={setScrollElement} className="teaching-log__list">
          {log.length > COACH_WINDOW && (
            <div className="teaching-log__earlier">
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
            <div data-testid="coach-thinking" className="teaching-log__thinking">
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
  onShow: (node: TeachingNode | null) => void;
  onPractice?: (node: TeachingNode) => void;
}) {
  const moveNo = Math.floor(turn.ply / 2) + 1;
  const marker = turn.ply % 2 === 0 ? `${moveNo}.` : `${moveNo}\u2026`;
  const nodes = turn.nodes || [];
  return (
    <div data-testid="coach-turn" className="teaching-log-row" style={{ borderLeftColor: accent }}>
      <div className="teaching-log-row__header">
        <strong className="teaching-log-row__label">{label}</strong>
        <span className="teaching-log-row__move">
          {marker} {turn.san}
        </span>
        {turn.classification && <QualityBadge classification={turn.classification} cpLoss={turn.cpLoss ?? 0} />}
        {turn.evalCp !== null && (
          <span className="teaching-log-row__eval">
            <EvalBar cp={turn.evalCp} text={turn.evalText} />
          </span>
        )}
      </div>
      {turn.status === 'analyzing' ? (
        <div className="teaching-log-row__analyzing">analyzing{'\u2026'}</div>
      ) : (
        <TeachingMoveBody
          nodes={nodes}
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
        <div data-testid="hazard-note" className="teaching-log-row__hazard">
          {'\u26a0'} {turn.hazardNote}
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
  const loss = cpLoss > 0 ? `\u2212${cpLoss.toFixed(2)}` : '0.00';
  return (
    <span
      className="teaching-quality-badge"
      title={`Move quality: ${classification} (lost ${cpLoss.toFixed(2)})`}
      style={{ background: color }}
    >
      {classification} {'\u00b7'} {loss}
    </span>
  );
}

// A standard eval bar for the POSITION odds: White fills from the left in proportion
// to the win expectation (logistic of the centipawn score), with the signed eval.
function EvalBar({ cp, text }: { cp: number; text: string }) {
  const whiteFrac = Math.max(0.04, Math.min(0.96, 1 / (1 + Math.exp(-cp / 400))));
  return (
    <span title="Engine eval - position odds (White perspective)" className="teaching-eval-bar">
      <span className="teaching-eval-bar__track">
        <span className="teaching-eval-bar__fill" style={{ width: `${whiteFrac * 100}%` }} />
      </span>
      <span className="teaching-eval-bar__text">{text}</span>
    </span>
  );
}
