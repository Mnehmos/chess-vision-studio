import type { ProofBadge, TeachingAnalysis, TeachingEvent } from '../engine/teaching/types';

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
}: {
  analysis: TeachingAnalysis | null;
  busy: boolean;
  error: string;
  focusedId: string | null;
  onShow: (event: TeachingEvent | null) => void;
  onPractice?: (event: TeachingEvent) => void;
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
      ) : events.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>No teaching topic for this move.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {events.map((event) => (
            <TeachingCard
              key={event.id}
              event={event}
              focused={focusedId === event.id}
              onShow={() => onShow(focusedId === event.id ? null : event)}
              onPractice={onPractice ? () => onPractice(event) : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TeachingCard({
  event,
  focused,
  onShow,
  onPractice,
}: {
  event: TeachingEvent;
  focused: boolean;
  onShow: () => void;
  onPractice?: () => void;
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
        {canPractice && (
          <button
            onClick={onPractice}
            style={{
              marginLeft: 'auto',
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
        <button
          onClick={onShow}
          style={{
            marginLeft: canPractice ? 0 : 'auto',
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
