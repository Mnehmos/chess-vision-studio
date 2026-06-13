import type { ProofBadge, TeachingAnalysis, TeachingEvent } from '../engine/teaching/types';
import type { DetectedOpening } from '../engine/teaching/openings';
import type { MoveIdea } from '../engine/teaching/moveIdea';

// Deterministic teaching card: the structured ExplanationPlan the compiler
// committed, with a proof badge stating how strongly it is backed. Clicking a card
// focuses its squares + arrows on the board (handled by the parent).

const BADGE: Record<ProofBadge, { text: string; bg: string }> = {
  proven_tactic: { text: 'Proven tactic', bg: '#2f855a' },
  engine_line: { text: 'Engine line', bg: 'var(--accent)' },
  counterfactual_supported: { text: 'Counterfactual', bg: '#dd6b20' },
  structural_fact: { text: 'Structural fact', bg: '#4a5568' },
  descriptive_only: { text: 'Descriptive', bg: 'var(--muted)' },
};

const VERDICT: Record<string, string> = {
  allowed: 'Allowed',
  missed: 'Missed',
  failed_to_answer: 'Failed to defend',
  worsened: 'Worsened',
  created: 'Created',
  improved: 'Improved',
  accepted_tradeoff: 'Accepted tradeoff',
};

export function TeachingPanel({
  analysis,
  busy,
  error,
  focusedId,
  onShow,
  onPractice,
  narrations,
  narratingId,
  onNarrate,
  opening,
  idea,
  summary,
}: {
  analysis: TeachingAnalysis | null;
  busy: boolean;
  error: string;
  focusedId: string | null;
  onShow: (event: TeachingEvent | null) => void;
  onPractice?: (event: TeachingEvent) => void;
  narrations?: ReadonlyMap<string, string>;
  narratingId?: string | null;
  onNarrate?: (event: TeachingEvent) => void;
  opening?: DetectedOpening | null;
  idea?: MoveIdea | null;
  summary?: string; // the move's top ranked insight ("Gains the center on d5")
}) {
  const events = analysis && analysis.computed ? analysis.events : [];
  return (
    <section
      data-testid="teaching-panel"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 12,
      }}
    >
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
        Teaching
      </div>
      {busy ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Analyzing…</div>
      ) : error ? (
        <div style={{ color: 'var(--bad)', fontSize: 13, wordBreak: 'break-word' }}>{error}</div>
      ) : (
        <TeachingMoveBody
          events={events}
          idea={idea}
          summary={summary}
          opening={opening}
          focusedId={focusedId}
          onShow={onShow}
          onPractice={onPractice}
          narrations={narrations}
          narratingId={narratingId}
          onNarrate={onNarrate}
        />
      )}
    </section>
  );
}

// THE single teaching renderer — reused by the Analyze panel AND every coaching-log
// turn so teaching reads identically everywhere (one idea, built once). Precedence:
// a committed mistake (rich card) → a tactical idea (fork/pin/capture) → what the
// move does (top ranked insight) → opening book → nothing.
const MISTAKE_BAND = new Set(['inaccuracy', 'mistake', 'blunder']);

export function TeachingMoveBody({
  events,
  idea,
  summary,
  opening,
  classification,
  betterMove,
  focusedId,
  onShow,
  canShow = true,
  onPractice,
  narrations,
  narratingId,
  onNarrate,
}: {
  events: TeachingEvent[];
  idea?: MoveIdea | null;
  summary?: string;
  opening?: DetectedOpening | null;
  classification?: string;
  betterMove?: string;
  focusedId: string | null;
  onShow: (event: TeachingEvent | null) => void;
  canShow?: boolean;
  onPractice?: (event: TeachingEvent) => void;
  narrations?: ReadonlyMap<string, string>;
  narratingId?: string | null;
  onNarrate?: (event: TeachingEvent) => void;
}) {
  if (events.length > 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {events.map((event) => (
          <TeachingCard
            key={event.id}
            event={event}
            focused={focusedId === event.id}
            onShow={canShow ? () => onShow(focusedId === event.id ? null : event) : undefined}
            onPractice={onPractice ? () => onPractice(event) : undefined}
            narration={narrations?.get(event.id)}
            narrating={narratingId === event.id}
            onNarrate={onNarrate ? () => onNarrate(event) : undefined}
          />
        ))}
      </div>
    );
  }
  // A graded mistake with no specific named pattern: say it's a mistake and give the
  // engine's better move — NEVER dress it up as a winning idea (the grade overrides
  // any tactical motif the move technically makes).
  if (classification && MISTAKE_BAND.has(classification)) {
    return <MistakeNote classification={classification} betterMove={betterMove} />;
  }
  if (idea) return <IdeaCard idea={idea} />;
  if (summary && summary !== 'solid move') return <MoveSummary text={summary} />;
  if (opening) return <OpeningCard opening={opening} />;
  return <div style={{ color: 'var(--muted)', fontSize: 13 }}>No teaching topic for this move.</div>;
}

// The fallback explanation for a graded mistake the compiler didn't match to a named
// topic: honest about the grade, with the engine's preferred move as the correction.
function MistakeNote({ classification, betterMove }: { classification: string; betterMove?: string }) {
  const article = classification === 'inaccuracy' ? 'an' : 'a';
  return (
    <div
      data-testid="mistake-note"
      style={{ border: '1px solid var(--border)', borderLeft: '3px solid #c53030', borderRadius: 8, padding: 10 }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
        This move is {article} {classification}.
      </div>
      {betterMove && (
        <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 2 }}>
          Better was <strong style={{ color: 'var(--text)' }}>{betterMove}</strong>.
        </div>
      )}
    </div>
  );
}

// Render an insight as a clean sentence — the source may or may not already end in a
// period, so normalize to exactly one.
export function toSentence(text: string): string {
  const trimmed = text.replace(/\s*\.+\s*$/, '');
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}

// The move's top validated insight ("Gains the center on d5", "Develops a piece on
// f4") — so every move, including quiet ones and Black's, says something specific
// instead of falling back to the generic opening name.
function MoveSummary({ text }: { text: string }) {
  return (
    <div data-testid="move-summary" style={{ fontSize: 13, color: 'var(--text-soft)' }}>
      {toSentence(text)}
    </div>
  );
}

// The positive complement to a mistake card: what a strong move accomplishes — a
// validated fork, pin, or winning capture — so good moves aren't silent.
function IdeaCard({ idea }: { idea: MoveIdea }) {
  const label = idea.kind === 'fork' ? 'Fork' : idea.kind === 'pin' ? 'Pin' : 'Winning capture';
  return (
    <div
      data-testid="idea-card"
      style={{ border: '1px solid var(--border)', borderLeft: '3px solid #2f855a', borderRadius: 8, padding: 10 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>This move’s idea</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: '#fff',
            background: '#2f855a',
            padding: '1px 6px',
            borderRadius: 4,
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-soft)' }}>{idea.text}</div>
    </div>
  );
}

// Opening guidance: a named opening matched from the move sequence, with its book
// plan. Distinct from engine-derived hazard topics — badged "Opening book" so the
// source of truth is never ambiguous.
export function OpeningCard({ opening }: { opening: DetectedOpening }) {
  const { info } = opening;
  return (
    <div
      data-testid="opening-card"
      style={{
        border: '1px solid var(--border)',
        borderLeft: '3px solid #3182ce',
        borderRadius: 8,
        padding: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{info.name}</span>
        {info.eco && (
          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 10,
              color: 'var(--text-soft)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '1px 5px',
            }}
          >
            {info.eco}
          </span>
        )}
        <span
          title="Opening book knowledge — not engine analysis"
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: '#fff',
            background: '#3182ce',
            padding: '1px 6px',
            borderRadius: 4,
          }}
        >
          Opening book
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-soft)', marginBottom: info.ideas.length ? 6 : 0 }}>
        {info.summary}
      </div>
      {info.ideas.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {info.ideas.map((idea) => (
            <li key={idea} style={{ fontSize: 12, color: 'var(--text-soft)' }}>
              {idea}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TeachingCard({
  event,
  focused,
  onShow,
  onPractice,
  narration,
  narrating,
  onNarrate,
}: {
  event: TeachingEvent;
  focused: boolean;
  onShow?: () => void;
  onPractice?: () => void;
  narration?: string;
  narrating: boolean;
  onNarrate?: () => void;
}) {
  const badge = BADGE[event.proof.badge];
  const { plan } = event;
  // A puzzle is buildable only when the event has a punishment or a correction.
  const canPractice = !!onPractice && !!(event.punishment || event.correction);
  return (
    <div
      data-testid="teaching-card"
      style={{
        border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 8,
        padding: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{plan.topic}</span>
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-soft)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '1px 5px',
          }}
        >
          {VERDICT[event.action] ?? event.action}
        </span>
        <span
          title={`Proof: ${event.proof.attribution}`}
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: '#fff',
            background: badge.bg,
            padding: '1px 6px',
            borderRadius: 4,
          }}
        >
          {badge.text}
        </span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
        {plan.headline}
      </div>
      {plan.cause && <Clause label="Why" text={plan.cause} />}
      {plan.consequence && <Clause label="Consequence" text={plan.consequence} />}
      {plan.correction && <Clause label="Better" text={plan.correction} />}
      {plan.caveat && (
        <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--muted)', marginTop: 4 }}>
          {plan.caveat}
        </div>
      )}
      {event.engineCheck && <EngineCheckLine check={event.engineCheck} />}
      {narration && (
        <div data-testid="teaching-narration" style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 6 }}>
          {narration}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {event.squares.map((sq) => (
          <span
            key={sq}
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 10,
              color: 'var(--text-soft)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '1px 4px',
            }}
          >
            {sq}
          </span>
        ))}
        {onNarrate && (
          <button
            onClick={onNarrate}
            disabled={narrating}
            style={{
              marginLeft: 'auto',
              fontSize: 12,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--text)',
              borderRadius: 6,
              padding: '3px 8px',
              cursor: narrating ? 'wait' : 'pointer',
            }}
          >
            {narrating ? 'Narrating...' : narration ? 'Narrate again' : 'Narrate'}
          </button>
        )}
        {canPractice && (
          <button
            onClick={onPractice}
            style={{
              marginLeft: onNarrate ? 0 : 'auto',
              fontSize: 12,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--text)',
              borderRadius: 6,
              padding: '3px 8px',
              cursor: 'pointer',
            }}
          >
            Practice
          </button>
        )}
        {onShow && (
          <button
            onClick={onShow}
            style={{
              marginLeft: canPractice || onNarrate ? 0 : 'auto',
              fontSize: 12,
              border: '1px solid var(--border)',
              background: focused ? 'var(--accent)' : 'var(--card)',
              color: focused ? '#fff' : 'var(--text)',
              borderRadius: 6,
              padding: '3px 8px',
              cursor: 'pointer',
            }}
          >
            {focused ? 'Hide' : 'Show on board'}
          </button>
        )}
      </div>
    </div>
  );
}

function Clause({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 2 }}>
      <span style={{ color: 'var(--muted)' }}>{label}: </span>
      {text}
    </div>
  );
}

// The engine's verdict on the exposed tactic's own move — green when it really wins,
// red when the engine refutes it at depth.
function EngineCheckLine({ check }: { check: { attackerCp: number; depth: number } }) {
  const winning = check.attackerCp >= 50;
  const color = winning ? '#2f855a' : '#d43b3b';
  const text = `${check.attackerCp >= 0 ? '+' : ''}${(check.attackerCp / 100).toFixed(1)}`;
  return (
    <div
      data-testid="engine-check"
      style={{ fontSize: 12, marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}
    >
      <span style={{ color: 'var(--muted)' }}>Engine check (d{check.depth}):</span>
      <strong style={{ color, fontFamily: 'var(--mono)' }}>{text}</strong>
      <span style={{ color }}>{winning ? 'the tactic wins material.' : 'refuted — it doesn’t actually win material.'}</span>
    </div>
  );
}
