import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

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

const DEFAULT_TRAINING_REVIEW_DEPTH = 24;

const DEFAULT_CONFIG: TrainingConfig = {
  mode: 'import-train',
  input: 'fixtures/sample-game.pgn',
  datasetOut: 'arena/out/lichess-master-dataset.jsonl',
  weightsOut: 'arena/out/weights.json',
  reportOut: 'arena/out/train-report.json',
  depth: DEFAULT_TRAINING_REVIEW_DEPTH,
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
  const patchNumber = (
    key: keyof Pick<TrainingConfig, 'depth' | 'limit' | 'maxPlies' | 'minElo' | 'sampleEvery' | 'epochs'>,
    value: string,
  ) => {
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
    <div className="training-monitor">
      <section className="training-monitor__card training-monitor__status-card">
        <div className="training-monitor__toolbar">
          <PhaseBadge phase={status.phase} active={status.active} />
          <span className="training-monitor__times">
            started {formatTime(status.startedAt)} / ended {formatTime(status.endedAt)}
          </span>
          <span className="training-monitor__actions">
            <button
              className="training-monitor__button training-monitor__button--start"
              onClick={start}
              disabled={!canStart}
            >
              Start
            </button>
            <button
              className="training-monitor__button training-monitor__button--stop"
              onClick={stop}
              disabled={!canStop}
            >
              Stop
            </button>
          </span>
        </div>
        {(requestError || status.error) && (
          <div className="training-monitor__error">{requestError || status.error}</div>
        )}
      </section>

      <div className="training-monitor__grid">
        <section className="training-monitor__card">
          <div className="training-monitor__segment-row">
            <Segmented
              value={config.mode}
              onChange={(mode) => patchConfig({ mode })}
              disabled={status.active}
            />
          </div>

          <Field labelText={config.mode === 'import-train' ? 'PGN or .pgn.zst input' : 'Existing dataset JSONL'}>
            <input
              className="training-monitor__input"
              value={config.mode === 'import-train' ? config.input : config.datasetOut}
              onChange={(e) =>
                config.mode === 'import-train'
                  ? patchConfig({ input: e.target.value })
                  : patchConfig({ datasetOut: e.target.value })
              }
              disabled={status.active}
            />
          </Field>

          <div className="training-monitor__path-grid">
            <Field labelText="Dataset out">
              <input
                className="training-monitor__input"
                value={config.datasetOut}
                onChange={(e) => patchConfig({ datasetOut: e.target.value })}
                disabled={status.active}
              />
            </Field>
            <Field labelText="Weights out">
              <input
                className="training-monitor__input"
                value={config.weightsOut}
                onChange={(e) => patchConfig({ weightsOut: e.target.value })}
                disabled={status.active}
              />
            </Field>
          </div>
          <Field labelText="Report out">
            <input
              className="training-monitor__input"
              value={config.reportOut}
              onChange={(e) => patchConfig({ reportOut: e.target.value })}
              disabled={status.active}
            />
          </Field>

          <div className="training-monitor__param-grid">
            <NumberField labelText="Depth" value={config.depth} onChange={(v) => patchNumber('depth', v)} disabled={status.active || config.mode === 'train-only'} />
            <NumberField labelText="Games" value={config.limit} onChange={(v) => patchNumber('limit', v)} disabled={status.active || config.mode === 'train-only'} />
            <NumberField labelText="Max plies" value={config.maxPlies} onChange={(v) => patchNumber('maxPlies', v)} disabled={status.active || config.mode === 'train-only'} />
            <NumberField labelText="Min Elo" value={config.minElo} onChange={(v) => patchNumber('minElo', v)} disabled={status.active || config.mode === 'train-only'} />
            <NumberField labelText="Sample every" value={config.sampleEvery} onChange={(v) => patchNumber('sampleEvery', v)} disabled={status.active || config.mode === 'train-only'} />
            <NumberField labelText="Epochs" value={config.epochs} onChange={(v) => patchNumber('epochs', v)} disabled={status.active} />
          </div>
        </section>

        <section className="training-monitor__card">
          <div className="training-monitor__metric-grid">
            <Metric title="Imported games" value={`${status.import.imported}/${status.import.limit || config.limit}`} sub={`${status.import.rows.toLocaleString()} rows`} />
            <Metric title="Games scanned" value={status.import.seen.toLocaleString()} sub={`${status.import.skipped.toLocaleString()} skipped`} />
            <Metric title="Training rows" value={status.train.trainRows.toLocaleString()} sub={`${status.train.holdoutRows.toLocaleString()} holdout`} />
          </div>
          <Progress labelText="Import progress" pct={importPct} />
          <div className="training-monitor__metric-grid training-monitor__metric-grid--spaced">
            <Metric title="Default top-1" value={formatPct(status.train.baselineTop1)} sub="holdout" />
            <Metric title="Tuned top-1" value={formatPct(status.train.tunedTop1)} sub="holdout" />
            <Metric title="Delta" value={delta === null ? '--' : signedPct(delta)} sub={status.phase === 'done' ? 'written' : 'pending'} />
          </div>
          <div className="training-monitor__artifact-list">
            <Artifact labelText="Dataset" value={status.config.datasetOut} />
            <Artifact labelText="Weights" value={status.config.weightsOut} />
            <Artifact labelText="Report" value={status.config.reportOut} />
          </div>
        </section>
      </div>

      <section className="training-monitor__card">
        <div className="training-monitor__log-header">
          <h3 className="training-monitor__log-title">Live log</h3>
          <span className="training-monitor__log-count">{status.logs.length} lines</span>
        </div>
        <div ref={logRef} className="training-monitor__log-body">
          {status.logs.length ? status.logs.join('\n') : 'idle'}
        </div>
      </section>
    </div>
  );
}

function Field({ labelText, children }: { labelText: string; children: ReactNode }) {
  return (
    <label className="training-monitor__field">
      <span className="training-monitor__label">{labelText}</span>
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
        className="training-monitor__input"
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
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
    <div className="training-monitor__segmented">
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            className={`training-monitor__segment${active ? ' is-active' : ''}`}
            onClick={() => onChange(o.id)}
            disabled={disabled}
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
    <div className="training-monitor__metric">
      <div className="training-monitor__metric-title">{title}</div>
      <div className="training-monitor__metric-value">{value}</div>
      <div className="training-monitor__metric-sub">{sub}</div>
    </div>
  );
}

function Progress({ labelText, pct }: { labelText: string; pct: number }) {
  return (
    <div>
      <div className="training-monitor__progress-header">
        <span>{labelText}</span>
        <span>{pct}%</span>
      </div>
      <div className="training-monitor__progress-track">
        <div className="training-monitor__progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Artifact({ labelText, value }: { labelText: string; value: string }) {
  return (
    <div className="training-monitor__artifact">
      <span className="training-monitor__artifact-label">{labelText}</span>
      <span className="training-monitor__artifact-value" title={value}>
        {value}
      </span>
    </div>
  );
}

function PhaseBadge({ phase, active }: { phase: TrainingPhase; active: boolean }) {
  return (
    <span className={`training-monitor__phase training-monitor__phase--${phase}`}>
      {active && <span className="training-monitor__phase-dot" />}
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
