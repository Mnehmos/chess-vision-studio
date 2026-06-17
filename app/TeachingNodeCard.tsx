import type { TeachingNode } from '../engine/teaching/node';

const BADGE_STYLE: Record<string, { text: string; bg: string }> = {
  confirmed: { text: 'Confirmed', bg: '#2f855a' },
  refuted: { text: 'Refuted', bg: '#d43b3b' },
  unverified: { text: 'Possible', bg: '#dd6b20' },
  unavailable: { text: 'Unverified', bg: 'var(--muted)' },
};

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
  const badge = BADGE_STYLE[node.claimStatus] || { text: node.claimStatus, bg: 'var(--muted)' };

  // A puzzle is buildable when the node has an expectedMove or betterMove
  const canPractice = !!onPractice && (!!node.verification.expectedMove || !!node.betterMove);

  return (
    <div
      data-testid="teaching-node-card"
      style={{
        border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 8,
        padding: 10,
        background: 'var(--card)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
          {node.title}
        </span>
        <span
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

      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-soft)' }}>
        {node.summary}
      </div>

      {node.why && (
        <div style={{ fontSize: 12, color: 'var(--text-soft)' }}>
          <span style={{ color: 'var(--muted)' }}>Why: </span>
          {node.why}
        </div>
      )}

      {node.betterExplanation && (
        <div style={{ fontSize: 12, color: 'var(--text-soft)' }}>
          <span style={{ color: 'var(--muted)' }}>Better: </span>
          {node.betterExplanation}
        </div>
      )}

      {node.verification.depth && (
        <div
          data-testid="node-verification-info"
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            marginTop: 4,
            paddingTop: 4,
            borderTop: '1px dashed var(--border)',
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
          }}
        >
          <span>Engine verification · depth {node.verification.depth}</span>
          {node.verification.scoreAfter !== undefined && (
            <>
              <span>·</span>
              <span>Evaluation: {(node.verification.scoreAfter / 100).toFixed(1)}</span>
            </>
          )}
          <span>·</span>
          <span>Result: tactical material claim {node.claimStatus}</span>
        </div>
      )}

      {narration && (
        <div data-testid="teaching-narration" style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 6 }}>
          {narration}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
        {node.involvedSquares.map((sq) => (
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
