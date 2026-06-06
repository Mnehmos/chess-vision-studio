// Coach commentary (LLM) — the clamped narrator (Invariant 8). The button batches
// GPT over every analyzed ply and caches it; per-ply "Explain this move" narrates the
// current move on demand. The key is read from VITE_OPENAI_API_KEY or pasted here
// (stored in localStorage) — never committed.
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
  return (
    <div style={{ marginTop: 16, border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, maxWidth: 360 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h4 style={{ margin: 0 }}>Coach commentary</h4>
        <span style={{ fontSize: 11, color: '#999' }}>{model}</span>
      </div>

      {!hasKey ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>
            Paste an OpenAI API key to enable commentary (stored locally in this browser),
            or set <code>VITE_OPENAI_API_KEY</code> in <code>.env</code>.
          </div>
          <div style={{ fontSize: 11, color: '#c08515', background: '#fff7e6', border: '1px solid #f0d8a8', borderRadius: 4, padding: '4px 6px', marginBottom: 6 }}>
            Already set a key in <code>.env</code> but see this? The browser only reads the
            <code> VITE_</code> prefix — rename <code>OPENAI_API_KEY</code> →{' '}
            <code>VITE_OPENAI_API_KEY</code> and restart the dev server.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="sk-…"
              style={{ flex: 1, fontSize: 12, padding: '4px 6px' }}
            />
            <button onClick={() => keyDraft.trim() && onSaveKey(keyDraft.trim())} style={btn}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Handshake: prove the key + model are live before batching. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12 }}>
            <HandshakeBadge handshake={handshake} />
            <span style={{ color: '#999' }}>
              key from {keySource === 'env' ? '.env (VITE_)' : 'this browser'}
            </span>
            <button
              onClick={onHandshake}
              disabled={handshake.state === 'testing'}
              style={{ ...btn, marginLeft: 'auto', padding: '2px 8px', fontSize: 12 }}
            >
              {handshake.state === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
          </div>
          {handshake.state === 'error' && (
            <div style={{ color: '#c01515', fontSize: 11, marginTop: 4, wordBreak: 'break-word' }}>
              {handshake.detail}
            </div>
          )}
          {/* The headline action the user asked for. */}
          <button
            onClick={onGenerateAll}
            disabled={job.running || totalAnalyzed === 0}
            style={{ ...btn, width: '100%', marginTop: 8, padding: '8px 10px', fontWeight: 600 }}
          >
            {job.running
              ? `Generating… ${job.done}/${job.total}`
              : `Generate commentary for all ${totalAnalyzed} moves`}
          </button>
          {job.running && (
            <div style={{ height: 4, background: '#eee', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${job.total ? (job.done / job.total) * 100 : 0}%`,
                  background: '#3b6fd4',
                  transition: 'width 0.2s',
                }}
              />
            </div>
          )}
          {job.error && <div style={{ color: '#c01515', fontSize: 12, marginTop: 6 }}>{job.error}</div>}

          {/* Per-ply, on demand. */}
          <div style={{ marginTop: 10, borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
            {currentText ? (
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{currentText}</p>
            ) : (
              <button onClick={onExplainCurrent} disabled={!canExplain || explaining} style={btn}>
                {explaining ? 'Thinking…' : 'Explain this move'}
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
    idle: { dot: '#bbb', text: 'not tested' },
    testing: { dot: '#e8923b', text: 'testing…' },
    ok: { dot: '#3fbf5f', text: 'connected' },
    error: { dot: '#e23b3b', text: 'failed' },
  } as const;
  const s = map[handshake.state];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.dot, display: 'inline-block' }} />
      {s.text}
    </span>
  );
}

const btn: React.CSSProperties = {
  border: '1px solid #ccc',
  background: '#fff',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 13,
  cursor: 'pointer',
};
