// Game review — aggregates the cached per-ply analyses into accuracy, mistakes
// (separated by ownership), and a what-happened timeline. The scope toggle lets
// the review build move-by-move as you step, or show the whole game at once.
import { useMemo, useState } from 'react';
import { computeAnalytics, type AnalyzedEntry, type SideStats, type WorstMove } from '../engine/analytics';
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
  view,
  onJump,
}: {
  entries: AnalyzedEntry[];
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

function ScopeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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

// ── timeline ────────────────────────────────────────────────────────────────
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
