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
    <section data-testid="teaching-facts-debug" className="teaching-facts-debug">
      <details>
        <summary className="teaching-facts-debug__summary">
          Teaching facts JSON{' '}
          <span className="teaching-facts-debug__summary-note">(developer)</span>
        </summary>
        <div className="teaching-facts-debug__body">
          {busy ? (
            <div className="teaching-facts-debug__muted">requesting Rust facts...</div>
          ) : error ? (
            <div className="teaching-facts-debug__error">{error}</div>
          ) : facts ? (
            <pre className="teaching-facts-debug__pre">{JSON.stringify(facts, null, 2)}</pre>
          ) : (
            <div className="teaching-facts-debug__muted">
              {request ? 'No fact bundle returned.' : 'Play or select a move to request facts.'}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
