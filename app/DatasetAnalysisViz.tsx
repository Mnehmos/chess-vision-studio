// Dataset-wide analysis view - renders a pre-computed DatasetAnalysis. The star is
// the time-of-day breakdown; below it: analysis coverage, accuracy by side,
// class distribution, and the biggest teaching moments across every game.
import type {
  DatasetAnalysis,
  DatasetWorstMove,
  SideStats,
  TimeBucket,
} from '../engine/dataset-analytics';

const CLASS_ORDER = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'] as const;

type MeterTone = 'accent' | 'good' | 'ok' | 'warn' | 'mistake' | 'bad' | 'muted';

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
  const hasAnalysis = coverage.pliesAnalyzed >= 50;
  const coveragePct = coverage.pliesTotal ? (coverage.pliesAnalyzed / coverage.pliesTotal) * 100 : 0;

  return (
    <div className="dataset-analysis">
      <section className="dataset-analysis__card">
        <Coverage coverage={coverage} hasAnalysis={hasAnalysis} />
        {coveragePct < 100 && (
          <div className="dataset-analysis__warning">
            Everything below reflects only the {coveragePct < 1 ? '<1' : Math.round(coveragePct)}%
            analyzed so far - run <strong>Analyze all games</strong> above for the full picture.
          </div>
        )}
      </section>

      <section className="dataset-analysis__card">
        <TimeOfDay buckets={timeOfDay} hero={hero} />
      </section>

      <section className="dataset-analysis__card">
        <h3 className="dataset-analysis__section-title">Overall accuracy by side</h3>
        {hasAnalysis ? (
          <div className="dataset-analysis__side-list">
            <SideRow title="White" side="w" s={overall.white} />
            <SideRow title="Black" side="b" s={overall.black} />
          </div>
        ) : (
          <div className="dataset-analysis__muted">
            Not enough analyzed moves yet for a reliable accuracy split - run "Analyze all games".
          </div>
        )}
      </section>

      <section className="dataset-analysis__card">
        <TeachingMoments worst={worst} hasAnalysis={hasAnalysis} onOpenGame={onOpenGame} />
      </section>
    </div>
  );
}

function Coverage({ coverage, hasAnalysis }: { coverage: DatasetAnalysis['coverage']; hasAnalysis: boolean }) {
  const { gamesTotal, gamesAnalyzed, gamesFull, pliesTotal, pliesAnalyzed } = coverage;
  const pct = pctOf(pliesAnalyzed, pliesTotal);
  return (
    <div>
      <h3 className="dataset-analysis__section-title dataset-analysis__section-title--tight">
        Coverage
      </h3>
      <div className="dataset-analysis__subcopy">
        Analyzed {num(pliesAnalyzed)} / {num(pliesTotal)} moves - {num(gamesFull)} /{' '}
        {num(gamesTotal)} games fully reviewed
        {gamesAnalyzed > gamesFull && (
          <span className="dataset-analysis__muted"> - {num(gamesAnalyzed)} touched</span>
        )}
      </div>
      <Meter pct={pct} tone="accent" size="thin" />
      {!hasAnalysis && (
        <div className="dataset-analysis__muted dataset-analysis__note">
          Run "Analyze all games" to populate these charts. Your time-of-day results below still
          work without it.
        </div>
      )}
    </div>
  );
}

const TOD_ORDER = ['morning', 'afternoon', 'evening', 'night'] as const;

function TimeOfDay({ buckets, hero }: { buckets: TimeBucket[]; hero: string | null }) {
  const ordered = [...buckets].sort((a, b) => orderIndex(a.key) - orderIndex(b.key));
  const played = ordered.filter((b) => b.games > 0);
  const anyAccuracy = played.some((b) => b.analyzedPlies > 0 && b.accuracy !== null);

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
      <h3 className="dataset-analysis__section-title dataset-analysis__section-title--compact">
        When you play your best
      </h3>
      <div className="dataset-analysis__subcopy dataset-analysis__subcopy--spaced">
        {best ? (
          <>
            {hero ? `${hero}, you` : 'You'} score highest in the{' '}
            <strong className="dataset-analysis__strong">{best.label.toLowerCase()}</strong>
            {best.scorePct !== null && <> - {best.scorePct.toFixed(0)}% there. </>}
            {anyAccuracy && best.accuracy !== null
              ? ' Your accuracy follows along too.'
              : ' Analyze some games to see accuracy by time.'}
          </>
        ) : (
          'No games found with a known time of day yet.'
        )}
      </div>

      <div className="dataset-analysis__time-list">
        {played.length === 0 ? (
          <div className="dataset-analysis__muted">No timestamped games to chart.</div>
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
    <div className={`dataset-analysis__time-row${isBest ? ' is-best' : ''}`}>
      <div>
        <div className="dataset-analysis__time-label">
          {isBest ? '* ' : ''}
          {b.label}
        </div>
        <div className="dataset-analysis__time-games">
          {num(b.games)} game{b.games === 1 ? '' : 's'}
        </div>
      </div>

      <div className="dataset-analysis__score-block">
        <div className={`dataset-analysis__score-value dataset-analysis__score-value--${scoreTone(b.scorePct)}`}>
          {b.scorePct === null ? '-' : `${b.scorePct.toFixed(0)}%`}
        </div>
        <div className="dataset-analysis__score-label">score</div>
      </div>

      <div className="dataset-analysis__meter-stack">
        <Meter pct={scorePct} tone={scoreTone(b.scorePct)} />
        {showAccuracy && (
          <div className="dataset-analysis__accuracy-row">
            <Meter pct={acc ?? 0} tone={accTone(acc ?? 0)} size="small" />
            <span className="dataset-analysis__accuracy-label">
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

function SideRow({ title, side, s }: { title: string; side: 'w' | 'b'; s: SideStats }) {
  const total = s.moves || 1;
  return (
    <div className="dataset-analysis__side-row">
      <div className="dataset-analysis__side-header">
        <span className={`dataset-analysis__side-title dataset-analysis__side-title--${side}`}>
          {title}
        </span>
        <span className={`dataset-analysis__accuracy dataset-analysis__accuracy--${accTone(s.accuracy)}`}>
          {s.accuracy.toFixed(0)}% accuracy
        </span>
        <span className="dataset-analysis__muted">
          {num(s.moves)} moves - avg loss {s.avgCpLoss.toFixed(2)}
        </span>
      </div>
      <div className="dataset-analysis__class-stack">
        {CLASS_ORDER.map((c) => {
          const v = s.byClass[c] ?? 0;
          const w = pctOf(v, total);
          return w > 0 ? (
            <div
              key={c}
              className={`dataset-analysis__class-segment dataset-analysis__class--${c}`}
              title={`${v} ${c}`}
              style={{ width: `${w}%` }}
            />
          ) : null;
        })}
      </div>
      <div className="dataset-analysis__class-legend">
        {CLASS_ORDER.filter((c) => (s.byClass[c] ?? 0) > 0).map((c) => (
          <span key={c} className={`dataset-analysis__class-label dataset-analysis__class-text--${c}`}>
            {num(s.byClass[c] ?? 0)} {c}
          </span>
        ))}
      </div>
    </div>
  );
}

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
      <h3 className="dataset-analysis__section-title">Biggest teaching moments</h3>
      {rows.length === 0 ? (
        <div className="dataset-analysis__muted">
          {hasAnalysis
            ? 'No costly moves found - clean play across the set.'
            : 'Analyze your games to surface the moments worth revisiting.'}
        </div>
      ) : (
        <ul className="dataset-analysis__moments">
          {rows.map((m, i) => (
            <li
              key={`${m.gameIndex}-${m.ply}-${i}`}
              className={`dataset-analysis__moment dataset-analysis__moment--${m.color}`}
              onClick={() => onOpenGame(m.gameIndex)}
              title={`${m.gameLabel} - open game`}
            >
              <span className="dataset-analysis__moment-game">{m.gameLabel}</span>
              <span className="dataset-analysis__moment-move">{m.move}</span>
              <span className={`dataset-analysis__class-text--${m.classification}`}>
                {m.classification}
              </span>
              <span className="dataset-analysis__moment-loss">-{m.cpLoss.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Meter({ pct, tone, size = 'normal' }: { pct: number; tone: MeterTone; size?: 'normal' | 'small' | 'thin' }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className={`dataset-meter dataset-meter--${size}`}>
      <div className={`dataset-meter__fill dataset-meter__fill--${tone}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function scoreTone(pct: number | null): MeterTone {
  if (pct === null) return 'muted';
  if (pct >= 60) return 'good';
  if (pct >= 50) return 'ok';
  if (pct >= 40) return 'warn';
  return 'mistake';
}

function accTone(acc: number): MeterTone {
  if (acc >= 85) return 'good';
  if (acc >= 70) return 'ok';
  if (acc >= 55) return 'warn';
  return 'bad';
}
