import type { DetectedOpening } from '../engine/teaching/openings';
import type { MoveIdea } from '../engine/teaching/moveIdea';
import type { TeachingNode } from '../engine/teaching/node';
import { TeachingNodeCard } from './TeachingNodeCard';

// The teaching panel wraps the canonical list of teaching nodes.
export function TeachingPanel({
  nodes,
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
  nodes: TeachingNode[];
  busy: boolean;
  error: string;
  focusedId: string | null;
  onShow: (node: TeachingNode | null) => void;
  onPractice?: (node: TeachingNode) => void;
  narrations?: ReadonlyMap<string, string>;
  narratingId?: string | null;
  onNarrate?: (node: TeachingNode) => void;
  opening?: DetectedOpening | null;
  idea?: MoveIdea | null;
  summary?: string; // the move's top ranked insight ("Gains the center on d5")
}) {
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
          nodes={nodes}
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
  nodes = [],
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
  nodes?: TeachingNode[];
  idea?: MoveIdea | null;
  summary?: string;
  opening?: DetectedOpening | null;
  classification?: string;
  betterMove?: string;
  focusedId: string | null;
  onShow: (node: TeachingNode | null) => void;
  canShow?: boolean;
  onPractice?: (node: TeachingNode) => void;
  narrations?: ReadonlyMap<string, string>;
  narratingId?: string | null;
  onNarrate?: (node: TeachingNode) => void;
}) {
  if (nodes.length > 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {nodes.map((node) => (
          <TeachingNodeCard
            key={node.id}
            node={node}
            focused={focusedId === node.id}
            onShow={canShow ? () => onShow(focusedId === node.id ? null : node) : undefined}
            onPractice={onPractice ? () => onPractice(node) : undefined}
            narration={narrations?.get(node.id)}
            narrating={narratingId === node.id}
            onNarrate={onNarrate ? () => onNarrate(node) : undefined}
          />
        ))}
      </div>
    );
  }
  // A graded mistake with no specific named pattern: say it's a mistake and give the
  // preferred move
  if (classification && MISTAKE_BAND.has(classification)) {
    return <MistakeNote classification={classification} betterMove={betterMove} />;
  }
  if (idea) return <IdeaCard idea={idea} />;
  if (summary && summary !== 'solid move') return <MoveSummary text={summary} />;
  if (opening) return <OpeningCard opening={opening} />;
  return <div style={{ color: 'var(--muted)', fontSize: 13 }}>No teaching topic for this move.</div>;
}

// The fallback explanation for a graded mistake: honest about the grade
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

// Render an insight as a clean sentence
export function toSentence(text: string): string {
  const trimmed = text.replace(/\s*\.+\s*$/, '');
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}

function MoveSummary({ text }: { text: string }) {
  return (
    <div data-testid="move-summary" style={{ fontSize: 13, color: 'var(--text-soft)' }}>
      {toSentence(text)}
    </div>
  );
}

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
