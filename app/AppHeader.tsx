import type { ReactNode } from 'react';
import type { CvsEngineHealth } from './cvs-engine-client';

type AppTab = 'board' | 'dataset' | 'play';
type EngineState = 'loading' | 'ready' | 'off';

export function AppHeader({
  tab,
  onTabChange,
  gameCount,
  datasetJob,
  stockfishNative,
  engineState,
  analysesCount,
  plyCount,
  cvsHealth,
  cvsBusy,
}: {
  tab: AppTab;
  onTabChange: (tab: AppTab) => void;
  gameCount: number;
  datasetJob: { running: boolean; done: number; total: number };
  stockfishNative: boolean;
  engineState: EngineState;
  analysesCount: number;
  plyCount: number;
  cvsHealth: CvsEngineHealth;
  cvsBusy: boolean;
}) {
  const insightsLabel =
    gameCount <= 1
      ? 'Insights'
      : datasetJob.running
        ? `Insights ${'\u00b7'} ${datasetJob.total ? Math.round((datasetJob.done / datasetJob.total) * 100) : 0}%`
        : `Insights ${'\u00b7'} ${gameCount}`;

  return (
    <header className="app-header">
      <div>
        <h1 className="app-header__title">
          Chess <span className="app-header__title-accent">Vision</span> Studio
        </h1>
        <div className="app-header__kicker">
          perception engine {'\u00b7'} relations {'\u00b7'} see {'\u00b7'} saliency
        </div>
      </div>

      <nav className="app-header__tabs">
        <TabButton active={tab === 'board'} onClick={() => onTabChange('board')}>
          Analyze
        </TabButton>
        <TabButton active={tab === 'play'} onClick={() => onTabChange('play')}>
          Play
        </TabButton>
        <TabButton
          active={tab === 'dataset'}
          onClick={() => onTabChange('dataset')}
          disabled={gameCount <= 1}
          title={
            gameCount <= 1
              ? 'Import a multi-game PGN (your Chess.com / Lichess export) to unlock cross-game insights'
              : undefined
          }
        >
          {insightsLabel}
        </TabButton>
      </nav>

      <span className="app-header__status">
        <EngineBadge
          label={stockfishNative ? `Stockfish ${'\u00b7'} native` : 'Stockfish'}
          state={engineState}
        />
        <CvsEngineBadge health={cvsHealth} busy={cvsBusy} />
        {engineState === 'ready' && analysesCount < plyCount && (
          <span className="app-header__progress">
            analyzing {analysesCount}/{plyCount}
            {'\u2026'}
          </span>
        )}
        {engineState === 'ready' && plyCount > 0 && analysesCount >= plyCount && (
          <span className="app-header__complete">analysis complete {'\u2713'}</span>
        )}
      </span>
    </header>
  );
}

function TabButton({
  active,
  onClick,
  children,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      className={`app-header__tab${active ? ' is-active' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

function EngineBadge({ label, state }: { label: string; state: EngineState }) {
  const text =
    state === 'loading'
      ? 'engine: loading'
      : state === 'ready'
        ? 'engine: ready'
        : 'engine: off (pure modes only)';
  return (
    <span
      title={text}
      className={`app-header__badge app-header__badge--${state}`}
    >
      {state === 'loading'
        ? `${label}: loading`
        : state === 'ready'
          ? `${label}: ready`
          : `${label}: off`}
    </span>
  );
}

function CvsEngineBadge({ health, busy }: { health: CvsEngineHealth; busy: boolean }) {
  const checking = !health.ok && !health.error;
  const text = checking
    ? 'CVS Engine: checking'
    : health.available
      ? busy
        ? 'CVS Engine: analyzing'
        : 'CVS Engine: ready'
      : 'CVS Engine: not found';
  const state = checking ? 'loading' : health.available ? 'ready' : 'off';

  return (
    <span
      title={health.error}
      className={`app-header__badge app-header__badge--cvs app-header__badge--${state}`}
    >
      {text}
    </span>
  );
}
