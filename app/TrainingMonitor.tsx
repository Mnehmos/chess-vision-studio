import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

type TrainingPhase = 'idle' | 'importing' | 'training' | 'done' | 'error' | 'stopped';

interface TrainingConfig {
  mode: 'import-train' | 'train-only';
  input: string;
  datasetOut: string;
  weightsOut: string;
  reportOut: string;
  depth: number;
  limit: number;
  maxPlies: number;
  minElo: number;
  sampleEvery: number;
  epochs: number;
}

interface TrainingStatus {
  phase: TrainingPhase;
  active: boolean;
  startedAt: string | null;
  endedAt: string | null;
  config: TrainingConfig;
  import: { seen: number; imported: number; skipped: number; rows: number; limit: number };
  train: { trainRows: number; holdoutRows: number; baselineTop1: number | null; tunedTop1: number | null };
  error: string;
  logs: string[];
}

const DEFAULT_CONFIG: TrainingConfig = {
  mode: 'import-train',
  input: 'fixtures/sample-game.pgn',
  datasetOut: 'arena/out/lichess-master-dataset.jsonl',
  weightsOut: 'arena/out/weights.json',
  reportOut: 'arena/out/train-report.json',
  depth: 10,
  limit: 50,
  maxPlies: 80,
  minElo: 2200,
  sampleEvery: 1,
  epochs: 120,
};

const IDLE_STATUS: TrainingStatus = {
  phase: 'idle',
  active: false,
  startedAt: null,
  endedAt: null,
  config: DEFAULT_CONFIG,
  import: { seen: 0, imported: 0, skipped: 0, rows: 0, limit: DEFAULT_CONFIG.limit },
  train: { trainRows: 0, holdoutRows: 0, baselineTop1: null, tunedTop1: null },
  error: '',
  logs: [],
};

const card: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid #e6e8eb',
  borderRadius: 8,
  boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
};

const label: CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: 'var(--muted)',
  marginBottom: 4,
  fontWeight: 600,
};

const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid #d0d5dd',
  borderRadius: 6,
  padding: '7px 8px',
  fontSize: 13,
  background: 'var(--card)',
  color: 'var(--text)',
};

const smallBtn: CSSProperties = {
  border: '1px solid #d0d5dd',
  background: 'var(--card)',
  color: 'var(--text)',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const startBtn: CSSProperties = {
  ...smallBtn,
  border: '1px solid #3b6fd4',
  background: 'var(--accent)',
  color: '#fff',
};

const stopBtn: CSSProperties = {
  ...smallBtn,
  border: '1px solid #d92d20',
  color: 'var(--bad)',
};

export function TrainingMonitor() {
  const [status, setStatus] = useState<TrainingStatus>(IDLE_STATUS);
  const [config, setConfig] = useState<TrainingConfig>(DEFAULT_CONFIG);
  const [requestError, setRequestError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/training/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: TrainingStatus | null) => {
        if (!alive || !s) return;
        setStatus(s);
        setConfig(s.config);
      })
      .catch((e) => alive && setRequestError(String((e as Error)?.message ?? e)));

    const events = new EventSource('/api/training/events');
    events.onmessage = (ev) => {
      const next = JSON.parse(ev.data) as TrainingStatus;
      setStatus(next);
      if (!next.active) setConfig(next.config);
    };
    events.onerror = () => setRequestError('Training event stream disconnected.');
    return () => {
      alive = false;
      events.close();
    };
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [status.logs.length]);

  const importPct = useMemo(() => {
    const limit = status.import.limit || status.config.limit || config.limit || 1;
    return Math.max(0, Math.min(100, Math.round((status.import.imported / limit) * 100)));
  }, [config.limit, status.config.limit, status.import.imported, status.import.limit]);
  const delta =
    status.train.baselineTop1 === null || status.train.tunedTop1 === null
      ? null
      : status.train.tunedTop1 - status.train.baselineTop1;
  const canStart = !status.active && !submitting;
  const canStop = status.active && !submitting;

  const patchConfig = (patch: Partial<TrainingConfig>) => setConfig((prev) => ({ ...prev, ...patch }));
  const patchNumber = (key: keyof Pick<TrainingConfig, 'depth' | 'limit' | 'maxPlies' | 'minElo' | 'sampleEvery' | 'epochs'>, value: string) => {
    const parsed = Number(value);
    patchConfig({ [key]: Number.isFinite(parsed) ? parsed : 0 } as Partial<TrainingConfig>);
  };

  const start = async () => {
    setSubmitting(true);
    setRequestError('');
    try {
      const res = await fetch('/api/training/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'start failed');
      setStatus(body as TrainingStatus);
    } catch (e) {
      setRequestError(String((e as Error)?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  };

  const stop = async () => {
    setSubmitting(true);
    setRequestError('');
    try {
      const res = await fetch('/api/training/stop', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'stop failed');
      setStatus(body as TrainingStatus);
    } catch (e) {
      setRequestError(String((e as Error)?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...card, padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <PhaseBadge phase={status.phase} active={status.active} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            started {formatTime(status.startedAt)} / ended {formatTime(status.endedAt)}
          </span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
            <button onClick={start} disabled={!canStart} style={{ ...startBtn, opacity: canStart ? 1 : 0.5, cursor: canStart ? 'pointer' : 'not-allowed' }}>
              Start
            </button>
            <button onClick={stop} disabled={!canStop} style={{ ...stopBtn, opacity: canStop ? 1 : 0.5, cursor: canStop ? 'pointer' : 'not-allowed' }}>
              Stop
            </button>
          </span>
        </div>
        {(requestError || status.error) && (
          <div style={{ marginTop: 10, color: 'var(--bad)', fontSize: 13 }}>
            {requestError || status.error}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <section style={{ ...card, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Segmented
              value={config.mode}
              onChange={(mode) => patchConfig({ mode })}
              disabled={status.active}
            />
          </div>

          <Field labelText={config.mode === 'import-train' ? 'PGN or .pgn.zst input' : 'Existing dataset JSONL'}>
            <input
              value={config.mode === 'import-train' ? config.input : config.datasetOut}
              onChange={(e) =>
                config.mode === 'import-train'
                  ? patchConfig({ input: e.target.value })
                  : patchConfig({ datasetOut: e.target.value })
              }
              disabled={status.active}
              style={input}
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field labelText="Dataset out">
              <input value={config.datasetOut} onChange={(e) => patchConfig({ datasetOut: e.target.value })} disabled={status.active} style={input} />
            </Field>
            <Field labelText="Weights out">
              <input value={config.weightsOut} onChange={(e) => patchConfig({ weightsOut: e.target.value })} disabled={status.active} style={input} />
            </Field>
          </div>
          <Field labelText="Report out">
            <input value={config.reportOut} onChange={(e) => patchConfig({ reportOut: e.target.value })} disabled={status.active} style={input} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            <NumberField labelText="Depth" value={config.depth} onChange={(v) => patchNumber('depth', v)} disabled={status.active || config.mode === 'train-only'} />
            <NumberField labelText="Games" value={config.limit} onChange={(v) => patchNumber('limit', v)} disabled={status.active || config.mode === 'train-only'} />
            <NumberField labelText="Max plies" value={config.maxPlies} onChange={(v) => patchNumber('maxPlies', v)} disabled={status.active || config.mode === 'train-only'} />
            <NumberField labelText="Min Elo" value={config.minElo} onChange={(v) => patchNumber('minElo', v)} disabled={status.active || config.mode === 'train-only'} />
            <NumberField labelText="Sample every" value={config.sampleEvery} onChange={(v) => patchNumber('sampleEvery', v)} disabled={status.active || config.mode === 'train-only'} />
            <NumberField labelText="Epochs" value={config.epochs} onChange={(v) => patchNumber('epochs', v)} disabled={status.active} />
          </div>
        </section>

        <section style={{ ...card, padding: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 14 }}>
            <Metric title="Imported games" value={`${status.import.imported}/${status.import.limit || config.limit}`} sub={`${status.import.rows.toLocaleString()} rows`} />
            <Metric title="Games scanned" value={status.import.seen.toLocaleString()} sub={`${status.import.skipped.toLocaleString()} skipped`} />
            <Metric title="Training rows" value={status.train.trainRows.toLocaleString()} sub={`${status.train.holdoutRows.toLocaleString()} holdout`} />
          </div>
          <Progress labelText="Import progress" pct={importPct} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 14 }}>
            <Metric title="Default top-1" value={formatPct(status.train.baselineTop1)} sub="holdout" />
            <Metric title="Tuned top-1" value={formatPct(status.train.tunedTop1)} sub="holdout" />
            <Metric title="Delta" value={delta === null ? '--' : signedPct(delta)} sub={status.phase === 'done' ? 'written' : 'pending'} />
          </div>
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr', gap: 6, fontSize: 12, color: 'var(--text-soft)' }}>
            <Artifact labelText="Dataset" value={status.config.datasetOut} />
            <Artifact labelText="Weights" value={status.config.weightsOut} />
            <Artifact labelText="Report" value={status.config.reportOut} />
          </div>
        </section>
      </div>

      <section style={{ ...card, padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Live log</h3>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{status.logs.length} lines</span>
        </div>
        <div
          ref={logRef}
          style={{
            minHeight: 220,
            maxHeight: 360,
            overflowY: 'auto',
            background: 'var(--text)',
            color: '#e4e7ec',
            borderRadius: 6,
            padding: 10,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 12,
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
          }}
        >
          {status.logs.length ? status.logs.join('\n') : 'idle'}
        </div>
      </section>
    </div>
  );
}

function Field({ labelText, children }: { labelText: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={label}>{labelText}</span>
      {children}
    </label>
  );
}

function NumberField({
  labelText,
  value,
  onChange,
  disabled,
}: {
  labelText: string;
  value: number;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <Field labelText={labelText}>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={input}
      />
    </Field>
  );
}

function Segmented({
  value,
  onChange,
  disabled,
}: {
  value: TrainingConfig['mode'];
  onChange: (value: TrainingConfig['mode']) => void;
  disabled: boolean;
}) {
  const options: Array<{ id: TrainingConfig['mode']; label: string }> = [
    { id: 'import-train', label: 'Import + train' },
    { id: 'train-only', label: 'Train only' },
  ];
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #d0d5dd', borderRadius: 6, overflow: 'hidden' }}>
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            disabled={disabled}
            style={{
              border: 0,
              borderRight: o.id === 'import-train' ? '1px solid #d0d5dd' : 0,
              background: active ? 'var(--track)' : '#fff',
              color: active ? 'var(--accent-light)' : 'var(--text)',
              padding: '7px 11px',
              fontSize: 13,
              fontWeight: active ? 700 : 500,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Metric({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div style={{ border: '1px solid #eef0f3', borderRadius: 6, padding: 10, minHeight: 64 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 750, color: 'var(--text)', marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>
    </div>
  );
}

function Progress({ labelText, pct }: { labelText: string; pct: number }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
        <span>{labelText}</span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: 8, background: 'var(--track)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', transition: 'width 0.2s' }} />
      </div>
    </div>
  );
}

function Artifact({ labelText, value }: { labelText: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', gap: 8 }}>
      <span style={{ color: 'var(--muted)' }}>{labelText}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={value}>
        {value}
      </span>
    </div>
  );
}

function PhaseBadge({ phase, active }: { phase: TrainingPhase; active: boolean }) {
  const colors: Record<TrainingPhase, { bg: string; fg: string }> = {
    idle: { bg: '#f2f4f7', fg: 'var(--text)' },
    importing: { bg: 'var(--track)', fg: 'var(--accent-light)' },
    training: { bg: '#fff4e5', fg: '#9a5b00' },
    done: { bg: '#e7f8ed', fg: '#1f7a3f' },
    error: { bg: '#fee4e2', fg: 'var(--bad)' },
    stopped: { bg: '#f2f4f7', fg: 'var(--text-soft)' },
  };
  const c = colors[phase];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: c.bg,
        color: c.fg,
        borderRadius: 999,
        padding: '3px 9px',
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {active && <span style={{ width: 6, height: 6, borderRadius: 999, background: c.fg, display: 'inline-block' }} />}
      {phase}
    </span>
  );
}

function formatPct(value: number | null): string {
  return value === null ? '--' : `${(value * 100).toFixed(1)}%`;
}

function signedPct(value: number): string {
  const pct = value * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function formatTime(value: string | null): string {
  if (!value) return '--';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
