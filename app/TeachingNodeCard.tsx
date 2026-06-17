import type { TeachingNode } from '../engine/teaching/node';

const BADGE_TEXT: Record<string, string> = {
  confirmed: 'Confirmed',
  refuted: 'Refuted',
  unverified: 'Possible',
  unavailable: 'Unverified',
};

function claimClass(status: string): string {
  return ['confirmed', 'refuted', 'unverified', 'unavailable'].includes(status)
    ? status
    : 'unavailable';
}

export function TeachingNodeCard({
  node,
  focused,
  onShow,
  onPractice,
  narration,
  narrating,
  onNarrate,
}: {
  node: TeachingNode;
  focused: boolean;
  onShow?: () => void;
  onPractice?: () => void;
  narration?: string;
  narrating?: boolean;
  onNarrate?: () => void;
}) {
  const badgeText = BADGE_TEXT[node.claimStatus] || node.claimStatus;
  const canPractice = !!onPractice && (!!node.verification.expectedMove || !!node.betterMove);

  return (
    <div
      data-testid="teaching-node-card"
      className={`teaching-node-card${focused ? ' is-focused' : ''}`}
    >
      <div className="teaching-node-card__header">
        <span className="teaching-node-card__title">{node.title}</span>
        <span
          className={`teaching-node-card__badge teaching-node-card__badge--${claimClass(
            node.claimStatus,
          )}`}
        >
          {badgeText}
        </span>
      </div>

      <div className="teaching-node-card__summary">{node.summary}</div>

      {node.why && (
        <div className="teaching-node-card__text">
          <span className="teaching-node-card__muted">Why: </span>
          {node.why}
        </div>
      )}

      {node.betterExplanation && (
        <div className="teaching-node-card__text">
          <span className="teaching-node-card__muted">Better: </span>
          {node.betterExplanation}
        </div>
      )}

      {node.verification.depth && (
        <div data-testid="node-verification-info" className="teaching-node-card__verification">
          <span>Engine verification {'\u00b7'} depth {node.verification.depth}</span>
          {node.verification.scoreAfter !== undefined && (
            <>
              <span>{'\u00b7'}</span>
              <span>Evaluation: {(node.verification.scoreAfter / 100).toFixed(1)}</span>
            </>
          )}
          <span>{'\u00b7'}</span>
          <span>Result: tactical material claim {node.claimStatus}</span>
        </div>
      )}

      {narration && (
        <div data-testid="teaching-narration" className="teaching-node-card__narration">
          {narration}
        </div>
      )}

      <div className="teaching-node-card__footer">
        {node.involvedSquares.map((sq) => (
          <span key={sq} className="teaching-node-card__square">
            {sq}
          </span>
        ))}

        {onNarrate && (
          <button
            className="teaching-node-card__action teaching-node-card__action--push"
            onClick={onNarrate}
            disabled={narrating}
          >
            {narrating ? 'Narrating...' : narration ? 'Narrate again' : 'Narrate'}
          </button>
        )}

        {canPractice && (
          <button
            className={`teaching-node-card__action${onNarrate ? '' : ' teaching-node-card__action--push'}`}
            onClick={onPractice}
          >
            Practice
          </button>
        )}

        {onShow && (
          <button
            className={`teaching-node-card__action${focused ? ' is-active' : ''}${
              canPractice || onNarrate ? '' : ' teaching-node-card__action--push'
            }`}
            onClick={onShow}
          >
            {focused ? 'Hide' : 'Show on board'}
          </button>
        )}
      </div>
    </div>
  );
}
