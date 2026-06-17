// Coach commentary (LLM) - the clamped narrator (Invariant 8). The button batches
// GPT over every analyzed ply and caches it; per-ply "Explain this move" narrates the
// current move on demand. The key is read from VITE_OPENAI_API_KEY or pasted here
// (stored in localStorage) - never committed.
import { useState } from 'react';

export interface CommentaryJob {
  running: boolean;
  done: number;
  total: number;
  error: string;
}

export interface Handshake {
  state: 'idle' | 'testing' | 'ok' | 'error';
  detail: string;
}

export function CommentaryPanel({
  hasKey,
  keySource,
  model,
  onSaveKey,
  handshake,
  onHandshake,
  currentText,
  onExplainCurrent,
  canExplain,
  explaining,
  job,
  onGenerateAll,
  totalAnalyzed,
}: {
  hasKey: boolean;
  keySource: 'env' | 'local' | 'none';
  model: string;
  onSaveKey: (key: string) => void;
  handshake: Handshake;
  onHandshake: () => void;
  currentText?: string;
  onExplainCurrent: () => void;
  canExplain: boolean;
  explaining: boolean;
  job: CommentaryJob;
  onGenerateAll: () => void;
  totalAnalyzed: number;
}) {
  const [keyDraft, setKeyDraft] = useState('');
  const progressPct = job.total ? (job.done / job.total) * 100 : 0;

  return (
    <div className="commentary-panel">
      <div className="commentary-panel__header">
        <h4 className="commentary-panel__title">Coach commentary</h4>
        <span className="commentary-panel__model">{model}</span>
      </div>

      {!hasKey ? (
        <div className="commentary-panel__setup">
          <div className="commentary-panel__help">
            Set <code>OPENAI_API_KEY</code> in <code>.env</code> (stays server-side, never sent
            to the browser), then restart the dev server. Or paste a key below for this browser.
          </div>
          <div className="commentary-panel__warning">
            Already set <code>OPENAI_API_KEY</code> in <code>.env</code> but see this? The dev
            server reads <code>.env</code> only at startup {'\u2014'} <strong>restart it</strong>{' '}
            and reload.
          </div>
          <div className="commentary-panel__key-row">
            <input
              className="commentary-panel__key-input"
              type="password"
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              placeholder="sk-..."
            />
            <button
              className="commentary-panel__button"
              onClick={() => keyDraft.trim() && onSaveKey(keyDraft.trim())}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="commentary-panel__handshake">
            <HandshakeBadge handshake={handshake} />
            <span className="commentary-panel__source">
              key from {keySource === 'env' ? '.env (server-side)' : 'this browser'}
            </span>
            <button
              className="commentary-panel__button commentary-panel__button--test"
              onClick={onHandshake}
              disabled={handshake.state === 'testing'}
            >
              {handshake.state === 'testing' ? `Testing${'\u2026'}` : 'Test connection'}
            </button>
          </div>
          {handshake.state === 'error' && (
            <div className="commentary-panel__handshake-error">{handshake.detail}</div>
          )}

          <button
            className="commentary-panel__button commentary-panel__button--primary"
            onClick={onGenerateAll}
            disabled={job.running || totalAnalyzed === 0}
          >
            {job.running
              ? `Generating${'\u2026'} ${job.done}/${job.total}`
              : `Generate commentary for all ${totalAnalyzed} moves`}
          </button>
          {job.running && (
            <div className="commentary-panel__progress">
              <div className="commentary-panel__progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          )}
          {job.error && <div className="commentary-panel__job-error">{job.error}</div>}

          <div className="commentary-panel__current">
            {currentText ? (
              <p className="commentary-panel__text">{currentText}</p>
            ) : (
              <button
                className="commentary-panel__button"
                onClick={onExplainCurrent}
                disabled={!canExplain || explaining}
              >
                {explaining ? `Thinking${'\u2026'}` : 'Explain this move'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function HandshakeBadge({ handshake }: { handshake: Handshake }) {
  const map = {
    idle: { dot: 'var(--border)', text: 'not tested' },
    testing: { dot: '#e8923b', text: `testing${'\u2026'}` },
    ok: { dot: '#3fbf5f', text: 'connected' },
    error: { dot: '#e23b3b', text: 'failed' },
  } as const;
  const state = map[handshake.state];
  return (
    <span className="commentary-panel__badge">
      <span className="commentary-panel__badge-dot" style={{ background: state.dot }} />
      {state.text}
    </span>
  );
}
