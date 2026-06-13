import type { TeachingFactBundleV1, TeachingFactsRequestV1 } from '../engine/teaching/types';

export function TeachingFactsDebugPanel({
  request,
  facts,
  busy,
  error,
}: {
  request: TeachingFactsRequestV1 | null;
  facts: TeachingFactBundleV1 | null;
  busy: boolean;
  error: string;
}) {
  return (
    <section
      data-testid="teaching-facts-debug"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 12,
      }}
    >
      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
          Teaching facts JSON{' '}
          <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(developer)</span>
        </summary>
        <div style={{ marginTop: 9, fontSize: 12 }}>
          {busy ? (
            <div style={{ color: 'var(--muted)' }}>requesting Rust facts...</div>
          ) : error ? (
            <div style={{ color: 'var(--bad)', wordBreak: 'break-word' }}>{error}</div>
          ) : facts ? (
            <pre
              style={{
                margin: 0,
                maxHeight: 420,
                overflow: 'auto',
                padding: 10,
                borderRadius: 7,
                background: '#12100e',
                color: 'var(--text-soft)',
                fontFamily: 'var(--mono)',
                fontSize: 10,
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {JSON.stringify(facts, null, 2)}
            </pre>
          ) : (
            <div style={{ color: 'var(--muted)' }}>
              {request ? 'No fact bundle returned.' : 'Play or select a move to request facts.'}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
