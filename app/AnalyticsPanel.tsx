// Game review — aggregates the cached per-ply analyses into accuracy, mistakes
// (separated by ownership), and a what-happened timeline. The scope toggle lets
// the review build move-by-move as you step, or show the whole game at once.
import { useMemo, useState, type ReactNode } from 'react';
import { computeAnalytics, type AnalyzedEntry, type SideStats, type WorstMove } from '../engine/analytics';
import { computePatternProfile, type FeatureEntry, type PatternProfile } from '../engine/features';
import type { Classification, MoveAnalysis } from '../engine/types';

const CLASS_COLOR: Record<Classification, string> = {
  best: '#2f855a',
  excellent: '#3fbf5f',
  good: '#5a9bd4',
  inaccuracy: '#e8923b',
  mistake: '#e2603b',
  blunder: '#e23b3b',
};
const CLASS_ORDER: Classification[] = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];

// Team colors mirror the board visual grammar: White = blue, Black = red.
const TEAM = { w: '#3b6fd4', b: '#d43b3b' } as const;

type Scope = 'game' | 'step';

export function AnalyticsPanel({
  entries,
  features,
  view,
  onJump,
}: {
  entries: AnalyzedEntry[];
  features?: FeatureEntry[];
  view: number; // current ply (half-moves shown)
  onJump: (ply: number) => void;
}) {
  const [scope, setScope] = useState<Scope>('game');

  // In step mode the review is built only from what's been played up to `view`.
  const scoped = useMemo(
    () => (scope === 'step' ? entries.filter((e) => e.ply <= view) : entries),
    [entries, scope, view],
  );
  const analytics = useMemo(() => computeAnalytics(scoped), [scoped]);
  const scopedFeatures = useMemo(
    () => (scope === 'step' ? (features ?? []).filter((e) => e.ply <= view) : features ?? []),
    [features, scope, view],
  );
  // Provenance matters: attribute every pattern/motif/phase-loss to the side whose
  // move it was, so White's and Black's habits are read separately (like the mistakes).
  const patternsW = useMemo(() => computePatternProfile(scopedFeatures.filter((e) => e.color === 'w')), [scopedFeatures]);
  const patternsB = useMemo(() => computePatternProfile(scopedFeatures.filter((e) => e.color === 'b')), [scopedFeatures]);
  const timeline = useMemo(() => buildTimeline(scoped), [scoped]);

  return (
    <div style={{ marginTop: 20, borderTop: '2px solid #ddd', paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Game review</h3>
        <div style={{ display: 'inline-flex', border: '1px solid #ccc', borderRadius: 6, overflow: 'hidden' }}>
          <ScopeButton active={scope === 'game'} onClick={() => setScope('game')}>
            Whole game
          </ScopeButton>
          <ScopeButton active={scope === 'step'} onClick={() => setScope('step')}>
            Up to current move
          </ScopeButton>
        </div>
        {scope === 'step' && (
          <span style={{ fontSize: 12, color: '#888' }}>
            through move {Math.ceil(view / 2) || 0} · {scoped.length} plies analyzed
          </span>
        )}
      </div>

      {scoped.length === 0 ? (
        <div style={{ color: '#888', fontSize: 13 }}>
          Step forward to build the review move by move.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <SideCard title="White" color={TEAM.w} s={analytics.white} />
          <SideCard title="Black" color={TEAM.b} s={analytics.black} />

          {/* Mistakes separated by ownership — each side owns its own list. */}
          <MistakeColumn title="White's mistakes" color={TEAM.w} moves={analytics.worstByColor.w} onJump={onJump} />
          <MistakeColumn title="Black's mistakes" color={TEAM.b} moves={analytics.worstByColor.b} onJump={onJump} />

          <PatternsSplit w={patternsW} b={patternsB} />
          <MotifsSplit w={patternsW} b={patternsB} />
          <PhaseSplit w={patternsW} b={patternsB} />

          {/* What happened — chronological, tied to the move history. */}
          <div style={{ minWidth: 280, flex: 1 }}>
            <h4 style={{ margin: '0 0 4px' }}>What happened</h4>
            {analytics.matesFound > 0 && (
              <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>
                Forced mates in play: {analytics.matesFound}
              </div>
            )}
            {timeline.length === 0 ? (
              <div style={{ color: '#888', fontSize: 13 }}>Nothing notable yet — a quiet stretch.</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 13 }}>
                {timeline.map((ev) => (
                  <li
                    key={ev.ply}
                    onClick={() => onJump(ev.ply)}
                    style={{
                      cursor: 'pointer',
                      display: 'flex',
                      gap: 8,
                      padding: '3px 0',
                      borderLeft: `3px solid ${TEAM[ev.color]}`,
                      paddingLeft: 8,
                      marginBottom: 2,
                    }}
                  >
                    <span style={{ fontWeight: 600, minWidth: 64, color: '#333' }}>{ev.move}</span>
                    <span style={{ color: ev.tone }}>{ev.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScopeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: 'none',
        padding: '4px 10px',
        fontSize: 12,
        cursor: 'pointer',
        background: active ? '#3b6fd4' : '#f4f4f4',
        color: active ? '#fff' : '#444',
      }}
    >
      {children}
    </button>
  );
}

function SideCard({ title, color, s }: { title: string; color: string; s: SideStats }) {
  const total = s.moves || 1;
  return (
    <div style={{ minWidth: 220 }}>
      <h4 style={{ margin: '0 0 4px' }}>
        <span style={{ color }}>{title}</span> —{' '}
        <span style={{ color: accColor(s.accuracy) }}>{s.accuracy.toFixed(0)}% accuracy</span>
      </h4>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>
        {s.moves} moves · avg loss {s.avgCpLoss.toFixed(2)}
      </div>
      <div style={{ display: 'flex', height: 12, borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
        {CLASS_ORDER.map((c) => {
          const w = (s.byClass[c] / total) * 100;
          return w > 0 ? (
            <div key={c} title={`${c}: ${s.byClass[c]}`} style={{ width: `${w}%`, background: CLASS_COLOR[c] }} />
          ) : null;
        })}
      </div>
      <div style={{ fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {CLASS_ORDER.filter((c) => s.byClass[c] > 0).map((c) => (
          <span key={c} style={{ color: CLASS_COLOR[c] }}>
            {s.byClass[c]} {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function MistakeColumn({
  title,
  color,
  moves,
  onJump,
}: {
  title: string;
  color: string;
  moves: WorstMove[];
  onJump: (ply: number) => void;
}) {
  return (
    <div style={{ minWidth: 200 }}>
      <h4 style={{ margin: '0 0 4px', color }}>{title}</h4>
      {moves.length === 0 ? (
        <div style={{ color: '#888', fontSize: 13 }}>No mistakes ≥ 1 pawn.</div>
      ) : (
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {moves.map((m) => (
            <li key={m.ply} style={{ marginBottom: 2 }}>
              <span onClick={() => onJump(m.ply)} style={{ cursor: 'pointer', textDecoration: 'underline' }}>
                {m.move}
              </span>{' '}
              <span style={{ color: CLASS_COLOR[m.classification] }}>
                {m.classification} (−{m.cpLoss.toFixed(1)})
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── split-by-side analytics (provenance) ─────────────────────────────────────
function SideLabel({ color, text, mt }: { color: string; text: string; mt?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color, marginTop: mt ?? 0, marginBottom: 3 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {text}
    </div>
  );
}

function PatternsSplit({ w, b }: { w: PatternProfile; b: PatternProfile }) {
  return (
    <div style={{ minWidth: 280, maxWidth: 380, flex: '1 1 300px' }}>
      <h4 style={{ margin: '0 0 6px' }}>Patterns</h4>
      <SideLabel color={TEAM.w} text="White" />
      <PatternGrid patterns={w} />
      <SideLabel color={TEAM.b} text="Black" mt={10} />
      <PatternGrid patterns={b} />
    </div>
  );
}

function PatternGrid({ patterns }: { patterns: PatternProfile }) {
  if (patterns.topPatterns.length === 0) return <div style={{ color: '#aaa', fontSize: 12 }}>none</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(132px, 1fr))', gap: 6 }}>
      {patterns.topPatterns.map((p) => (
        <div key={p.type} style={{ border: '1px solid #e4e4e4', borderRadius: 4, padding: '6px 8px', minHeight: 50, background: '#fafafa' }}>
          <div style={{ fontSize: 12, color: '#666' }}>{p.count}x</div>
          <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
          <div style={{ fontSize: 11, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.detail}</div>
        </div>
      ))}
    </div>
  );
}

function MotifsSplit({ w, b }: { w: PatternProfile; b: PatternProfile }) {
  return (
    <div style={{ minWidth: 220, flex: '1 1 240px' }}>
      <h4 style={{ margin: '0 0 6px' }}>
        Motifs <span style={{ fontSize: 11, fontWeight: 400, color: '#3fbf5f' }}>created</span>
        <span style={{ fontSize: 11, fontWeight: 400, color: '#999' }}> / </span>
        <span style={{ fontSize: 11, fontWeight: 400, color: '#e2603b' }}>suffered</span>
      </h4>
      <SideLabel color={TEAM.w} text="White" />
      <MotifBars patterns={w} />
      <SideLabel color={TEAM.b} text="Black" mt={10} />
      <MotifBars patterns={b} />
    </div>
  );
}

function MotifBars({ patterns }: { patterns: PatternProfile }) {
  const rows = motifRows(patterns).slice(0, 6);
  if (rows.length === 0) return <div style={{ color: '#aaa', fontSize: 12 }}>none</div>;
  return (
    <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
      {rows.map((r) => (
        <div key={r.name} style={{ display: 'grid', gridTemplateColumns: '82px 1fr 32px', gap: 6, alignItems: 'center' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
          <div style={{ display: 'flex', height: 8, background: '#eee', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${r.createdPct}%`, background: '#3fbf5f' }} />
            <div style={{ width: `${r.sufferedPct}%`, background: '#e2603b' }} />
          </div>
          <span style={{ color: '#777', textAlign: 'right' }}>{r.total}</span>
        </div>
      ))}
    </div>
  );
}

function PhaseSplit({ w, b }: { w: PatternProfile; b: PatternProfile }) {
  return (
    <div style={{ minWidth: 210, flex: '1 1 220px' }}>
      <h4 style={{ margin: '0 0 6px' }}>Phase loss (avg cp)</h4>
      <SideLabel color={TEAM.w} text="White" />
      <PhaseBars patterns={w} />
      <SideLabel color={TEAM.b} text="Black" mt={10} />
      <PhaseBars patterns={b} />
    </div>
  );
}

function PhaseBars({ patterns }: { patterns: PatternProfile }) {
  return (
    <>
      {(['opening', 'middlegame', 'endgame'] as const).map((phase) => {
        const row = patterns.phase[phase];
        const width = Math.min(100, row.avgCpLoss * 35);
        return (
          <div key={phase} style={{ display: 'grid', gridTemplateColumns: '82px 1fr 44px', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 4 }}>
            <span>{phase}</span>
            <div style={{ height: 8, background: '#eee', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${width}%`, height: '100%', background: row.avgCpLoss >= 1 ? '#e2603b' : '#5a9bd4' }} />
            </div>
            <span style={{ color: '#777', textAlign: 'right' }}>{row.avgCpLoss.toFixed(1)}</span>
          </div>
        );
      })}
    </>
  );
}

function motifRows(patterns: PatternProfile) {
  const names = new Set([...Object.keys(patterns.motifCreated), ...Object.keys(patterns.motifSuffered)]);
  return [...names]
    .map((name) => {
      const created = patterns.motifCreated[name as keyof typeof patterns.motifCreated] ?? 0;
      const suffered = patterns.motifSuffered[name as keyof typeof patterns.motifSuffered] ?? 0;
      const total = created + suffered || 1;
      return {
        name: name.replace(/_/g, ' '),
        total,
        createdPct: (created / total) * 100,
        sufferedPct: (suffered / total) * 100,
      };
    })
    .sort((a, b) => b.total - a.total);
}

interface TimelineEvent {
  ply: number;
  color: 'w' | 'b';
  move: string;
  text: string;
  tone: string;
}

function buildTimeline(entries: AnalyzedEntry[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const e of entries) {
    const text = whatHappened(e.analysis);
    if (!text) continue;
    out.push({
      ply: e.ply,
      color: e.color,
      move: e.analysis.move,
      text,
      tone: CLASS_COLOR[e.analysis.classification] ?? '#444',
    });
  }
  return out;
}

/** A short plain-language note for the timeline, or null if the move was unremarkable. */
function whatHappened(a: MoveAnalysis): string | null {
  if (a.mateProof) {
    const side = a.mateProof.matingSide === 'white' ? 'White' : 'Black';
    return `forced mate in ${a.mateProof.mateInMoves} for ${side}`;
  }
  const notable = a.classification === 'inaccuracy' || a.classification === 'mistake' || a.classification === 'blunder';
  const top = a.rankedInsights[0];
  if (notable) {
    return a.topExplanation || `${a.classification} (−${a.cpLoss.toFixed(1)})`;
  }
  // Strong moves only surface if they carried a salient motif.
  if (top && top.saliency >= 0.5) return a.topExplanation || top.type.replace(/_/g, ' ');
  return null;
}

function accColor(acc: number): string {
  if (acc >= 85) return '#2f855a';
  if (acc >= 70) return '#5a9bd4';
  if (acc >= 55) return '#e8923b';
  return '#e23b3b';
}
