import { useEffect, useRef } from 'react';
import type { ModeId } from '../engine/led';
import { controlShare, type PlyFeatures } from '../engine/features';
import type { LedMap, Square } from '../engine/types';
import type { PlyRecord } from '../engine/position';
import { Board2D } from './Board2D';
import type { Arrow } from './BoardArrows';
import { AlternativeLinesPanel } from './AlternativeLinesPanel';
import { AnnotationLegend } from './AnnotationLegend';
import type { AlternativeLine } from './arrow-analysis-store';
import { LED_CSS, MODES } from './modes';
import { VariationPreviewPanel, type VariationPreviewGifJob } from './VariationPreviewPanel';
import type { VariationPreviewPosition } from './variation-preview';
import { keepInView } from './analysis-scroll';

const PROMOTION_PIECES = ['q', 'r', 'n', 'b'] as const;

export interface AnalysisBoardPanelProps {
  modeId: ModeId;
  onModePick: (id: ModeId) => void;
  engineReady: boolean;
  hideOverlays: boolean;
  onHideOverlaysChange: (value: boolean) => void;
  legalDots?: Square[];
  activeFen: string;
  ledMap: LedMap;
  selected?: Square;
  onSelect: (sq: Square) => void;
  arrows: Arrow[];
  draggable: boolean;
  onPieceDrop?: (from: Square, to: Square) => void;
  onArrowDrawn?: (from: Square, to: Square, promotion?: string) => void;
  onArrowRightClick?: (from: Square, to: Square, promotion?: string) => void;
  promotion: { from: Square; to: Square } | null;
  onPromote: (from: Square, to: Square, promotion: string) => void;
  onCancelPromotion: () => void;
  view: number;
  totalPlies: number;
  onViewChange: (view: number) => void;
  previewLine: { alt: AlternativeLine; currentIndex: number } | null;
  previewPositions: VariationPreviewPosition[];
  gifJob: VariationPreviewGifJob;
  onPreviewStep: (currentIndex: number) => void;
  onSaveVariation: () => void;
  onExportPreviewGif: () => void;
  onExitPreview: () => void;
  alternatives: AlternativeLine[];
  mainLineEval: { scoreCp: number; mate: number | null } | null;
  onPinToggle: (id: string) => void;
  onDeleteAlternative: (id: string) => void;
  onDeleteMove: (altId: string, moveIdx: number) => void;
  onDeepenAlternative: (id: string) => void;
  onEnterVariation: (alt: AlternativeLine) => void;
  onHoverAlternative: (alt: AlternativeLine | null) => void;
  onToggleReveal: (id: string) => void;
  onGenerateBestLine: (plies: number) => void;
  generatingBestLine: boolean;
  onRefuteLine: (id: string) => void;
  exporting: boolean;
  onExportAnalysis: () => void;
  features?: PlyFeatures;
  plies: PlyRecord[];
  showThreats: boolean;
  setShowThreats: (value: boolean) => void;
  showAllThreats: boolean;
  setShowAllThreats: (value: boolean) => void;
  cascade: boolean;
  setCascade: (value: boolean) => void;
  followMove: boolean;
  setFollowMove: (value: boolean) => void;
  hasSelection: boolean;
  onClearSelection: () => void;
}

export function AnalysisBoardPanel({
  modeId,
  onModePick,
  engineReady,
  hideOverlays,
  onHideOverlaysChange,
  legalDots,
  activeFen,
  ledMap,
  selected,
  onSelect,
  arrows,
  draggable,
  onPieceDrop,
  onArrowDrawn,
  onArrowRightClick,
  promotion,
  onPromote,
  onCancelPromotion,
  view,
  totalPlies,
  onViewChange,
  previewLine,
  previewPositions,
  gifJob,
  onPreviewStep,
  onSaveVariation,
  onExportPreviewGif,
  onExitPreview,
  alternatives,
  mainLineEval,
  onPinToggle,
  onDeleteAlternative,
  onDeleteMove,
  onDeepenAlternative,
  onEnterVariation,
  onHoverAlternative,
  onToggleReveal,
  onGenerateBestLine,
  generatingBestLine,
  onRefuteLine,
  exporting,
  onExportAnalysis,
  features,
  plies,
  showThreats,
  setShowThreats,
  showAllThreats,
  setShowAllThreats,
  cascade,
  setCascade,
  followMove,
  setFollowMove,
  hasSelection,
  onClearSelection,
}: AnalysisBoardPanelProps) {
  return (
    <div className="analysis-board-card">
      <div data-gif-crop="true">
        <AnalysisModeBar
          modeId={modeId}
          onPick={onModePick}
          engineReady={engineReady}
          hideOverlays={hideOverlays}
          onHideOverlaysChange={onHideOverlaysChange}
        />

        <div className="analysis-board-stage">
          <Board2D
            legalDots={legalDots}
            fen={activeFen}
            ledMap={ledMap}
            selected={selected}
            onSelect={onSelect}
            arrows={arrows}
            draggable={draggable}
            onPieceDrop={onPieceDrop}
            onArrowDrawn={onArrowDrawn}
            onArrowRightClick={onArrowRightClick}
          />
          {promotion && (
            <AnalysisPromotionOverlay
              promotion={promotion}
              onPromote={onPromote}
              onCancel={onCancelPromotion}
            />
          )}
        </div>

        <AnalysisNav view={view} total={totalPlies} onViewChange={onViewChange} />

        {previewLine && (
          <VariationPreviewPanel
            previewLine={previewLine}
            previewPositions={previewPositions}
            gifJob={gifJob}
            firstLabel={'\u23ee'}
            lastLabel={'\u23ed'}
            onStep={onPreviewStep}
            onSave={onSaveVariation}
            onExportGif={onExportPreviewGif}
            onExit={onExitPreview}
          />
        )}
      </div>

      <div data-gif-exclude="true">
        <AlternativeLinesPanel
          alternatives={alternatives}
          mainLineEval={mainLineEval}
          onPinToggle={onPinToggle}
          onDelete={onDeleteAlternative}
          onDeleteMove={onDeleteMove}
          onDeepen={onDeepenAlternative}
          onEnterVariation={onEnterVariation}
          onHoverAlternative={onHoverAlternative}
          onToggleReveal={onToggleReveal}
          onGenerateBestLine={onGenerateBestLine}
          generatingBestLine={generatingBestLine}
          onRefuteLine={onRefuteLine}
        />
        <button
          className="analysis-export-button"
          onClick={onExportAnalysis}
          disabled={exporting}
          title="Download every ply (move, classification, insights, features, board control, coach) PLUS the deterministic teaching record per ply (Rust facts, committed topics, explanation, puzzle, provenance) as a JSON training corpus."
        >
          {exporting ? 'Building teaching records...' : 'Export JSON + teaching corpus'}
        </button>
        <MiniBadges features={features} />
        <ControlBar features={features} />
        <MoveStrip plies={plies} view={view} onViewChange={onViewChange} />
        <AnnotationLegend
          showThreats={showThreats}
          setShowThreats={setShowThreats}
          showAllThreats={showAllThreats}
          setShowAllThreats={setShowAllThreats}
          cascade={cascade}
          setCascade={setCascade}
          followMove={followMove}
          setFollowMove={setFollowMove}
          hasSelection={hasSelection}
          onClear={onClearSelection}
          hideOverlays={hideOverlays}
          setHideOverlays={onHideOverlaysChange}
        />
        <ModeLegend modeId={modeId} />
      </div>
    </div>
  );
}

export function AnalysisModeBar({
  modeId,
  onPick,
  engineReady,
  hideOverlays,
  onHideOverlaysChange,
  setHideOverlays,
}: {
  modeId: ModeId;
  onPick: (id: ModeId) => void;
  engineReady: boolean;
  hideOverlays: boolean;
  onHideOverlaysChange?: (value: boolean) => void;
  setHideOverlays?: (value: boolean) => void;
}) {
  const setHidden = onHideOverlaysChange ?? setHideOverlays;
  return (
    <div className="analysis-mode-bar">
      {MODES.map((m) => {
        const disabled = m.needsAnalysis && !engineReady;
        const active = modeId === m.id;
        return (
          <button
            key={m.id}
            className={`analysis-mode-bar__button${active ? ' is-active' : ''}`}
            onClick={() => onPick(m.id)}
            disabled={disabled}
            title={disabled ? 'needs the engine' : undefined}
          >
            {m.label}
          </button>
        );
      })}
      <button
        className={`analysis-mode-bar__button analysis-mode-bar__overlay${
          hideOverlays ? ' is-active' : ''
        }`}
        onClick={() => setHidden?.(!hideOverlays)}
      >
        {hideOverlays ? 'Show Overlays' : 'Hide Overlays'}
      </button>
    </div>
  );
}

function AnalysisPromotionOverlay({
  promotion,
  onPromote,
  onCancel,
}: {
  promotion: { from: Square; to: Square };
  onPromote: (from: Square, to: Square, promotion: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="analysis-promotion-overlay">
      <div className="analysis-promotion-overlay__panel">
        <span className="analysis-promotion-overlay__label">Promote to</span>
        {PROMOTION_PIECES.map((piece) => (
          <button
            key={piece}
            className="analysis-promotion-overlay__piece"
            onClick={() => onPromote(promotion.from, promotion.to, piece)}
          >
            {piece}
          </button>
        ))}
        <button className="analysis-promotion-overlay__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function AnalysisNav({
  view,
  total,
  onViewChange,
  setView,
}: {
  view: number;
  total: number;
  onViewChange?: (view: number) => void;
  setView?: (view: number) => void;
}) {
  const changeView = onViewChange ?? setView ?? (() => {});
  return (
    <div className="analysis-nav">
      <button onClick={() => changeView(0)} disabled={view === 0}>
        {'\u23ee'}
      </button>
      <button onClick={() => changeView(Math.max(0, view - 1))} disabled={view === 0}>
        {'\u25c0'}
      </button>
      <span className="analysis-nav__count">
        ply {view} / {total}
      </span>
      <button onClick={() => changeView(Math.min(total, view + 1))} disabled={view === total}>
        {'\u25b6'}
      </button>
      <button onClick={() => changeView(total)} disabled={view === total}>
        {'\u23ed'}
      </button>
    </div>
  );
}

const BADGE_GLOSSARY: { match: string; explain: string }[] = [
  {
    match: 'Mobility',
    explain: "Mobility - change in the moving side's total legal moves (higher = freer pieces).",
  },
  {
    match: 'Safe moves',
    explain:
      "Safe moves - change in legal moves that don't drop material (Static Exchange Evaluation >= 0).",
  },
  {
    match: 'King escapes',
    explain:
      "King escapes - legal squares the side-to-move's king can flee to. 0 means no escape: mating danger.",
  },
  {
    match: 'Loose pieces',
    explain:
      "Loose pieces - the moving side's pieces with no defender. Undefended pieces are tactic targets.",
  },
  {
    match: 'Best SEE',
    explain:
      'Best capture - most material (in pawns) the side to move can safely win right now via a Static-Exchange-Evaluation-safe capture.',
  },
  {
    match: 'Motif',
    explain:
      'Tactic - the strongest proven tactic available (fork, pin, skewer, mate net); "none" if no validated tactic.',
  },
];

function badgeTitle(badge: string): string {
  const glossary = BADGE_GLOSSARY.find((x) => badge.startsWith(x.match));
  return glossary ? `${badge}\n\n${glossary.explain}` : badge;
}

export function ControlBar({ features }: { features?: PlyFeatures }) {
  const c = features ? controlShare(features.threatAfter) : undefined;
  const segs = c
    ? [
        {
          pct: c.exclusiveWhitePct,
          color: 'var(--accent)',
          label: `White ${c.exclusiveWhitePct}%`,
        },
        { pct: c.contestedPct, color: '#8a5cc4', label: `contested ${c.contestedPct}%` },
        { pct: c.exclusiveBlackPct, color: '#d43b3b', label: `Black ${c.exclusiveBlackPct}%` },
        { pct: c.neutralPct, color: '#e6e6e6', label: `neutral ${c.neutralPct}%` },
      ]
    : [];
  return (
    <div
      className="analysis-control-bar"
      title="Share of the 64 squares each side's pieces attack (contested = both)."
    >
      <div className="analysis-control-bar__header">
        <span>Board control</span>
        {c && (
          <span>
            center {c.centerWhite}-{c.centerBlack}
          </span>
        )}
      </div>
      <div className="analysis-control-bar__track">
        {segs.map((s, i) =>
          s.pct > 0 ? (
            <div
              key={i}
              className="analysis-control-bar__segment"
              title={s.label}
              style={{ width: `${s.pct}%`, background: s.color }}
            />
          ) : null,
        )}
      </div>
      {c && (
        <div
          className="analysis-control-bar__legend"
          title={`Total reach (overlaps on contested): White ${c.whitePct}%, Black ${c.blackPct}%`}
        >
          <span className="analysis-control-bar__white">White {c.exclusiveWhitePct}%</span>
          <span className="analysis-control-bar__contested">contested {c.contestedPct}%</span>
          <span className="analysis-control-bar__black">Black {c.exclusiveBlackPct}%</span>
          <span>neutral {c.neutralPct}%</span>
        </div>
      )}
    </div>
  );
}

export function MiniBadges({ features }: { features?: PlyFeatures }) {
  const badges = features?.badges ?? [
    'Mobility --',
    'Safe moves --',
    'King escapes --',
    'Loose pieces --',
    'Best SEE --',
    'Motif --',
  ];
  return (
    <div className="analysis-mini-badges">
      {badges.map((badge) => (
        <div key={badge} className="analysis-mini-badges__item" title={badgeTitle(badge)}>
          {badge}
        </div>
      ))}
    </div>
  );
}

export function ModeLegend({ modeId }: { modeId: ModeId }) {
  const mode = MODES.find((m) => m.id === modeId)!;
  return (
    <div className="analysis-mode-legend">
      {mode.legend.map((item) => (
        <span key={item.color} className="analysis-mode-legend__item">
          <span
            className="analysis-mode-legend__swatch"
            style={{ background: LED_CSS[item.color] }}
          />
          {item.meaning}
        </span>
      ))}
    </div>
  );
}

export function MoveStrip({
  plies,
  view,
  onViewChange,
  setView,
}: {
  plies: PlyRecord[];
  view: number;
  onViewChange?: (view: number) => void;
  setView?: (view: number) => void;
}) {
  const changeView = onViewChange ?? setView ?? (() => {});
  const ref = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    keepInView(ref.current, containerRef.current, 'x');
  }, [view]);
  return (
    <div ref={containerRef} className="analysis-move-strip">
      {plies.map((ply, i) => {
        const current = view === i + 1;
        return (
          <span
            key={i}
            ref={current ? ref : undefined}
            className={`analysis-move-strip__move${current ? ' is-current' : ''}`}
            onClick={() => changeView(i + 1)}
          >
            {ply.color === 'w' ? `${ply.moveNumber}. ` : ''}
            {ply.san}
          </span>
        );
      })}
    </div>
  );
}
