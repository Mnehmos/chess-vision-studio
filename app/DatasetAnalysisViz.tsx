// Dataset-wide analysis view — renders a pre-computed DatasetAnalysis. The star is
// the time-of-day breakdown (do you play better in the morning or at night?); below
// it: analysis coverage, overall accuracy by side, class distribution, and the
// biggest teaching moments across every game. No computation here — display only.
import type { DatasetAnalysis, TimeBucket, SideStats, DatasetWorstMove } from '../engine/dataset-analytics';

// Classification colors + canonical order (shared visual grammar with the review panel).
const CLASS_COLOR: Record<string, string> = {
  best: '#2f855a',
  excellent: '#3fbf5f',
  good: 'var(--accent-light)',
  inaccuracy: '#e8923b',
  mistake: '#e2603b',
  blunder: '#e23b3b',
};
const CLASS_ORDER = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'] as const;

// Team colors mirror the board: White = blue, Black = red.
const TEAM = { w: 'var(--accent)', b: '#d43b3b' } as const;

const card: React.CSSProperties = {
  border: '1px solid #e6e8eb',
  borderRadius: 10,
  padding: 16,
  boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
  background: 'var(--card)',
};

const num = (n: number) => n.toLocaleString();
const pctOf = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

export function DatasetAnalysisViz({
  analysis,
  onOpenGame,
}: {
  analysis: DatasetAnalysis;
  onOpenGame: (gameIndex: number) => void;
}): JSX.Element {
  const { hero, coverage, overall, worst, timeOfDay } = analysis;
  const hasAnalysis = coverage.pliesAnalyzed > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 1) Coverage — what fraction of the data these charts are built from. */}
      <div style={card}>
        <Coverage coverage={coverage} hasAnalysis={hasAnalysis} />
      </div>

      {/* 2) Time of day — the headline. Works from results even without analysis. */}
      <div style={card}>
        <TimeOfDay buckets={timeOfDay} hero={hero} />
      </div>

      {/* 3) Overall accuracy by side. */}
      <div style={card}>
        <h3 style={{ margin: '0 0 8px' }}>Overall accuracy by side</h3>
        {hasAnalysis ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SideRow title="White" color={TEAM.w} s={overall.white} />
            <SideRow title="Black" color={TEAM.b} s={overall.black} />
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Run an analysis pass to see your accuracy split by side.
          </div>
        )}
      </div>

      {/* 4) Biggest teaching moments — jump straight into the game. */}
      <div style={card}>
        <TeachingMoments worst={worst} hasAnalysis={hasAnalysis} onOpenGame={onOpenGame} />
      </div>
    </div>
  );
}

// ── 1) coverage ──────────────────────────────────────────────────────────────
function Coverage({ coverage, hasAnalysis }: { coverage: DatasetAnalysis['coverage']; hasAnalysis: boolean }) {
  const { gamesTotal, gamesAnalyzed, gamesFull, pliesTotal, pliesAnalyzed } = coverage;
  const pct = pctOf(pliesAnalyzed, pliesTotal);
  return (
    <div>
      <h3 style={{ margin: '0 0 6px' }}>Coverage</h3>
      <div style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 8 }}>
        Analyzed {num(pliesAnalyzed)} / {num(pliesTotal)} moves · {num(gamesFull)} / {num(gamesTotal)} games fully
        reviewed
        {gamesAnalyzed > gamesFull && (
          <span style={{ color: 'var(--muted)' }}> · {num(gamesAnalyzed)} touched</span>
        )}
      </div>
      <div style={{ height: 6, background: 'var(--track)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)' }} />
      </div>
      {!hasAnalysis && (
        <div style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>
          Run “Analyze all games” to populate these charts. Your time-of-day results below still work without it.
        </div>
      )}
    </div>
  );
}

// ── 2) time of day (the star) ────────────────────────────────────────────────
// Fixed display order, morning-first, so the daily arc reads naturally.
const TOD_ORDER = ['morning', 'afternoon', 'evening', 'night'] as const;

function TimeOfDay({ buckets, hero }: { buckets: TimeBucket[]; hero: string | null }) {
  // Reorder to the natural daily arc, keeping any unexpected keys at the end.
  const ordered = [...buckets].sort((a, b) => orderIndex(a.key) - orderIndex(b.key));
  const played = ordered.filter((b) => b.games > 0);
  const anyAccuracy = played.some((b) => b.analyzedPlies > 0 && b.accuracy !== null);

  // Best bucket = highest score% among buckets actually played.
  let bestKey: string | null = null;
  let bestPct = -1;
  for (const b of played) {
    if (b.scorePct !== null && b.scorePct > bestPct) {
      bestPct = b.scorePct;
      bestKey = b.key;
    }
  }
  const best = played.find((b) => b.key === bestKey) ?? null;

  return (
    <div>
      <h3 style={{ margin: '0 0 2px' }}>When you play your best</h3>
      <div style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 10 }}>
        {best
          ? <>
              {hero ? `${hero}, you` : 'You'} score highest in the{' '}
              <strong style={{ color: 'var(--text)' }}>{best.label.toLowerCase()}</strong>
              {best.scorePct !== null && <> — {best.scorePct.toFixed(0)}% there. </>}
              {anyAccuracy && best.accuracy !== null
                ? ` Your accuracy follows along too.`
                : ' Analyze some games to see accuracy by time.'}
            </>
          : 'No games found with a known time of day yet.'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {played.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>No timestamped games to chart.</div>
        ) : (
          played.map((b) => (
            <TimeRow key={b.key} b={b} isBest={b.key === bestKey} showAccuracy={anyAccuracy} />
          ))
        )}
      </div>
    </div>
  );
}

function TimeRow({ b, isBest, showAccuracy }: { b: TimeBucket; isBest: boolean; showAccuracy: boolean }) {
  const scorePct = b.scorePct ?? 0;
  const acc = b.analyzedPlies > 0 ? b.accuracy : null;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '110px 64px 1fr',
        gap: 10,
        alignItems: 'center',
        padding: '4px 6px',
        borderRadius: 6,
        background: isBest ? '#f3f8ff' : 'transparent',
      }}
    >
      {/* Label + games */}
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
          {isBest ? '★ ' : ''}
          {b.label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          {num(b.games)} game{b.games === 1 ? '' : 's'}
        </div>
      </div>

      {/* Score% number */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 16, fontWeight: isBest ? 700 : 600, color: scoreColor(b.scorePct) }}>
          {b.scorePct === null ? '—' : `${b.scorePct.toFixed(0)}%`}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>score</div>
      </div>

      {/* Bars: score (filled) and, when analyzed, accuracy underneath. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Meter pct={scorePct} color={scoreColor(b.scorePct)} bg="#eef0f3" />
        {showAccuracy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Meter pct={acc ?? 0} color={accColor(acc ?? 0)} bg="#f5f6f8" height={5} />
            <span style={{ fontSize: 10, color: 'var(--muted)', minWidth: 70, textAlign: 'right' }}>
              {acc === null ? 'no analysis' : `${acc.toFixed(0)}% accurate`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function orderIndex(key: string): number {
  const i = (TOD_ORDER as readonly string[]).indexOf(key);
  return i === -1 ? TOD_ORDER.length : i;
}

// ── 3) accuracy by side ──────────────────────────────────────────────────────
function SideRow({ title, color, s }: { title: string; color: string; s: SideStats }) {
  const total = s.moves || 1;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color }}>{title}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: accColor(s.accuracy) }}>
          {s.accuracy.toFixed(0)}% accuracy
        </span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {num(s.moves)} moves · avg loss {s.avgCpLoss.toFixed(2)}
        </span>
      </div>
      {/* Stacked classification distribution. */}
      <div style={{ display: 'flex', height: 14, borderRadius: 3, overflow: 'hidden', background: 'var(--track)' }}>
        {CLASS_ORDER.map((c) => {
          const v = s.byClass[c] ?? 0;
          const w = pctOf(v, total);
          return w > 0 ? (
            <div key={c} title={`${v} ${c}`} style={{ width: `${w}%`, background: CLASS_COLOR[c] }} />
          ) : null;
        })}
      </div>
      <div style={{ marginTop: 4, fontSize: 11, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {CLASS_ORDER.filter((c) => (s.byClass[c] ?? 0) > 0).map((c) => (
          <span key={c} style={{ color: CLASS_COLOR[c] }}>
            {num(s.byClass[c] ?? 0)} {c}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── 4) teaching moments ──────────────────────────────────────────────────────
function TeachingMoments({
  worst,
  hasAnalysis,
  onOpenGame,
}: {
  worst: DatasetWorstMove[];
  hasAnalysis: boolean;
  onOpenGame: (gameIndex: number) => void;
}) {
  const rows = worst.slice(0, 10);
  return (
    <div>
      <h3 style={{ margin: '0 0 8px' }}>Biggest teaching moments</h3>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {hasAnalysis
            ? 'No costly moves found — clean play across the set.'
            : 'Analyze your games to surface the moments worth revisiting.'}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((m, i) => (
            <li
              key={`${m.gameIndex}-${m.ply}-${i}`}
              onClick={() => onOpenGame(m.gameIndex)}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 64px 96px 56px',
                gap: 10,
                alignItems: 'center',
                cursor: 'pointer',
                padding: '5px 6px',
                borderTop: i === 0 ? 'none' : '1px solid #f0f0f0',
                borderLeft: `3px solid ${TEAM[m.color]}`,
                paddingLeft: 8,
                fontSize: 13,
              }}
              title={`${m.gameLabel} — open game`}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-soft)' }}>
                {m.gameLabel}
              </span>
              <span style={{ fontWeight: 600, color: 'var(--text-soft)' }}>{m.move}</span>
              <span style={{ color: CLASS_COLOR[m.classification] ?? 'var(--text-soft)' }}>{m.classification}</span>
              <span style={{ textAlign: 'right', color: 'var(--muted)' }}>−{m.cpLoss.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── primitives ───────────────────────────────────────────────────────────────
function Meter({ pct, color, bg, height = 8 }: { pct: number; color: string; bg: string; height?: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ flex: 1, height, background: bg, borderRadius: height / 2, overflow: 'hidden' }}>
      <div style={{ width: `${w}%`, height: '100%', background: color }} />
    </div>
  );
}

// A win-rate-ish score: green at 60%+, encouraging amber in the middle.
function scoreColor(pct: number | null): string {
  if (pct === null) return 'var(--muted)';
  if (pct >= 60) return '#2f855a';
  if (pct >= 50) return '#3fbf5f';
  if (pct >= 40) return '#e8923b';
  return '#e2603b';
}

function accColor(acc: number): string {
  if (acc >= 85) return '#2f855a';
  if (acc >= 70) return 'var(--accent-light)';
  if (acc >= 55) return '#e8923b';
  return '#e23b3b';
}
