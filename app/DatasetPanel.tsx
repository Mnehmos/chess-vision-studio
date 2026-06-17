// Dataset view - OpeningTree-style aggregation over a full game export:
// a position-keyed move explorer, hero record by color/opening, score over time,
// and dataset-wide review summaries.
import { useMemo, useState } from 'react';
import type { ParsedGame } from '../engine/position';
import { computeDataset, type Record4 } from '../engine/dataset';
import { buildOpeningTree, movesFrom, type MoveStat } from '../engine/repertoire';
import { computeDatasetAnalysis, type AnalysisCache } from '../engine/dataset-analytics';
import { DatasetAnalysisViz } from './DatasetAnalysisViz';

const WIN = '#3fbf5f';
const DRAW = '#b9b9b9';
const LOSS = '#e2603b';
const W_RES = '#7ba3d0';
const D_RES = '#c4c4c4';
const B_RES = '#4a4a4a';

export function DatasetPanel({
  games,
  engineReady,
  analysisProgress,
  cache,
  cacheVersion,
  keyOf,
  onAnalyzeAll,
  onOpenGame,
}: {
  games: ParsedGame[];
  engineReady: boolean;
  analysisProgress: {
    running: boolean;
    done: number;
    total: number;
    gamesDone: number;
    gamesTotal: number;
    currentGame: string;
  };
  cache: AnalysisCache;
  cacheVersion: number;
  keyOf: (g: ParsedGame) => string;
  onAnalyzeAll: () => void;
  onOpenGame: (index: number) => void;
}) {
  const ds = useMemo(() => computeDataset(games), [games]);
  const tree = useMemo(() => buildOpeningTree(games), [games]);
  const hero = ds.hero ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const datasetAnalysis = useMemo(
    () => computeDatasetAnalysis(games, cache, keyOf, hero),
    [games, cache, keyOf, hero, cacheVersion],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const analyzedByIndex = useMemo(() => {
    const m = new Map<number, { done: number; total: number }>();
    for (const g of games) m.set(g.index, { done: cache.get(keyOf(g))?.size ?? 0, total: g.plies.length });
    return m;
  }, [games, cache, keyOf, cacheVersion]);

  const pct = analysisProgress.total
    ? Math.round((analysisProgress.done / analysisProgress.total) * 100)
    : 0;
  const disabled = !engineReady || analysisProgress.running;

  return (
    <div className="dataset-panel">
      <div className="dataset-panel__analyze">
        <div className="dataset-panel__analyze-row">
          <div className="dataset-panel__analyze-copy">
            {analysisProgress.running ? (
              <>
                <strong className="dataset-panel__strong">
                  Analyzing game {Math.min(analysisProgress.gamesDone + 1, analysisProgress.gamesTotal)}
                  /{analysisProgress.gamesTotal}
                </strong>{' '}
                - {analysisProgress.done.toLocaleString()}/{analysisProgress.total.toLocaleString()} moves - {pct}%
                {analysisProgress.currentGame && (
                  <div className="dataset-panel__current-game">{analysisProgress.currentGame}</div>
                )}
              </>
            ) : (
              'Dataset analysis is cached per game once run.'
            )}
          </div>
          <button className="dataset-panel__analyze-button" onClick={onAnalyzeAll} disabled={disabled}>
            {analysisProgress.running ? `Analyzing... ${pct}%` : 'Analyze all games'}
          </button>
        </div>
        {analysisProgress.running && (
          <div className="dataset-panel__progress-track">
            <div className="dataset-panel__progress-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <div className="dataset-panel__main-grid">
        <section className="dataset-panel__card dataset-panel__card--summary">
          <h3 className="dataset-panel__headline">
            {ds.hero ? `${ds.hero} - ` : ''}
            {ds.totalGames} games
          </h3>

          {ds.hero && <HeroRecord ds={ds} />}

          <h4 className="dataset-panel__section-title">
            {ds.hero ? 'Your results across all games' : 'Results across all games'}
          </h4>
          {ds.hero && ds.heroRecord ? (
            <>
              <StackedBar
                height={16}
                segments={[
                  { value: ds.heroRecord.wins, color: WIN, label: 'Your wins' },
                  { value: ds.heroRecord.draws, color: DRAW, label: 'Draws' },
                  { value: ds.heroRecord.losses, color: LOSS, label: 'Your losses' },
                ]}
              />
              <Legend items={[['Your wins', WIN], ['Draws', DRAW], ['Your losses', LOSS]]} />
            </>
          ) : (
            <>
              <StackedBar
                height={16}
                segments={[
                  { value: ds.byResult.whiteWins, color: W_RES, label: 'White wins' },
                  { value: ds.byResult.draws, color: D_RES, label: 'Draws' },
                  { value: ds.byResult.blackWins, color: B_RES, label: 'Black wins' },
                ]}
              />
              <Legend items={[['White wins', W_RES], ['Draws', D_RES], ['Black wins', B_RES]]} />
            </>
          )}

          {ds.hero && (
            <>
              <h4 className="dataset-panel__section-title">Accuracy over time</h4>
              <AccuracyChart perGame={datasetAnalysis.perGame} />
              <ResultStrip ds={ds} onOpenGame={onOpenGame} />

              <h4 className="dataset-panel__section-title">Openings (your perspective)</h4>
              <OpeningsTable ds={ds} />
            </>
          )}
        </section>

        <section className="dataset-panel__card dataset-panel__card--explorer">
          <MoveExplorer tree={tree} totalGames={ds.totalGames} />
        </section>
      </div>

      <div className="dataset-panel__analysis">
        <DatasetAnalysisViz analysis={datasetAnalysis} onOpenGame={onOpenGame} />
      </div>

      <section className="dataset-panel__card dataset-panel__games">
        <GamesList ds={ds} onOpenGame={onOpenGame} analyzedByIndex={analyzedByIndex} />
      </section>
    </div>
  );
}

function HeroRecord({ ds }: { ds: ReturnType<typeof computeDataset> }) {
  const r = ds.heroRecord;
  return (
    <div className="dataset-hero-record">
      <div className="dataset-hero-record__score">
        {r.wins}
        <span className="dataset-hero-record__win">W</span> - {r.draws}
        <span className="dataset-hero-record__draw">D</span> - {r.losses}
        <span className="dataset-hero-record__loss">L</span>
        <span className="dataset-hero-record__meta">
          {r.winPct.toFixed(0)}% win - {r.scorePct.toFixed(0)}% score
        </span>
      </div>
      <RecordBar rec={r} />
      <div className="dataset-hero-record__color-grid">
        <ColorRecord title="as White" rec={ds.asWhite} />
        <ColorRecord title="as Black" rec={ds.asBlack} />
      </div>
    </div>
  );
}

function ColorRecord({ title, rec }: { title: string; rec: Record4 }) {
  return (
    <div className="dataset-color-record">
      <div className="dataset-color-record__label">
        {title}: {rec.wins}-{rec.draws}-{rec.losses}
      </div>
      <RecordBar rec={rec} />
    </div>
  );
}

function RecordBar({ rec }: { rec: Record4 }) {
  return (
    <StackedBar
      height={12}
      segments={[
        { value: rec.wins, color: WIN, label: 'Wins' },
        { value: rec.draws, color: DRAW, label: 'Draws' },
        { value: rec.losses, color: LOSS, label: 'Losses' },
      ]}
    />
  );
}

function AccuracyChart({ perGame }: { perGame: { ts: number | null; accuracy: number }[] }) {
  const W = 420;
  const H = 96;
  const PAD = 14;
  if (perGame.length < 3) {
    return (
      <div className="dataset-panel__muted">
        {perGame.length === 0
          ? 'No analyzed games yet - run "Analyze all games" to chart your accuracy over time.'
          : `Only ${perGame.length} analyzed game${perGame.length === 1 ? '' : 's'} - analyze more to see the trend.`}
      </div>
    );
  }
  const n = perGame.length;
  const lo = Math.max(0, Math.min(...perGame.map((p) => p.accuracy)) - 5);
  const hi = 100;
  const x = (i: number) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const y = (a: number) => PAD + (1 - (a - lo) / (hi - lo)) * (H - 2 * PAD);
  const line = perGame.map((p, i) => `${x(i)},${y(p.accuracy)}`).join(' ');
  const y80 = y(80);
  return (
    <svg width={W} height={H} className="dataset-accuracy-chart">
      {y80 > PAD && y80 < H - PAD && (
        <line className="dataset-accuracy-chart__guide" x1={PAD} y1={y80} x2={W - PAD} y2={y80} />
      )}
      <polyline className="dataset-accuracy-chart__line" points={line} />
      {perGame.map((p, i) => (
        <circle key={i} className="dataset-accuracy-chart__dot" cx={x(i)} cy={y(p.accuracy)} r={2.5} />
      ))}
      <text className="dataset-accuracy-chart__label" x={PAD} y={11}>
        accuracy per analyzed game - dashes = 80%
      </text>
    </svg>
  );
}

function ResultStrip({
  ds,
  onOpenGame,
}: {
  ds: ReturnType<typeof computeDataset>;
  onOpenGame: (i: number) => void;
}) {
  return (
    <div className="dataset-result-strip">
      {ds.timeline.map((t) => {
        const s = ds.summaries[t.index];
        return (
          <button
            key={t.index}
            className={`dataset-result-strip__dot dataset-result-strip__dot--${resultTone(t.heroScore)}`}
            onClick={() => onOpenGame(t.index)}
            title={`${s.white} vs ${s.black} - ${s.result}${s.date ? ` - ${s.date}` : ''}`}
          />
        );
      })}
    </div>
  );
}

function OpeningsTable({ ds }: { ds: ReturnType<typeof computeDataset> }) {
  const rows = ds.openings.slice(0, 8);
  return (
    <table className="dataset-openings-table">
      <tbody>
        {rows.map((o) => (
          <tr key={o.name}>
            <td className="dataset-openings-table__name" title={o.name}>
              {o.name}
            </td>
            <td className="dataset-openings-table__games">{o.games}</td>
            <td className="dataset-openings-table__bar">
              <StackedBar
                height={10}
                segments={[
                  { value: o.wins, color: WIN, label: 'W' },
                  { value: o.draws, color: DRAW, label: 'D' },
                  { value: o.losses, color: LOSS, label: 'L' },
                ]}
              />
            </td>
            <td className="dataset-openings-table__score">{((o.score / o.games) * 100).toFixed(0)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MoveExplorer({ tree, totalGames }: { tree: ReturnType<typeof buildOpeningTree>; totalGames: number }) {
  const [stack, setStack] = useState<{ san: string; fen: string }[]>([]);
  const currentFen = stack.length ? stack[stack.length - 1].fen : tree.rootFen;
  const moves = movesFrom(tree, currentFen);
  const here = moves.reduce((s, m) => s + m.games, 0) || (stack.length ? 0 : totalGames);

  return (
    <div>
      <h3 className="dataset-panel__headline">Move explorer</h3>
      <div className="dataset-move-explorer__path">
        {stack.length === 0 ? (
          <span className="dataset-panel__muted">Start position - pick a move played in your games.</span>
        ) : (
          <span>
            {stack.map((s, i) => (
              <span key={i}>
                {i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : ''}
                <button
                  className="dataset-move-explorer__crumb"
                  onClick={() => setStack(stack.slice(0, i + 1))}
                >
                  {s.san}
                </button>
              </span>
            ))}
          </span>
        )}
      </div>
      {stack.length > 0 && (
        <div className="dataset-move-explorer__nav">
          <button className="dataset-panel__small-button" onClick={() => setStack(stack.slice(0, -1))}>
            Back
          </button>
          <button className="dataset-panel__small-button" onClick={() => setStack([])}>
            Start
          </button>
        </div>
      )}

      {moves.length === 0 ? (
        <div className="dataset-panel__muted">End of book - no further games from here.</div>
      ) : (
        <table className="dataset-move-table">
          <thead>
            <tr>
              <th>Move</th>
              <th>Games</th>
              <th>Results</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((m) => (
              <MoveRow key={m.san} m={m} here={here} onPlay={() => setStack([...stack, { san: m.san, fen: m.fenAfter }])} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MoveRow({ m, here, onPlay }: { m: MoveStat; here: number; onPlay: () => void }) {
  const pct = here ? ((m.games / here) * 100).toFixed(0) : '0';
  return (
    <tr>
      <td>
        <button className="dataset-move-table__move" onClick={onPlay}>
          {m.san}
        </button>
      </td>
      <td className="dataset-move-table__games">
        {m.games} <span className="dataset-panel__muted">({pct}%)</span>
      </td>
      <td className="dataset-move-table__bar">
        <StackedBar
          height={14}
          segments={[
            { value: m.whiteWins, color: W_RES, label: 'White' },
            { value: m.draws, color: D_RES, label: 'Draw' },
            { value: m.blackWins, color: B_RES, label: 'Black' },
          ]}
          showCounts
        />
      </td>
    </tr>
  );
}

type GameFilter = 'interesting' | 'losses' | 'recent' | 'all';

function GamesList({
  ds,
  onOpenGame,
  analyzedByIndex,
}: {
  ds: ReturnType<typeof computeDataset>;
  onOpenGame: (i: number) => void;
  analyzedByIndex: Map<number, { done: number; total: number }>;
}) {
  const [filter, setFilter] = useState<GameFilter>('interesting');
  const interestByIndex = new Map(ds.interestingGames.map((g) => [g.index, g]));
  const rows = [...ds.summaries]
    .filter((s) => {
      if (filter === 'all') return true;
      if (filter === 'losses') return s.heroScore === 0;
      if (filter === 'interesting') return interestByIndex.has(s.index);
      return true;
    })
    .sort((a, b) => {
      if (filter === 'interesting') {
        return (interestByIndex.get(b.index)?.score ?? 0) - (interestByIndex.get(a.index)?.score ?? 0) || a.index - b.index;
      }
      if (filter === 'recent') return (b.date ?? '').localeCompare(a.date ?? '') || b.index - a.index;
      return a.index - b.index;
    });

  return (
    <details className="dataset-games">
      <summary className="dataset-games__summary">
        Review games ({rows.length} shown / {ds.totalGames})
      </summary>
      <div className="dataset-games__filters">
        <FilterButton active={filter === 'interesting'} onClick={() => setFilter('interesting')}>
          Interesting
        </FilterButton>
        <FilterButton active={filter === 'losses'} onClick={() => setFilter('losses')}>
          Losses
        </FilterButton>
        <FilterButton active={filter === 'recent'} onClick={() => setFilter('recent')}>
          Recent
        </FilterButton>
        <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </FilterButton>
      </div>
      <div className="dataset-games__table-wrap">
        <table className="dataset-games__table">
          <tbody>
            {rows.map((s) => {
              const interest = interestByIndex.get(s.index);
              return (
                <tr key={s.index} onClick={() => onOpenGame(s.index)}>
                  <td className="dataset-games__result">
                    <span className={`dataset-games__result-dot dataset-games__result-dot--${resultTone(s.heroScore)}`} />
                  </td>
                  <td className="dataset-games__analysis">
                    <AnalyzedMark a={analyzedByIndex.get(s.index)} />
                  </td>
                  <td className="dataset-games__date">{s.date ?? '-'}</td>
                  <td className="dataset-games__players">
                    {s.white} vs {s.black}
                  </td>
                  <td className="dataset-games__text-muted">{s.result}</td>
                  <td className="dataset-games__opening" title={s.opening}>
                    {s.opening}
                  </td>
                  <td className="dataset-games__reasons" title={interest?.reasons.join('; ') ?? ''}>
                    {interest?.reasons.slice(0, 2).join('; ') ?? ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function AnalyzedMark({ a }: { a?: { done: number; total: number } }) {
  if (!a || a.total === 0 || a.done === 0) {
    return (
      <span className="dataset-games__mark dataset-games__mark--none" title="Not analyzed">
        -
      </span>
    );
  }
  if (a.done >= a.total) {
    return (
      <span className="dataset-games__mark dataset-games__mark--done" title="Analyzed (cached locally)">
        ok
      </span>
    );
  }
  return (
    <span className="dataset-games__mark dataset-games__mark--partial" title={`${a.done}/${a.total} plies analyzed`}>
      {Math.round((a.done / a.total) * 100)}%
    </span>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      className={`dataset-games__filter${active ? ' is-active' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StackedBar({
  segments,
  height,
  showCounts,
}: {
  segments: { value: number; color: string; label: string }[];
  height: number;
  showCounts?: boolean;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="dataset-stacked-bar" style={{ height }}>
      {segments.map((s, i) =>
        s.value > 0 ? (
          <div
            key={i}
            className="dataset-stacked-bar__segment"
            title={`${s.label}: ${s.value}`}
            style={{
              width: `${(s.value / total) * 100}%`,
              background: s.color,
              lineHeight: `${height}px`,
            }}
          >
            {showCounts && s.value / total > 0.12 ? s.value : ''}
          </div>
        ) : null,
      )}
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="dataset-legend">
      {items.map(([label, color]) => (
        <span key={label} className="dataset-legend__item">
          <span className="dataset-legend__swatch" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function resultTone(score: number | null | undefined): 'win' | 'draw' | 'loss' | 'unknown' {
  if (score === 1) return 'win';
  if (score === 0.5) return 'draw';
  if (score === 0) return 'loss';
  return 'unknown';
}
