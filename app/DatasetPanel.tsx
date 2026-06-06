// Dataset view — OpeningTree-style aggregation over a full game export:
// a position-keyed move explorer (W/D/L bars), the hero's record by color and
// opening, and a score-over-time series. All structural (PGN-only), so it runs
// instantly over hundreds of games.
import { useMemo, useState } from 'react';
import type { ParsedGame } from '../engine/position';
import { computeDataset, type Record4 } from '../engine/dataset';
import { buildOpeningTree, movesFrom, type MoveStat } from '../engine/repertoire';

const WIN = '#3fbf5f';
const DRAW = '#b9b9b9';
const LOSS = '#e2603b';
// Move-explorer result colors (position-centric: white vs black score).
const W_RES = '#7ba3d0';
const D_RES = '#c4c4c4';
const B_RES = '#4a4a4a';

// Match the board view's card treatment.
const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e6e8eb',
  borderRadius: 10,
  boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
  padding: 14,
};

export function DatasetPanel({
  games,
  engineReady,
  analysisProgress,
  onAnalyzeAll,
  onOpenGame,
}: {
  games: ParsedGame[];
  engineReady: boolean;
  analysisProgress: { running: boolean; done: number; total: number };
  onAnalyzeAll: () => void;
  onOpenGame: (index: number) => void;
}) {
  const ds = useMemo(() => computeDataset(games), [games]);
  const tree = useMemo(() => buildOpeningTree(games), [games]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
          minHeight: 34,
        }}
      >
        <div style={{ fontSize: 13, color: '#666' }}>
          {analysisProgress.running
            ? `Analyzing dataset ${analysisProgress.done}/${analysisProgress.total}`
            : 'Dataset analysis is cached per game once run.'}
        </div>
        <button
          onClick={onAnalyzeAll}
          disabled={!engineReady || analysisProgress.running}
          style={{
            border: '1px solid #3b6fd4',
            background: engineReady && !analysisProgress.running ? '#3b6fd4' : '#f3f3f3',
            color: engineReady && !analysisProgress.running ? '#fff' : '#888',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 13,
            cursor: engineReady && !analysisProgress.running ? 'pointer' : 'not-allowed',
            minWidth: 148,
          }}
        >
          Analyze all games
        </button>
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Left column: the numbers */}
        <div style={{ ...card, flex: '1 1 420px', minWidth: 360 }}>
          <h3 style={{ margin: '0 0 8px' }}>
            {ds.hero ? `${ds.hero} — ` : ''}
            {ds.totalGames} games
          </h3>

          {ds.hero && <HeroRecord ds={ds} />}

          <h4 style={{ margin: '16px 0 4px' }}>Results across all games</h4>
          <StackedBar
            height={16}
            segments={[
              { value: ds.byResult.whiteWins, color: W_RES, label: 'White wins' },
              { value: ds.byResult.draws, color: D_RES, label: 'Draws' },
              { value: ds.byResult.blackWins, color: B_RES, label: 'Black wins' },
            ]}
          />
          <Legend items={[['White wins', W_RES], ['Draws', D_RES], ['Black wins', B_RES]]} />

          {ds.hero && (
            <>
              <h4 style={{ margin: '16px 0 4px' }}>Score over time</h4>
              <Sparkline timeline={ds.timeline} />
              <ResultStrip ds={ds} onOpenGame={onOpenGame} />

              <h4 style={{ margin: '16px 0 4px' }}>Openings (your perspective)</h4>
              <OpeningsTable ds={ds} />
            </>
          )}
        </div>

        {/* Right column: the move explorer */}
        <div style={{ ...card, flex: '1 1 360px', minWidth: 320 }}>
          <MoveExplorer tree={tree} totalGames={ds.totalGames} />
        </div>
      </div>

      <div style={{ ...card, marginTop: 20 }}>
        <GamesList ds={ds} onOpenGame={onOpenGame} />
      </div>
    </div>
  );
}

// ── hero record ──────────────────────────────────────────────────────────────
function HeroRecord({ ds }: { ds: ReturnType<typeof computeDataset> }) {
  const r = ds.heroRecord;
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 2 }}>
        {r.wins}<span style={{ color: WIN }}>W</span> · {r.draws}<span style={{ color: '#888' }}>D</span> ·{' '}
        {r.losses}<span style={{ color: LOSS }}>L</span>
        <span style={{ fontSize: 14, fontWeight: 400, color: '#666', marginLeft: 10 }}>
          {r.winPct.toFixed(0)}% win · {r.scorePct.toFixed(0)}% score
        </span>
      </div>
      <RecordBar rec={r} />
      <div style={{ display: 'flex', gap: 18, marginTop: 8, fontSize: 13 }}>
        <ColorRecord title="as White" rec={ds.asWhite} />
        <ColorRecord title="as Black" rec={ds.asBlack} />
      </div>
    </div>
  );
}

function ColorRecord({ title, rec }: { title: string; rec: Record4 }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ color: '#666', marginBottom: 2 }}>
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

// ── score-over-time sparkline ────────────────────────────────────────────────
function Sparkline({ timeline }: { timeline: ReturnType<typeof computeDataset>['timeline'] }) {
  const W = 360;
  const H = 70;
  const pts = timeline.filter((t) => t.heroScore !== null);
  if (pts.length < 2) return <div style={{ fontSize: 13, color: '#888' }}>Not enough games to chart.</div>;
  const n = pts.length;
  const maxCum = pts[pts.length - 1].cumulative || 1;
  // Hero cumulative line.
  const line = pts
    .map((t, i) => `${(i / (n - 1)) * W},${H - (t.cumulative / maxCum) * H}`)
    .join(' ');
  // "Even" reference: 0.5 points per game.
  const evenEnd = 0.5 * n;
  const evenY = H - (Math.min(evenEnd, maxCum) / maxCum) * H;
  return (
    <svg width={W} height={H} style={{ display: 'block', background: '#fafafa', border: '1px solid #eee', borderRadius: 4 }}>
      <line x1={0} y1={H} x2={W} y2={evenY} stroke="#ddd" strokeDasharray="4 3" />
      <polyline points={line} fill="none" stroke="#3b6fd4" strokeWidth={2} />
      <text x={4} y={12} fontSize={10} fill="#999">
        cumulative score (↑ = winning)
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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 6 }}>
      {ds.timeline.map((t) => {
        const c = t.heroScore === 1 ? WIN : t.heroScore === 0.5 ? DRAW : t.heroScore === 0 ? LOSS : '#eee';
        const s = ds.summaries[t.index];
        return (
          <div
            key={t.index}
            onClick={() => onOpenGame(t.index)}
            title={`${s.white} vs ${s.black} · ${s.result}${s.date ? ` · ${s.date}` : ''}`}
            style={{ width: 10, height: 10, background: c, borderRadius: 2, cursor: 'pointer' }}
          />
        );
      })}
    </div>
  );
}

// ── openings ────────────────────────────────────────────────────────────────
function OpeningsTable({ ds }: { ds: ReturnType<typeof computeDataset> }) {
  const rows = ds.openings.slice(0, 8);
  return (
    <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
      <tbody>
        {rows.map((o) => (
          <tr key={o.name}>
            <td style={{ padding: '2px 8px 2px 0', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={o.name}>
              {o.name}
            </td>
            <td style={{ padding: '2px 8px', color: '#666', textAlign: 'right' }}>{o.games}</td>
            <td style={{ padding: '2px 0', width: 120 }}>
              <StackedBar
                height={10}
                segments={[
                  { value: o.wins, color: WIN, label: 'W' },
                  { value: o.draws, color: DRAW, label: 'D' },
                  { value: o.losses, color: LOSS, label: 'L' },
                ]}
              />
            </td>
            <td style={{ padding: '2px 0 2px 8px', color: '#666', textAlign: 'right', width: 44 }}>
              {((o.score / o.games) * 100).toFixed(0)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── move explorer (OpeningTree) ──────────────────────────────────────────────
function MoveExplorer({ tree, totalGames }: { tree: ReturnType<typeof buildOpeningTree>; totalGames: number }) {
  const [stack, setStack] = useState<{ san: string; fen: string }[]>([]);
  const currentFen = stack.length ? stack[stack.length - 1].fen : tree.rootFen;
  const moves = movesFrom(tree, currentFen);
  const here = moves.reduce((s, m) => s + m.games, 0) || (stack.length ? 0 : totalGames);

  return (
    <div>
      <h3 style={{ margin: '0 0 8px' }}>Move explorer</h3>
      <div style={{ fontSize: 13, color: '#555', marginBottom: 6, minHeight: 20 }}>
        {stack.length === 0 ? (
          <span style={{ color: '#888' }}>Start position — pick a move played in your games.</span>
        ) : (
          <span>
            {stack.map((s, i) => (
              <span key={i}>
                {i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : ''}
                <span
                  onClick={() => setStack(stack.slice(0, i + 1))}
                  style={{ cursor: 'pointer', marginRight: 4, textDecoration: 'underline' }}
                >
                  {s.san}
                </span>
              </span>
            ))}
          </span>
        )}
      </div>
      {stack.length > 0 && (
        <div style={{ marginBottom: 8, display: 'flex', gap: 6 }}>
          <button onClick={() => setStack(stack.slice(0, -1))} style={smallBtn}>
            ← Back
          </button>
          <button onClick={() => setStack([])} style={smallBtn}>
            ⟲ Start
          </button>
        </div>
      )}

      {moves.length === 0 ? (
        <div style={{ fontSize: 13, color: '#888' }}>End of book — no further games from here.</div>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr style={{ color: '#888', textAlign: 'left', fontSize: 11 }}>
              <th style={{ padding: '0 6px 4px 0' }}>Move</th>
              <th style={{ padding: '0 6px 4px' }}>Games</th>
              <th style={{ padding: '0 0 4px' }}>Results</th>
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
    <tr style={{ borderTop: '1px solid #f0f0f0' }}>
      <td style={{ padding: '4px 6px 4px 0' }}>
        <span onClick={onPlay} style={{ cursor: 'pointer', fontWeight: 600, color: '#3b6fd4' }}>
          {m.san}
        </span>
      </td>
      <td style={{ padding: '4px 6px', color: '#666', whiteSpace: 'nowrap' }}>
        {m.games} <span style={{ color: '#aaa' }}>({pct}%)</span>
      </td>
      <td style={{ padding: '4px 0', minWidth: 130 }}>
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

// ── full games list ──────────────────────────────────────────────────────────
type GameFilter = 'interesting' | 'losses' | 'recent' | 'all';

function GamesList({ ds, onOpenGame }: { ds: ReturnType<typeof computeDataset>; onOpenGame: (i: number) => void }) {
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
    <details>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        Review games ({rows.length} shown / {ds.totalGames})
      </summary>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, marginBottom: 8, flexWrap: 'wrap' }}>
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
      <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 8, border: '1px solid #eee', borderRadius: 4 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <tbody>
            {rows.map((s) => {
              const c = s.heroScore === 1 ? WIN : s.heroScore === 0.5 ? '#999' : s.heroScore === 0 ? LOSS : '#bbb';
              const interest = interestByIndex.get(s.index);
              return (
                <tr
                  key={s.index}
                  onClick={() => onOpenGame(s.index)}
                  style={{ cursor: 'pointer', borderTop: '1px solid #f3f3f3' }}
                >
                  <td style={{ padding: '3px 6px', width: 6 }}>
                    <div style={{ width: 6, height: 14, background: c, borderRadius: 2 }} />
                  </td>
                  <td style={{ padding: '3px 8px', color: '#888', whiteSpace: 'nowrap' }}>{s.date ?? '—'}</td>
                  <td style={{ padding: '3px 8px', whiteSpace: 'nowrap' }}>
                    {s.white} vs {s.black}
                  </td>
                  <td style={{ padding: '3px 8px', color: '#666' }}>{s.result}</td>
                  <td
                    style={{ padding: '3px 8px', color: '#888', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={s.opening}
                  >
                    {s.opening}
                  </td>
                  <td
                    style={{
                      padding: '3px 8px',
                      color: '#666',
                      maxWidth: 260,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={interest?.reasons.join('; ') ?? ''}
                  >
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

// ── primitives ───────────────────────────────────────────────────────────────
function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: '1px solid ' + (active ? '#3b6fd4' : '#ccc'),
        background: active ? '#e8f0ff' : '#fff',
        color: active ? '#1f4fa3' : '#444',
        borderRadius: 4,
        padding: '3px 9px',
        fontSize: 12,
        cursor: 'pointer',
      }}
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
    <div style={{ display: 'flex', width: '100%', height, borderRadius: 3, overflow: 'hidden', background: '#f0f0f0' }}>
      {segments.map((s, i) =>
        s.value > 0 ? (
          <div
            key={i}
            title={`${s.label}: ${s.value}`}
            style={{
              width: `${(s.value / total) * 100}%`,
              background: s.color,
              color: '#fff',
              fontSize: 9,
              lineHeight: `${height}px`,
              textAlign: 'center',
              overflow: 'hidden',
            }}
          >
            {showCounts && (s.value / total) > 0.12 ? s.value : ''}
          </div>
        ) : null,
      )}
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 3, fontSize: 11, color: '#777' }}>
      {items.map(([label, color]) => (
        <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 9, height: 9, background: color, borderRadius: 2, display: 'inline-block' }} />
          {label}
        </span>
      ))}
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  border: '1px solid #ccc',
  background: '#fff',
  borderRadius: 4,
  padding: '2px 8px',
  fontSize: 12,
  cursor: 'pointer',
};
