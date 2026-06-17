// Tutor-first game review. The default view turns engine output into a small
// number of decisions and practice positions; the complete diagnostics remain
// available in the Data view.
import { useMemo, useState, type ReactNode } from 'react';
import {
  computeAnalytics,
  type AnalyzedEntry,
  type SideStats,
  type WorstMove,
} from '../engine/analytics';
import {
  computePatternProfile,
  type FeatureEntry,
  type PatternProfile,
  type PatternType,
  type Phase,
} from '../engine/features';
import type { Classification, MoveAnalysis } from '../engine/types';
import type { TeachingProfile } from '../engine/teaching/profile';
import type { TeachingTopicId } from '../engine/teaching/types';
import { TOPIC_REGISTRY } from '../engine/teaching/registry';

export interface TeachingThemesJob {
  running: boolean;
  done: number;
  total: number;
}

const CLASS_COLOR: Record<Classification, string> = {
  best: 'var(--good)',
  excellent: '#3fbf5f',
  good: 'var(--accent-light)',
  inaccuracy: '#e8923b',
  mistake: '#e2603b',
  blunder: '#e23b3b',
  unclassified: '#9aa',
};
const CLASS_ORDER: Classification[] = [
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'blunder',
];
const TEAM = { w: 'var(--accent)', b: '#d43b3b' } as const;
const SIDE_NAME = { w: 'White', b: 'Black' } as const;

type Scope = 'game' | 'step';
type ReviewView = 'coach' | 'moments' | 'data';
type Side = 'w' | 'b';

export function AnalyticsPanel({
  entries,
  features,
  view,
  onJump,
  teachingProfile,
  teachingThemesJob,
  onComputeThemes,
  onJumpTeaching,
  teachingGameLabel,
  onGeneratePuzzle,
}: {
  entries: AnalyzedEntry[];
  features?: FeatureEntry[];
  view: number;
  onJump: (ply: number) => void;
  teachingProfile?: TeachingProfile | null;
  teachingThemesJob?: TeachingThemesJob;
  onComputeThemes?: () => void;
  // Library-wide themes: examples may come from any game, so jumping needs the
  // game key, and each example is tagged with a human-readable game label.
  onJumpTeaching?: (gameKey: string, ply: number) => void;
  teachingGameLabel?: (gameKey: string) => string;
  onGeneratePuzzle?: (ply: number) => void;
}) {
  const [scope, setScope] = useState<Scope>('game');
  const [reviewView, setReviewView] = useState<ReviewView>('coach');
  const [focusOverride, setFocusOverride] = useState<Side | null>(null);

  const scoped = useMemo(
    () => (scope === 'step' ? entries.filter((entry) => entry.ply <= view) : entries),
    [entries, scope, view],
  );
  const scopedFeatures = useMemo(
    () =>
      scope === 'step' ? (features ?? []).filter((entry) => entry.ply <= view) : (features ?? []),
    [features, scope, view],
  );
  const analytics = useMemo(() => computeAnalytics(scoped), [scoped]);
  const patternsW = useMemo(
    () => computePatternProfile(scopedFeatures.filter((entry) => entry.color === 'w')),
    [scopedFeatures],
  );
  const patternsB = useMemo(
    () => computePatternProfile(scopedFeatures.filter((entry) => entry.color === 'b')),
    [scopedFeatures],
  );
  const timeline = useMemo(() => buildTimeline(scoped), [scoped]);

  const suggestedFocus: Side = analytics.black.accuracy < analytics.white.accuracy ? 'b' : 'w';
  const focus = focusOverride ?? suggestedFocus;
  const focusStats = focus === 'w' ? analytics.white : analytics.black;
  const opponentStats = focus === 'w' ? analytics.black : analytics.white;
  const focusProfile = focus === 'w' ? patternsW : patternsB;
  const focusFeatures = useMemo(
    () => scopedFeatures.filter((entry) => entry.color === focus),
    [scopedFeatures, focus],
  );
  const focusEntries = useMemo(
    () => scoped.filter((entry) => entry.color === focus),
    [scoped, focus],
  );
  const critical = useMemo(() => teachingMoments(focusEntries), [focusEntries]);
  const brief = useMemo(
    () => buildCoachBrief(focus, focusStats, focusProfile, critical),
    [focus, focusStats, focusProfile, critical],
  );

  return (
    <section className="analytics-panel">
      {onComputeThemes && (
        <TeachingThemes
          profile={teachingProfile ?? null}
          job={teachingThemesJob}
          onCompute={onComputeThemes}
          onJump={onJumpTeaching ?? ((_key, ply) => onJump(ply))}
          gameLabelOf={teachingGameLabel}
        />
      )}

      <div className="analytics-panel__header">
        <div>
          <h3 className="analytics-panel__title">Game review</h3>
          <div className="analytics-panel__subtitle">
            Diagnose, practice, then inspect the engine data.
          </div>
        </div>
        <div className="analytics-panel__controls">
          <SegmentedControl>
            <SegmentButton active={focus === 'w'} onClick={() => setFocusOverride('w')}>
              White
            </SegmentButton>
            <SegmentButton active={focus === 'b'} onClick={() => setFocusOverride('b')}>
              Black
            </SegmentButton>
          </SegmentedControl>
          <SegmentedControl>
            <SegmentButton active={scope === 'game'} onClick={() => setScope('game')}>
              Whole game
            </SegmentButton>
            <SegmentButton active={scope === 'step'} onClick={() => setScope('step')}>
              To current
            </SegmentButton>
          </SegmentedControl>
        </div>
      </div>

      <div className="cvs-review-tabs analytics-panel__tabs">
        <ViewButton active={reviewView === 'coach'} onClick={() => setReviewView('coach')}>
          Coach
        </ViewButton>
        <ViewButton active={reviewView === 'moments'} onClick={() => setReviewView('moments')}>
          Critical moments
        </ViewButton>
        <ViewButton active={reviewView === 'data'} onClick={() => setReviewView('data')}>
          All data
        </ViewButton>
        {scope === 'step' && (
          <span className="analytics-panel__scope-note">
            through move {Math.ceil(view / 2) || 0}
          </span>
        )}
      </div>

      {scoped.length === 0 ? (
        <div className="analytics-panel__empty">
          Step forward to build the review move by move.
        </div>
      ) : reviewView === 'coach' ? (
        <CoachView
          focus={focus}
          stats={focusStats}
          opponentStats={opponentStats}
          profile={focusProfile}
          features={focusFeatures}
          critical={critical}
          brief={brief}
          onJump={onJump}
          onGeneratePuzzle={onGeneratePuzzle}
        />
      ) : reviewView === 'moments' ? (
        <MomentsView
          focus={focus}
          entries={focusEntries}
          onJump={onJump}
          onGeneratePuzzle={onGeneratePuzzle}
        />
      ) : (
        <DataView
          analytics={analytics}
          patternsW={patternsW}
          patternsB={patternsB}
          timeline={timeline}
          onJump={onJump}
        />
      )}
    </section>
  );
}

function CoachView({
  focus,
  stats,
  opponentStats,
  profile,
  features,
  critical,
  brief,
  onJump,
  onGeneratePuzzle,
}: {
  focus: Side;
  stats: SideStats;
  opponentStats: SideStats;
  profile: PatternProfile;
  features: FeatureEntry[];
  critical: AnalyzedEntry[];
  brief: CoachBrief;
  onJump: (ply: number) => void;
  onGeneratePuzzle?: (ply: number) => void;
}) {
  const solidMoves = stats.byClass.best + stats.byClass.excellent;
  return (
    <div className="cvs-review-grid analytics-panel__grid">
      <SummaryTile
        label={`${SIDE_NAME[focus]} accuracy`}
        value={`${stats.accuracy.toFixed(0)}%`}
        tone={accColor(stats.accuracy)}
      />
      <SummaryTile label="Average loss" value={`${stats.avgCpLoss.toFixed(2)} pawns`} />
      <SummaryTile
        label="Reliable moves"
        value={`${solidMoves} of ${stats.moves}`}
        tone="var(--good)"
      />
      <SummaryTile
        label="Practice positions"
        value={String(critical.length)}
        tone={critical.length ? 'var(--warn)' : 'var(--good)'}
      />

      <PanelCard className="cvs-review-brief">
        <Eyebrow>Coach brief</Eyebrow>
        <h4 className="analytics-coach-brief__headline">{brief.headline}</h4>
        <p className="analytics-coach-brief__diagnosis">{brief.diagnosis}</p>
        <div className="analytics-coach-brief__notes">
          <BriefNote label="Keep doing" text={brief.strength} color="var(--good)" />
          <BriefNote label="New habit" text={brief.habit} color="var(--accent-light)" />
          <BriefNote
            label="Game context"
            text={`${SIDE_NAME[focus]} ${stats.accuracy.toFixed(0)}%, ${SIDE_NAME[focus === 'w' ? 'b' : 'w']} ${opponentStats.accuracy.toFixed(0)}%.`}
            color="var(--muted)"
          />
        </div>
      </PanelCard>

      <PanelCard className="cvs-review-plan">
        <Eyebrow>Next training session</Eyebrow>
        <div className="analytics-training-steps">
          {brief.steps.map((step, index) => (
            <div key={step.title} className="analytics-training-steps__item">
              <span className="analytics-training-steps__index">{index + 1}</span>
              <div>
                <div className="analytics-training-steps__title">{step.title}</div>
                <div className="analytics-training-steps__detail">{step.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </PanelCard>

      <div className="cvs-review-full analytics-practice-header">
        <div>
          <h4 className="analytics-practice-header__title">Start with these positions</h4>
          <div className="analytics-practice-header__subtitle">
            Calculate first. Reveal the played move only afterward.
          </div>
        </div>
      </div>
      {critical.length ? (
        critical.map((entry) => (
          <MomentCard
            key={entry.ply}
            entry={entry}
            onJump={onJump}
            onGeneratePuzzle={onGeneratePuzzle}
          />
        ))
      ) : (
        <PanelCard className="cvs-review-full">
          <div className="analytics-empty-success">No major practice position found.</div>
          <div className="analytics-empty-note">
            Use the Data view to inspect smaller positional losses and recurring patterns.
          </div>
        </PanelCard>
      )}

      {profile.topPatterns.length > 0 && (
        <PanelCard className="cvs-review-full">
          <RecurringThemes profile={profile} features={features} onJump={onJump} />
        </PanelCard>
      )}
    </div>
  );
}

function RecurringThemes({
  profile,
  features,
  onJump,
}: {
  profile: PatternProfile;
  features: FeatureEntry[];
  onJump: (ply: number) => void;
}) {
  const themeTypes = profile.topPatterns.map((pattern) => pattern.type);
  const [selected, setSelected] = useState<PatternType>(themeTypes[0]);
  const activeType = themeTypes.includes(selected) ? selected : themeTypes[0];
  const activeTheme = profile.topPatterns.find((pattern) => pattern.type === activeType)!;
  const occurrences = features.flatMap((entry) =>
    entry.features.patterns
      .filter((event) => event.type === activeType)
      .map((event) => ({
        ply: entry.ply,
        move: entry.analysis.move,
        classification: entry.analysis.classification,
        cpLoss: entry.analysis.cpLoss,
        event,
      })),
  );

  return (
    <div>
      <div className="analytics-themes__header">
        <div>
          <Eyebrow>Recurring themes</Eyebrow>
          <div className="analytics-themes__subtitle">
            Select a theme to inspect every detected occurrence.
          </div>
        </div>
      </div>

      <div role="group" aria-label="Recurring themes" className="analytics-themes__chips">
        {profile.topPatterns.map((pattern) => {
          const active = pattern.type === activeType;
          return (
            <button
              key={pattern.type}
              aria-pressed={active}
              onClick={() => setSelected(pattern.type)}
              className={`analytics-theme-chip${active ? ' is-active' : ''}`}
            >
              {pattern.title}
              <span className="analytics-theme-chip__count">{pattern.count}</span>
            </button>
          );
        })}
      </div>

      <div className="analytics-theme-detail">
        <div className="analytics-theme-detail__title">{activeTheme.title}</div>
        <div className="analytics-theme-detail__copy">{activeTheme.detail}</div>
      </div>

      <ol className="analytics-theme-occurrences">
        {occurrences.map((occurrence, index) => (
          <li
            key={`${occurrence.ply}-${occurrence.event.type}-${index}`}
            className="analytics-theme-occurrences__item"
          >
            <button
              className="analytics-theme-occurrences__button"
              onClick={() => onJump(occurrence.ply)}
            >
              <strong>{occurrence.move}</strong>
              <span className="analytics-theme-occurrences__label">
                {occurrence.event.label}
                {occurrence.event.squares.length ? ` (${occurrence.event.squares.join(', ')})` : ''}
              </span>
              <span
                className="analytics-theme-occurrences__classification"
                style={{ color: CLASS_COLOR[occurrence.classification] }}
              >
                {occurrence.classification} -{occurrence.cpLoss.toFixed(1)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function MomentsView({
  focus,
  entries,
  onJump,
  onGeneratePuzzle,
}: {
  focus: Side;
  entries: AnalyzedEntry[];
  onJump: (ply: number) => void;
  onGeneratePuzzle?: (ply: number) => void;
}) {
  const moments = teachingMoments(entries, 12);
  return (
    <div className="analytics-moments">
      <div className="analytics-moments__header">
        <h4 className="analytics-moments__title">{SIDE_NAME[focus]}'s critical moments</h4>
        <p className="analytics-moments__copy">
          Ordered by evaluation loss. Use each as a calculation exercise from the position before
          the move.
        </p>
      </div>
      <div className="cvs-review-grid">
        {moments.length ? (
          moments.map((entry) => (
            <MomentCard
              key={entry.ply}
              entry={entry}
              onJump={onJump}
              onGeneratePuzzle={onGeneratePuzzle}
            />
          ))
        ) : (
          <PanelCard className="cvs-review-full">
            No adverse moments were detected for this side.
          </PanelCard>
        )}
      </div>
    </div>
  );
}

function MomentCard({
  entry,
  onJump,
  onGeneratePuzzle,
}: {
  entry: AnalyzedEntry;
  onJump: (ply: number) => void;
  onGeneratePuzzle?: (ply: number) => void;
}) {
  const analysis = entry.analysis;
  return (
    <PanelCard className="cvs-review-moment">
      <div className="analytics-moment-card__header">
        <div>
          <Eyebrow>Move {analysis.move}</Eyebrow>
          <div
            className="analytics-moment-card__classification"
            style={{ color: CLASS_COLOR[analysis.classification] }}
          >
            {analysis.classification}
          </div>
        </div>
        <span
          className="analytics-moment-card__badge"
          style={{ color: CLASS_COLOR[analysis.classification] }}
        >
          {analysis.mateProof
            ? `mate in ${analysis.mateProof.mateInMoves}`
            : `-${analysis.cpLoss.toFixed(1)}`}
        </span>
      </div>
      <p
        className="analytics-moment-card__copy"
      >
        {analysis.topExplanation || 'Find a stronger candidate move in this position.'}
      </p>
      <div className="analytics-moment-card__actions">
        <button
          className="analytics-action analytics-action--primary"
          onClick={() => onJump(Math.max(0, entry.ply - 1))}
        >
          Try from here
        </button>
        {onGeneratePuzzle && (
          <button
            className="analytics-action analytics-action--accent"
            onClick={() => onGeneratePuzzle(entry.ply)}
          >
            Generate puzzle
          </button>
        )}
        <button className="analytics-action" onClick={() => onJump(entry.ply)}>
          Show played move
        </button>
      </div>
    </PanelCard>
  );
}

function DataView({
  analytics,
  patternsW,
  patternsB,
  timeline,
  onJump,
}: {
  analytics: ReturnType<typeof computeAnalytics>;
  patternsW: PatternProfile;
  patternsB: PatternProfile;
  timeline: TimelineEvent[];
  onJump: (ply: number) => void;
}) {
  return (
    <div className="cvs-review-grid analytics-panel__grid">
      <PanelCard className="cvs-review-half">
        <SideCard title="White" color={TEAM.w} s={analytics.white} />
      </PanelCard>
      <PanelCard className="cvs-review-half">
        <SideCard title="Black" color={TEAM.b} s={analytics.black} />
      </PanelCard>
      <PanelCard className="cvs-review-half">
        <MistakeColumn
          title="White's mistakes"
          color={TEAM.w}
          moves={analytics.worstByColor.w}
          onJump={onJump}
        />
      </PanelCard>
      <PanelCard className="cvs-review-half">
        <MistakeColumn
          title="Black's mistakes"
          color={TEAM.b}
          moves={analytics.worstByColor.b}
          onJump={onJump}
        />
      </PanelCard>
      <PanelCard className="cvs-review-third">
        <PatternsSplit w={patternsW} b={patternsB} />
      </PanelCard>
      <PanelCard className="cvs-review-third">
        <MotifsSplit w={patternsW} b={patternsB} />
      </PanelCard>
      <PanelCard className="cvs-review-third">
        <PhaseSplit w={patternsW} b={patternsB} />
      </PanelCard>
      <PanelCard className="cvs-review-full">
        <Timeline events={timeline} matesFound={analytics.matesFound} onJump={onJump} />
      </PanelCard>
    </div>
  );
}

interface CoachBrief {
  headline: string;
  diagnosis: string;
  habit: string;
  strength: string;
  steps: { title: string; detail: string }[];
}

const HABIT_BY_PATTERN: Record<PatternType, string> = {
  loose_piece_habit: 'Before choosing a plan, inventory every attacked and undefended piece.',
  only_defender_moved: 'Before moving a defender, ask what becomes loose after it leaves.',
  missed_forcing_move:
    'Run a forcing-move scan: checks, captures, and direct threats for both sides.',
  king_safety_collapse:
    'Count attackers, defenders, and safe king squares before pawn moves near the king.',
  bad_capture: 'Calculate the full capture and recapture sequence before committing.',
  walked_into_motif:
    'After each candidate move, scan the opponent for forks, pins, skewers, and discovered attacks.',
  missed_free_material: 'Check for hanging material before starting a strategic plan.',
  pawn_structure_damage:
    'Name the square, file, or king shelter a pawn move gives up before playing it.',
};

function buildCoachBrief(
  side: Side,
  stats: SideStats,
  profile: PatternProfile,
  critical: AnalyzedEntry[],
): CoachBrief {
  const topPattern = profile.topPatterns[0];
  const weakestPhase = phaseByLoss(profile, 'worst');
  const strongestPhase = phaseByLoss(profile, 'best');
  const reliable = stats.byClass.best + stats.byClass.excellent;
  const sideName = SIDE_NAME[side];
  const headline = topPattern
    ? `${sideName}'s priority: ${topPattern.title.toLowerCase()}`
    : critical.length
      ? `${sideName}'s priority: improve decisions at turning points`
      : `${sideName} played a stable game`;
  const diagnosis = topPattern
    ? `${topPattern.detail} ${weakestPhase ? `The highest average loss came in the ${weakestPhase} (${profile.phase[weakestPhase].avgCpLoss.toFixed(1)} pawns per move).` : ''}`
    : critical.length
      ? `${critical.length} position${critical.length === 1 ? '' : 's'} caused most of the evaluation loss. Recalculate those positions before studying more opening theory.`
      : 'No repeated error pattern was strong enough to dominate the review. Preserve the decision process that produced this consistency.';
  const habit = topPattern
    ? HABIT_BY_PATTERN[topPattern.type]
    : "Before every move, compare at least two candidates and check the opponent's forcing reply.";
  const strength = strongestPhase
    ? `${reliable} best or excellent moves; the ${strongestPhase} was the most stable phase.`
    : `${reliable} of ${stats.moves} moves were best or excellent.`;
  return {
    headline,
    diagnosis,
    habit,
    strength,
    steps: [
      {
        title: 'Recalculate the turning points',
        detail: `Use "Try from here" on the ${Math.min(3, critical.length)} highest-loss position${critical.length === 1 ? '' : 's'}. Write down two candidates before revealing the move.`,
      },
      {
        title: 'Drill one decision habit',
        detail: habit,
      },
      {
        title: 'Replay the game actively',
        detail: `Replay ${weakestPhase ? `the ${weakestPhase}` : 'the game'} without engine lines and pause whenever the position changes tactically. Explain the opponent's threat aloud.`,
      },
    ],
  };
}

function teachingMoments(entries: AnalyzedEntry[], limit = Number.POSITIVE_INFINITY): AnalyzedEntry[] {
  const ranked = [...entries]
    .filter((entry) => entry.analysis.classification !== 'unclassified')
    .sort((a, b) => b.analysis.cpLoss - a.analysis.cpLoss);
  return ranked.filter((entry) => entry.analysis.cpLoss > 0.5).slice(0, limit);
}

function phaseByLoss(profile: PatternProfile, order: 'best' | 'worst'): Phase | null {
  const phases = (Object.entries(profile.phase) as [Phase, { moves: number; avgCpLoss: number }][])
    .filter(([, data]) => data.moves > 0)
    .sort((a, b) => a[1].avgCpLoss - b[1].avgCpLoss);
  if (!phases.length) return null;
  return order === 'best' ? phases[0][0] : phases[phases.length - 1][0];
}

function SummaryTile({
  label,
  value,
  tone = 'var(--text)',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="cvs-review-summary analytics-summary-tile">
      <div className="analytics-summary-tile__label">{label}</div>
      <div className="analytics-summary-tile__value" style={{ color: tone }}>
        {value}
      </div>
    </div>
  );
}

function PanelCard({ className, children }: { className: string; children: ReactNode }) {
  return <div className={`${className} analytics-panel-card`}>{children}</div>;
}

function BriefNote({ label, text, color }: { label: string; text: string; color: string }) {
  return (
    <div className="analytics-brief-note" style={{ borderLeftColor: color }}>
      <div className="analytics-brief-note__label" style={{ color }}>
        {label}
      </div>
      <div className="analytics-brief-note__copy">{text}</div>
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="analytics-eyebrow">{children}</div>;
}

function SegmentedControl({ children }: { children: ReactNode }) {
  return <div className="analytics-segmented">{children}</div>;
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`analytics-segmented__button${active ? ' is-active' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`analytics-view-button${active ? ' is-active' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SideCard({ title, color, s }: { title: string; color: string; s: SideStats }) {
  const total = s.moves || 1;
  return (
    <div className="analytics-side-card">
      <h4 className="analytics-side-card__title">
        <span style={{ color }}>{title}</span>{' '}
        <span style={{ color: accColor(s.accuracy) }}>{s.accuracy.toFixed(0)}%</span>
      </h4>
      <div className="analytics-side-card__meta">
        {s.moves} moves, average loss {s.avgCpLoss.toFixed(2)}
      </div>
      <div className="analytics-side-card__distribution">
        {CLASS_ORDER.map((classification) => {
          const width = (s.byClass[classification] / total) * 100;
          return width > 0 ? (
            <div
              key={classification}
              title={`${classification}: ${s.byClass[classification]}`}
              style={{ width: `${width}%`, background: CLASS_COLOR[classification] }}
            />
          ) : null;
        })}
      </div>
      <div className="analytics-side-card__legend">
        {CLASS_ORDER.filter((classification) => s.byClass[classification] > 0).map(
          (classification) => (
            <span key={classification} style={{ color: CLASS_COLOR[classification] }}>
              {s.byClass[classification]} {classification}
            </span>
          ),
        )}
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
    <div className="analytics-mistake-column">
      <h4 className="analytics-mistake-column__title" style={{ color }}>
        {title}
      </h4>
      {moves.length === 0 ? (
        <div className="analytics-mistake-column__empty">No losses above half a pawn.</div>
      ) : (
        <ol className="analytics-mistake-column__list">
          {moves.map((move) => (
            <li key={move.ply} className="analytics-mistake-column__item">
              <button className="analytics-mistake-column__move" onClick={() => onJump(move.ply)}>
                {move.move}
              </button>{' '}
              <span
                className="analytics-mistake-column__classification"
                style={{ color: CLASS_COLOR[move.classification] }}
              >
                {move.classification} (
                {move.mateIn ? `mate in ${move.mateIn}` : `-${move.cpLoss.toFixed(1)}`})
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SideLabel({ side, text, spaced }: { side: Side; text: string; spaced?: boolean }) {
  return (
    <div className={`analytics-side-label analytics-side-label--${side}${spaced ? ' is-spaced' : ''}`}>
      <span className="analytics-side-label__dot" />
      {text}
    </div>
  );
}

function PatternsSplit({ w, b }: { w: PatternProfile; b: PatternProfile }) {
  return (
    <div>
      <h4 className="analytics-data-title">Patterns</h4>
      <SideLabel side="w" text="White" />
      <PatternList profile={w} />
      <SideLabel side="b" text="Black" spaced />
      <PatternList profile={b} />
    </div>
  );
}

function PatternList({ profile }: { profile: PatternProfile }) {
  if (!profile.topPatterns.length)
    return <div className="analytics-data-empty">None detected</div>;
  return (
    <div className="analytics-pattern-list">
      {profile.topPatterns.map((pattern) => (
        <div key={pattern.type} className="analytics-pattern-list__item">
          <strong>
            {pattern.count}x {pattern.title}
          </strong>
          <div className="analytics-pattern-list__detail">{pattern.detail}</div>
        </div>
      ))}
    </div>
  );
}

function MotifsSplit({ w, b }: { w: PatternProfile; b: PatternProfile }) {
  return (
    <div>
      <h4 className="analytics-data-title">Motifs created / suffered</h4>
      <SideLabel side="w" text="White" />
      <MotifBars patterns={w} />
      <SideLabel side="b" text="Black" spaced />
      <MotifBars patterns={b} />
    </div>
  );
}

function MotifBars({ patterns }: { patterns: PatternProfile }) {
  const rows = motifRows(patterns).slice(0, 6);
  if (!rows.length) return <div className="analytics-data-empty">None detected</div>;
  return (
    <div className="analytics-motif-bars">
      {rows.map((row) => (
        <div key={row.name} className="analytics-motif-bars__row">
          <span className="analytics-motif-bars__name">{row.name}</span>
          <div className="analytics-motif-bars__track">
            <div className="analytics-motif-bars__created" style={{ width: `${row.createdPct}%` }} />
            <div className="analytics-motif-bars__suffered" style={{ width: `${row.sufferedPct}%` }} />
          </div>
          <span className="analytics-motif-bars__total">{row.total}</span>
        </div>
      ))}
    </div>
  );
}

function PhaseSplit({ w, b }: { w: PatternProfile; b: PatternProfile }) {
  return (
    <div>
      <h4 className="analytics-data-title">Phase loss (average pawns)</h4>
      <SideLabel side="w" text="White" />
      <PhaseBars patterns={w} />
      <SideLabel side="b" text="Black" spaced />
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
          <div key={phase} className="analytics-phase-bars__row">
            <span>{phase}</span>
            <div className="analytics-phase-bars__track">
              <div
                className={`analytics-phase-bars__fill${row.avgCpLoss >= 1 ? ' is-bad' : ''}`}
                style={{
                  width: `${width}%`,
                }}
              />
            </div>
            <span className="analytics-phase-bars__value">{row.avgCpLoss.toFixed(1)}</span>
          </div>
        );
      })}
    </>
  );
}

function Timeline({
  events,
  matesFound,
  onJump,
}: {
  events: TimelineEvent[];
  matesFound: number;
  onJump: (ply: number) => void;
}) {
  return (
    <div>
      <h4 className="analytics-timeline__title">Game timeline</h4>
      {matesFound > 0 && (
        <div className="analytics-timeline__note">Forced mates in play: {matesFound}</div>
      )}
      {!events.length ? (
        <div className="analytics-data-empty analytics-data-empty--large">Nothing notable yet.</div>
      ) : (
        <div className="analytics-timeline__grid">
          {events.map((event) => (
            <button
              key={event.ply}
              onClick={() => onJump(event.ply)}
              className={`analytics-timeline__event analytics-timeline__event--${event.color}`}
            >
              <strong>{event.move}</strong>
              <span style={{ color: event.tone }}>{event.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function motifRows(patterns: PatternProfile) {
  const names = new Set([
    ...Object.keys(patterns.motifCreated),
    ...Object.keys(patterns.motifSuffered),
  ]);
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
  color: Side;
  move: string;
  text: string;
  tone: string;
}

function buildTimeline(entries: AnalyzedEntry[]): TimelineEvent[] {
  return entries.flatMap((entry) => {
    const text = whatHappened(entry.analysis);
    return text
      ? [
          {
            ply: entry.ply,
            color: entry.color,
            move: entry.analysis.move,
            text,
            tone: CLASS_COLOR[entry.analysis.classification] ?? 'var(--text-soft)',
          },
        ]
      : [];
  });
}

function whatHappened(analysis: MoveAnalysis): string | null {
  if (analysis.mateProof)
    return `forced mate in ${analysis.mateProof.mateInMoves} for ${analysis.mateProof.matingSide}`;
  const notable = ['inaccuracy', 'mistake', 'blunder'].includes(analysis.classification);
  if (notable)
    return analysis.topExplanation || `${analysis.classification} (-${analysis.cpLoss.toFixed(1)})`;
  const top = analysis.rankedInsights[0];
  return top && top.saliency >= 0.5 ? analysis.topExplanation || top.type.replace(/_/g, ' ') : null;
}

function accColor(accuracy: number): string {
  if (accuracy >= 85) return 'var(--good)';
  if (accuracy >= 70) return 'var(--accent-light)';
  if (accuracy >= 55) return '#e8923b';
  return '#e23b3b';
}

// Recurring themes from the validated teaching topics (engine facts), not the
// legacy generic patterns. Computed on demand because it fetches Rust facts per
// ply via the bridge.
function TeachingThemes({
  profile,
  job,
  onCompute,
  onJump,
  gameLabelOf,
}: {
  profile: TeachingProfile | null;
  job?: TeachingThemesJob;
  onCompute: () => void;
  onJump: (gameKey: string, ply: number) => void;
  gameLabelOf?: (gameKey: string) => string;
}) {
  const topics = profile
    ? (Object.keys(profile.byTopic) as TeachingTopicId[])
        .filter((t) => (profile.byTopic[t]?.count ?? 0) > 0)
        .sort((a, b) => (profile.byTopic[b]?.count ?? 0) - (profile.byTopic[a]?.count ?? 0))
    : [];
  const [selected, setSelected] = useState<TeachingTopicId | null>(null);
  const active = selected && topics.includes(selected) ? selected : (topics[0] ?? null);
  const stats = active ? profile?.byTopic[active] : undefined;
  const running = job?.running ?? false;

  return (
    <PanelCard className="cvs-review-full">
      <div className="analytics-themes__header">
        <div>
          <Eyebrow>Teaching themes</Eyebrow>
          <div className="analytics-themes__subtitle">
            Validated teaching topics across every analyzed game in your library, from the engine
            facts.
          </div>
        </div>
        <button
          onClick={onCompute}
          disabled={running}
          className="analytics-action analytics-action--accent analytics-teaching-themes__action"
        >
          {running
            ? `Analyzing… game ${job?.done ?? 0}/${job?.total ?? 0}`
            : profile
              ? 'Recompute'
              : 'Analyze teaching themes'}
        </button>
      </div>

      {!profile && !running && (
        <div className="analytics-teaching-themes__status">
          Surface validated topics (allowed forks, missed material, pins, failed defenses, pawn
          damage) across every analyzed game in your library.
        </div>
      )}

      {profile && topics.length === 0 && !running && (
        <div className="analytics-teaching-themes__status analytics-teaching-themes__status--success">
          No teaching topics detected across your analyzed games.
        </div>
      )}

      {profile && topics.length > 0 && (
        <>
          <div className="analytics-themes__chips">
            {topics.map((t) => {
              const isActive = t === active;
              return (
                <button
                  key={t}
                  aria-pressed={isActive}
                  onClick={() => setSelected(t)}
                  className={`analytics-theme-chip${isActive ? ' is-active' : ''}`}
                >
                  {TOPIC_REGISTRY[t].displayName}
                  <span className="analytics-theme-chip__count">{profile.byTopic[t]?.count ?? 0}</span>
                </button>
              );
            })}
          </div>
          {active && stats && (
            <div className="analytics-theme-detail">
              <div className="analytics-theme-detail__title">{TOPIC_REGISTRY[active].displayName}</div>
              <div className="analytics-theme-detail__copy">
                {stats.count}× · avg loss {stats.avgCpLoss.toFixed(1)} · phases {stats.byPhase.opening}
                /{stats.byPhase.middlegame}/{stats.byPhase.endgame}
                {stats.topSquares.length ? ` · common squares ${stats.topSquares.join(', ')}` : ''}
              </div>
              <ol className="analytics-teaching-examples">
                {stats.examples.map((ex, i) => (
                  <li
                    key={`${ex.gameKey}-${ex.ply}-${i}`}
                    className="analytics-teaching-examples__item"
                  >
                    <button
                      onClick={() => onJump(ex.gameKey, ex.ply)}
                      className="analytics-teaching-examples__button"
                    >
                      {ex.headline}
                      {ex.squares.length ? (
                        <span className="analytics-teaching-examples__squares">
                          {' '}
                          {ex.squares.join(',')}
                        </span>
                      ) : null}
                      {gameLabelOf ? (
                        <span className="analytics-teaching-examples__meta">
                          {gameLabelOf(ex.gameKey)} · move {Math.floor((ex.ply + 1) / 2)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </PanelCard>
  );
}
