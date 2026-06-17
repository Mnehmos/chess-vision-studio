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
    <section data-testid="teaching-panel" className="teaching-panel">
      <div className="teaching-panel__kicker">Teaching</div>
      {busy ? (
        <div className="teaching-panel__state">Analyzing{'\u2026'}</div>
      ) : error ? (
        <div className="teaching-panel__error">{error}</div>
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

// THE single teaching renderer - reused by the Analyze panel AND every coaching-log
// turn so teaching reads identically everywhere (one idea, built once). Precedence:
// a committed mistake (rich card) -> a tactical idea (fork/pin/capture) -> what the
// move does (top ranked insight) -> opening book -> nothing.
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
      <div className="teaching-move-body__nodes">
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
  // preferred move.
  if (classification && MISTAKE_BAND.has(classification)) {
    return <MistakeNote classification={classification} betterMove={betterMove} />;
  }
  if (idea) return <IdeaCard idea={idea} />;
  if (summary && summary !== 'solid move') return <MoveSummary text={summary} />;
  if (opening) return <OpeningCard opening={opening} />;
  return <div className="teaching-panel__empty">No teaching topic for this move.</div>;
}

// The fallback explanation for a graded mistake: honest about the grade.
function MistakeNote({ classification, betterMove }: { classification: string; betterMove?: string }) {
  const article = classification === 'inaccuracy' ? 'an' : 'a';
  return (
    <div data-testid="mistake-note" className="teaching-card teaching-card--mistake">
      <div className="teaching-card__headline">
        This move is {article} {classification}.
      </div>
      {betterMove && (
        <div className="teaching-card__text teaching-card__text--spaced">
          Better was <strong className="teaching-card__strong">{betterMove}</strong>.
        </div>
      )}
    </div>
  );
}

// Render an insight as a clean sentence.
export function toSentence(text: string): string {
  const trimmed = text.replace(/\s*\.+\s*$/, '');
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}

function MoveSummary({ text }: { text: string }) {
  return (
    <div data-testid="move-summary" className="teaching-panel__summary">
      {toSentence(text)}
    </div>
  );
}

function IdeaCard({ idea }: { idea: MoveIdea }) {
  const label = idea.kind === 'fork' ? 'Fork' : idea.kind === 'pin' ? 'Pin' : 'Winning capture';
  return (
    <div data-testid="idea-card" className="teaching-card teaching-card--idea">
      <div className="teaching-card__header">
        <span className="teaching-card__title">This move{'\u2019'}s idea</span>
        <span className="teaching-card__badge teaching-card__badge--idea">{label}</span>
      </div>
      <div className="teaching-card__text">{idea.text}</div>
    </div>
  );
}

export function OpeningCard({ opening }: { opening: DetectedOpening }) {
  const { info } = opening;
  return (
    <div data-testid="opening-card" className="teaching-card teaching-card--opening">
      <div className="teaching-card__header teaching-card__header--wrap">
        <span className="teaching-card__title">{info.name}</span>
        {info.eco && <span className="teaching-card__eco">{info.eco}</span>}
        <span title="Opening book knowledge - not engine analysis" className="teaching-card__badge teaching-card__badge--opening">
          Opening book
        </span>
      </div>
      <div
        className={`teaching-card__text teaching-card__opening-summary${
          info.ideas.length ? ' has-ideas' : ''
        }`}
      >
        {info.summary}
      </div>
      {info.ideas.length > 0 && (
        <ul className="teaching-card__ideas">
          {info.ideas.map((idea) => (
            <li key={idea} className="teaching-card__idea">
              {idea}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
