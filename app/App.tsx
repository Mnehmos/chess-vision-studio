import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import samplePgn from '../fixtures/sample-game.pgn?raw';
import { gamesFromPgn, type ParsedGame, type PlyRecord } from '../engine/position';
import { computeLedMap, allSquares } from '../engine/led';
import { analyzeMoveLive } from '../engine/analyze';
import { repetitionConversionWarning } from '../engine/repetition';
import type { AnalyzedEntry } from '../engine/analytics';
import { UciEngine } from '../engine/evaluation';
import {
  analyzeWithStockfishRequest,
  getStockfishHealth,
  makeNativeStockfishEngine,
  type StockfishHealth,
  type StockfishResult,
} from './stockfish-client';
import type { InsightCandidate, LedColor, LedMap, MoveAnalysis, Square } from '../engine/types';
import { tryCreateEngine } from './engine-browser';
import {
  analyzeWithCvsEngine,
  analyzeWithCvsEngineRequest,
  getCvsEngineHealth,
  getTeachingFacts,
  type CvsEngineAnalysis,
  type CvsEngineHealth,
} from './cvs-engine-client';
import { createEnginePool, defaultPoolSize, type EnginePool } from './engine-pool';
import {
  loadAnalysisCache,
  loadTeachingCache,
  saveGameAnalysis,
  saveGameTeaching,
} from './analysis-store';
import { MODES } from './modes';
import { AppHeader } from './AppHeader';
import { AppSourceBar } from './AppSourceBar';
import { ARROW, type Arrow } from './BoardArrows';
import { selectionArrows, lineArrows } from './annotate';
import { useArrowAnalysis, type AlternativeLine } from './arrow-analysis-store';
import { AnalysisBoardPanel } from './AnalysisBoardPanel';
import { AnalysisMoveHistory as MoveHistory } from './AnalysisMoveHistory';
import { AnnotationCommandList } from './AnnotationCommandList';
import { FactsPanel } from './FactsPanel';
import { MoveReviewCard } from './MoveReviewCard';
import { EngineDisagreementCard } from './EngineDisagreementCard';
import {
  buildEngineDisagreement,
  type EngineDisagreementView,
  type EngineSlot,
} from './engine-disagreement';
import { MateCard } from './MateCard';
import { AnalyticsPanel, type TeachingThemesJob } from './AnalyticsPanel';
import { DatasetPanel } from './DatasetPanel';
import { PlayMode } from './PlayMode';
import { CommentaryPanel, type CommentaryJob, type Handshake } from './CommentaryPanel';
import { LedPreview } from './LedPreview';
import { buildBoardExport, boardExportFilename, downloadJson } from './exportState';
import { plyRecordToUci, sanLineToUci } from '../engine/adapters/uci-line';
import type {
  PositionFacts,
  TeachingFactBundleV1,
  TeachingFactsRequestV1,
} from '../engine/teaching/types';
import {
  proposeTeachingHypotheses,
  verifyTeachingHypotheses,
  commitTeachingNodes,
  type TeachingNode,
} from '../engine/teaching/node';
import {
  buildBestMovePuzzle,
  buildTeachingPuzzle,
  isAlternativePuzzleSolution,
  type PuzzleStage,
} from '../engine/teaching/puzzle';
import {
  buildTeachingProfile,
  classifyPhase,
  type TeachingProfile,
  type TeachingSample,
} from '../engine/teaching/profile';
import {
  buildTeachingRecord,
  isRecordFresh,
  teachingStockfishSettings,
  type TeachingRecordV1,
} from '../engine/teaching/record';
import { TeachingFactsDebugPanel } from './TeachingFactsDebugPanel';
import { TeachingLog, whiteEvalText, whiteEvalCp, hangingNote, type CoachTurn } from './TeachingLog';
import { bookOpening } from '../engine/teaching/openings';
import { describeMoveIdea, type MoveIdea } from '../engine/teaching/moveIdea';
import { TeachingPuzzle } from './TeachingPuzzle';
import { createOpenAIClient, type ChatClient } from '../llm/openai';
import { getOpenAIProxyHealth } from './openai-client';
import { narrate, narrateTeachingPlan } from '../llm/narrate';
import { exportElementGif } from './gif-export';
import { PreviewTeachingCard } from './PreviewTeachingCard';
import { buildVariationPreviewArrows, buildVariationPreviewPositions } from './variation-preview';
import { factsRequestForPly } from './teaching-facts-request';
import {
  type AnalysisIdentityV2,
  buildHistoryHash,
  DEFAULT_ENGINE_COMPARISON_BUDGET,
  matchPositionFacts,
  normalizedScoreFromSideToMove,
} from '../engine/analysis-frame';
import {
  legalMovesFrom,
  teachingLedMap as teachingNodeLedMap,
  teachingNodeArrows,
  type VerboseMove,
} from './play-mode-helpers';
import {
  gameCacheKey,
  getFeatureEntry,
  safePlyUci,
  type CachedFeatureEntry,
} from './app-data-helpers';

const env = import.meta.env as Record<string, string | undefined>;
const initialKey = () => env.VITE_OPENAI_API_KEY || localStorage.getItem('cvs_openai_key') || '';
const OPENAI_MODEL = env.VITE_OPENAI_MODEL || 'gpt-5.5';

// ── design tokens ─────────────────────────────────────────────────────────────
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
type AppTab = 'board' | 'dataset' | 'play';

// "Analyze all games" progress. done/total count PLIES (drives the bar);
// gamesDone/gamesTotal + currentGame give a human-meaningful "Game X/Y".
export interface DatasetJob {
  running: boolean;
  done: number;
  total: number;
  gamesDone: number;
  gamesTotal: number;
  currentGame: string;
}
const IDLE_DATASET_JOB: DatasetJob = {
  running: false,
  done: 0,
  total: 0,
  gamesDone: 0,
  gamesTotal: 0,
  currentGame: '',
};

export function App() {
  const [pgnText, setPgnText] = useState(samplePgn);
  const [games, setGames] = useState<ParsedGame[]>(() => safeGames(samplePgn));
  const [gameIndex, setGameIndex] = useState(0);
  const currentGame = games[gameIndex];
  const plies = useMemo(() => currentGame?.plies ?? [], [currentGame]);
  const currentGameKey = useMemo(() => gameCacheKey(currentGame), [currentGame]);
  const [view, setView] = useState(0); // 0 = start; k = after move k
  const [tab, setTab] = useState<AppTab>('board');
  const [modeId, setModeId] = useState(MODES[0].id);
  const [selected, setSelected] = useState<Square | undefined>(undefined);
  const [analysisPromo, setAnalysisPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [showThreats, setShowThreats] = useState(true);
  const [showAllThreats, setShowAllThreats] = useState(false);
  const [cascade, setCascade] = useState(true);
  const [followMove, setFollowMove] = useState(true);
  const [hideOverlays, setHideOverlays] = useState(false);
  const [focused, setFocused] = useState<InsightCandidate | null>(null);
  const [analyses, setAnalyses] = useState<Map<number, MoveAnalysis>>(new Map());
  const [engineState, setEngineState] = useState<'loading' | 'ready' | 'off'>('loading');
  const [sfNative, setSfNative] = useState(false); // true = native Stockfish subprocess, false = WASM fallback
  const [cvsEngineHealth, setCvsEngineHealth] = useState<CvsEngineHealth>({
    ok: false,
    available: false,
  });
  // Root engine-disagreement comparison (PR-03): Stockfish + CVS on the SAME
  // fenBefore at the SAME budget. Per-engine pending is derived from
  // result/error/health, so no separate busy flag is needed.
  const [cvsEngineAnalysis, setCvsEngineAnalysis] = useState<CvsEngineAnalysis | null>(null);
  const [cvsEngineError, setCvsEngineError] = useState('');
  const [sfRootResult, setSfRootResult] = useState<StockfishResult | null>(null);
  const [sfRootError, setSfRootError] = useState('');
  const [teachingFactsRequest, setTeachingFactsRequest] = useState<TeachingFactsRequestV1 | null>(
    null,
  );
  const [teachingFacts, setTeachingFacts] = useState<TeachingFactBundleV1 | null>(null);
  const [teachingFactsBusy, setTeachingFactsBusy] = useState(false);
  const [teachingFactsError, setTeachingFactsError] = useState('');
  const [teachingFocus, setTeachingFocus] = useState<TeachingNode | null>(null);
  const [puzzleEvent, setPuzzleEvent] = useState<TeachingNode | null>(null);
  const [requestedPuzzlePly, setRequestedPuzzlePly] = useState<number | null>(null);
  const [bestMovePuzzlePly, setBestMovePuzzlePly] = useState<number | null>(null);
  const [teachingNodes, setTeachingNodes] = useState<TeachingNode[]>([]);
  const [teachingThemes, setTeachingThemes] = useState<TeachingProfile | null>(null);
  const [teachingThemesJob, setTeachingThemesJob] = useState<TeachingThemesJob>({
    running: false,
    done: 0,
    total: 0,
  });
  const teachingThemesRunRef = useRef(0);
  // Per-ply teaching corpus records (gameKey -> ply -> record), the shared
  // substrate for export, themes, and aggregation. Persists across game switches.
  const teachingRecordCacheRef = useRef<Map<string, Map<number, TeachingRecordV1>>>(new Map());
  const teachingExportRunRef = useRef(0);
  const [exporting, setExporting] = useState(false);
  const [datasetJob, setDatasetJob] = useState({ ...IDLE_DATASET_JOB });
  const engineRef = useRef<UciEngine | null>(null);
  const cvsEngineRunRef = useRef(0);
  const teachingFactsRunRef = useRef(0);
  const analysisCacheRef = useRef<Map<string, Map<number, MoveAnalysis>>>(new Map());
  const featureCacheRef = useRef<Map<string, Map<number, CachedFeatureEntry>>>(new Map());
  // analysisCacheRef is a ref (stable identity), so bump this to signal the dataset
  // views that its contents changed (after a load, a saved game, or a single ply).
  const [cacheVersion, setCacheVersion] = useState(0);
  const [previewLine, setPreviewLine] = useState<{ alt: AlternativeLine; currentIndex: number } | null>(null);
  const [hoveredAltId, setHoveredAltId] = useState<string | null>(null);
  const gifCaptureRef = useRef<HTMLDivElement | null>(null);
  const puzzleRef = useRef<HTMLElement | null>(null);
  const [gifJob, setGifJob] = useState<{ running: boolean; done: number; total: number }>({
    running: false,
    done: 0,
    total: 0,
  });
  const [scrollPuzzleOnOpen, setScrollPuzzleOnOpen] = useState(false);
  const enginePoolRef = useRef<EnginePool | null>(null);
  const [featureVersion, setFeatureVersion] = useState(0);
  const datasetRunRef = useRef(0);
  const currentGameKeyRef = useRef(currentGameKey);
  currentGameKeyRef.current = currentGameKey;

  // LLM coach commentary — clamped narrator over the cached analyses (Invariant 8).
  // Preferred path: the dev-server proxy holds the key server-side (.env). The browser
  // key (VITE_/paste-in) is only a fallback when no proxy key exists.
  const [apiKey, setApiKey] = useState<string>(initialKey);
  const [proxy, setProxy] = useState<{ checked: boolean; hasKey: boolean; model: string }>({
    checked: false,
    hasKey: false,
    model: OPENAI_MODEL,
  });
  const [handshake, setHandshake] = useState<Handshake>({ state: 'idle', detail: '' });
  const handshakeForKeyRef = useRef('');
  // Discover the server-side key (kept in .env, never shipped to the browser).
  useEffect(() => {
    let alive = true;
    getOpenAIProxyHealth(OPENAI_MODEL)
      .then((health) => alive && setProxy({ checked: true, hasKey: health.hasKey, model: health.model }))
      .catch(() => alive && setProxy((p) => ({ ...p, checked: true })));
    return () => {
      alive = false;
    };
  }, []);
  const effectiveModel = proxy.hasKey ? proxy.model : OPENAI_MODEL;
  const hasKey = proxy.hasKey || !!apiKey;
  const keySource: 'env' | 'local' | 'none' = proxy.hasKey ? 'env' : apiKey ? 'local' : 'none';
  // The right client: proxy (key server-side) if available, else the browser key.
  const commentaryClient = (): ChatClient | null => {
    if (proxy.hasKey)
      return createOpenAIClient({
        apiKey: 'via-proxy',
        model: effectiveModel,
        baseUrl: '/api/openai',
      });
    if (apiKey) return createOpenAIClient({ apiKey, model: OPENAI_MODEL });
    return null;
  };
  const [commentary, setCommentary] = useState<Map<number, string>>(new Map());
  const [commentaryJob, setCommentaryJob] = useState<CommentaryJob>({
    running: false,
    done: 0,
    total: 0,
    error: '',
  });
  const [explaining, setExplaining] = useState(false);
  const commentaryCacheRef = useRef<Map<string, Map<number, string>>>(new Map());
  // Per-game commentary cache: switch games and your generated notes come right back.
  useEffect(() => {
    setCommentary(new Map(commentaryCacheRef.current.get(currentGameKey) ?? new Map()));
  }, [currentGameKey]);

  // Boot the reference oracle. Native Stockfish subprocess when a binary is
  // configured (fast, full-SIMD); WASM Stockfish worker as automatic fallback;
  // pure modes work regardless.
  useEffect(() => {
    let alive = true;
    (async () => {
      let health: StockfishHealth | null = null;
      try {
        health = await getStockfishHealth();
      } catch {
        // proxy unreachable (e.g. static preview) — fall through to WASM.
      }
      if (!alive) return;
      if (health?.available) {
        engineRef.current = makeNativeStockfishEngine(health.depth);
        setSfNative(true);
        setEngineState('ready');
        return;
      }
      const e = await tryCreateEngine();
      if (!alive) return;
      engineRef.current = e;
      setSfNative(false);
      setEngineState(e ? 'ready' : 'off');
    })();
    return () => {
      alive = false;
      engineRef.current?.dispose();
      enginePoolRef.current?.dispose();
    };
  }, []);

  // Discover the local native CVS Engine served by Vite. The app stays usable
  // when it is absent; the comparison panel simply reports the missing binary.
  useEffect(() => {
    let alive = true;
    getCvsEngineHealth()
      .then((health) => alive && setCvsEngineHealth(health))
      .catch((e) => {
        if (!alive) return;
        setCvsEngineHealth({
          ok: false,
          available: false,
          error: String((e as Error)?.message ?? e),
        });
      });
    return () => {
      alive = false;
    };
  }, []);

  // Rehydrate analyses persisted from a previous session (IndexedDB, keyed by the
  // content-based game key) so 23k moves aren't re-ground after a reload.
  useEffect(() => {
    let alive = true;
    loadAnalysisCache().then((loaded) => {
      if (!alive || loaded.size === 0) return;
      for (const [k, v] of loaded) {
        if (!analysisCacheRef.current.has(k)) analysisCacheRef.current.set(k, v);
      }
      setCacheVersion((n) => n + 1);
      const cur = analysisCacheRef.current.get(currentGameKeyRef.current);
      if (cur && cur.size) setAnalyses(new Map(cur));
    });
    // Rehydrate the durable teaching corpus so re-review is instant (stale records
    // are dropped on load by isRecordFresh).
    loadTeachingCache().then((loaded) => {
      if (!alive) return;
      for (const [k, v] of loaded) {
        if (!teachingRecordCacheRef.current.has(k)) teachingRecordCacheRef.current.set(k, v);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const fen =
    view === 0
      ? (currentGame?.initialFen ?? plies[0]?.fenBefore ?? START_FEN)
      : plies[view - 1].fenAfter;

  const {
    arrows: analysisArrows,
    alternatives,
    handleArrowDrawn,
    togglePin,
    deleteAlternative,
    deleteMove,
    deepenAlternative,
    generateBestLine,
    generatingBestLine,
    refuteLine,
    toggleReveal,
  } = useArrowAnalysis(fen, cvsEngineHealth, engineState === 'ready');

  const previewPositions = useMemo(() => {
    return previewLine
      ? buildVariationPreviewPositions(previewLine.alt, { includeRootPosition: true })
      : [];
  }, [previewLine]);

  const activeFen = previewLine
    ? (previewPositions[previewLine.currentIndex]?.fen ?? fen)
    : fen;

  const previewArrows = useMemo<Arrow[]>(() => {
    return previewLine
      ? buildVariationPreviewArrows({
          alt: previewLine.alt,
          previewPositions,
          currentIndex: previewLine.currentIndex,
        })
      : [];
  }, [previewLine, previewPositions]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!previewLine) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (previewLine.currentIndex < previewPositions.length - 1) {
          setPreviewLine(prev => prev ? { ...prev, currentIndex: prev.currentIndex + 1 } : null);
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (previewLine.currentIndex > 0) {
          setPreviewLine(prev => prev ? { ...prev, currentIndex: prev.currentIndex - 1 } : null);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPreviewLine(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewLine, previewPositions]);

  const saveVariation = () => {
    if (!currentGame || !previewLine) return;
    const prefix = plies.slice(0, view);
    let currChess = new Chess(previewLine.alt.rootFen);
    const moves = [...previewLine.alt.moves.map(m => m.uci), ...previewLine.alt.pv];
    const nextPlies = [...prefix];
    for (const moveUci of moves) {
      const before = currChess.fen();
      const moveNumber = currChess.moveNumber();
      let moved: any = null;
      try {
        moved = currChess.move({
          from: moveUci.slice(0, 2),
          to: moveUci.slice(2, 4),
          promotion: moveUci.slice(4) || undefined,
        });
      } catch {
        break;
      }
      if (!moved) break;
      nextPlies.push({
        ply: nextPlies.length + 1,
        moveNumber,
        san: moved.san,
        color: moved.color,
        from: moved.from,
        to: moved.to,
        fenBefore: before,
        fenAfter: currChess.fen(),
      });
    }

    const branchIndex = games.length;
    const origin =
      view > 0
        ? `${plies[view - 1]?.moveNumber}${plies[view - 1]?.color === 'w' ? '.' : '...'} ${plies[view - 1]?.san}`
        : 'start';
    const firstMoveSan = nextPlies[prefix.length]?.san || '';
    const branch: ParsedGame = {
      index: branchIndex,
      headers: {
        ...currentGame.headers,
        Result: '*',
        CVSBranch: 'analysis',
        CVSBranchFrom: currentGame.label,
        CVSBranchParentIndex: String(gameIndex),
        CVSBranchAtPly: String(view),
        CVSBranchOrigin: origin,
      },
      initialFen: currentGame.initialFen,
      plies: nextPlies,
      label: `#${branchIndex + 1}  branch after ${origin}: ${firstMoveSan} (variation)`,
    };

    setGames([...games, branch]);
    setGameIndex(branchIndex);
    setView(nextPlies.length);
    setPreviewLine(null);
  };
  // Always-on legal-move hints: whatever lens is active, clicking a piece
  // shows where it can go (chess.js from the current FEN).
  const legalDots = useMemo(() => {
    if (!selected) return undefined;
    try {
      const c = new Chess(fen);
      const ms = c.moves({ square: selected as never, verbose: true }) as unknown as {
        to: string;
      }[];
      return ms.length ? (ms.map((m) => m.to) as Square[]) : undefined;
    } catch {
      return undefined;
    }
  }, [selected, fen]);

  const plyIndex = view - 1; // index into plies for the move that produced `fen`
  const analysis = view > 0 ? analyses.get(plyIndex) : undefined;
  const moveLabel =
    view > 0
      ? `${plies[plyIndex].moveNumber}${plies[plyIndex].color === 'w' ? '.' : '...'} ${plies[plyIndex].san}`
      : undefined;
  const cvsEngineFen = view > 0 ? (plies[plyIndex]?.fenBefore ?? fen) : fen;
  const cvsPlayedUci = view > 0 ? safePlyUci(plies[plyIndex]) : undefined;

  // Exact root identity for the disagreement comparison. History is threaded in
  // PR-04; for now the gate uses gameKey + ply + fenBefore (+ empty-history hash).
  const comparisonRootIdentity = useMemo<AnalysisIdentityV2>(
    () => ({
      schemaVersion: 2,
      gameKey: currentGameKey,
      ply: plyIndex >= 0 ? plyIndex : 0,
      initialFen: currentGame?.initialFen ?? cvsEngineFen,
      historyUci: [],
      historyHash: buildHistoryHash([]),
      fenBefore: cvsEngineFen,
      playedMoveUci: cvsPlayedUci,
      branch: { role: 'root', source: 'game' },
    }),
    [currentGameKey, plyIndex, currentGame, cvsEngineFen, cvsPlayedUci],
  );

  // One comparison: both engines on the SAME fenBefore at the SAME budget
  // (DEFAULT_ENGINE_COMPARISON_BUDGET). Race-guarded so a late reply can't render.
  useEffect(() => {
    if (tab !== 'board') return;
    const run = ++cvsEngineRunRef.current;
    setCvsEngineAnalysis(null);
    setCvsEngineError('');
    setSfRootResult(null);
    setSfRootError('');
    const timer = window.setTimeout(() => {
      const budget = DEFAULT_ENGINE_COMPARISON_BUDGET;
      if (cvsEngineHealth.available) {
        analyzeWithCvsEngineRequest({ fen: cvsEngineFen, budget })
          .then((r) => {
            if (cvsEngineRunRef.current === run) setCvsEngineAnalysis(r);
          })
          .catch((e) => {
            if (cvsEngineRunRef.current === run) setCvsEngineError(String((e as Error)?.message ?? e));
          });
      }
      if (engineState === 'ready') {
        analyzeWithStockfishRequest({ fen: cvsEngineFen, budget })
          .then((r) => {
            if (cvsEngineRunRef.current === run) setSfRootResult(r);
          })
          .catch((e) => {
            if (cvsEngineRunRef.current === run) setSfRootError(String((e as Error)?.message ?? e));
          });
      }
    }, 60);
    return () => {
      window.clearTimeout(timer);
      if (cvsEngineRunRef.current === run) cvsEngineRunRef.current += 1;
    };
  }, [cvsEngineFen, tab, cvsEngineHealth.available, engineState]);

  const disagreementView = useMemo<EngineDisagreementView>(() => {
    const root = comparisonRootIdentity;
    const cvsSlot: EngineSlot = !cvsEngineHealth.available
      ? { status: 'unavailable', reason: cvsEngineHealth.error || 'CVS engine off' }
      : cvsEngineError
        ? { status: 'unavailable', reason: cvsEngineError }
        : cvsEngineAnalysis
          ? {
              status: 'computed',
              result: {
                engine: 'cvs',
                identity: root,
                bestMoveUci: cvsEngineAnalysis.uci,
                score: normalizedScoreFromSideToMove({
                  fen: cvsEngineAnalysis.fen,
                  cp: cvsEngineAnalysis.scoreCp,
                  mate: cvsEngineAnalysis.mate,
                }),
                pvUci: cvsEngineAnalysis.pv,
                depth: cvsEngineAnalysis.depth,
                timeMs: cvsEngineAnalysis.timeMs,
                nodes: cvsEngineAnalysis.nodes,
              },
            }
          : { status: 'pending' };
    const sfSlot: EngineSlot =
      engineState !== 'ready'
        ? { status: 'unavailable', reason: 'Stockfish off' }
        : sfRootError
          ? { status: 'unavailable', reason: sfRootError }
          : sfRootResult
            ? {
                status: 'computed',
                result: {
                  engine: 'stockfish',
                  identity: root,
                  bestMoveUci: sfRootResult.bestmove || null,
                  score: normalizedScoreFromSideToMove({
                    fen: sfRootResult.fen,
                    cp: sfRootResult.scoreCp,
                    mate: sfRootResult.mate,
                  }),
                  pvUci: sfRootResult.pv,
                  depth: sfRootResult.depth,
                },
              }
            : { status: 'pending' };
    return buildEngineDisagreement({
      rootIdentity: root,
      budget: DEFAULT_ENGINE_COMPARISON_BUDGET,
      stockfish: sfSlot,
      cvs: cvsSlot,
    });
  }, [
    comparisonRootIdentity,
    cvsEngineHealth,
    cvsEngineError,
    cvsEngineAnalysis,
    engineState,
    sfRootError,
    sfRootResult,
  ]);

  useEffect(() => {
    if (tab !== 'board' || !cvsEngineHealth.available || view <= 0 || !plies[plyIndex]) {
      setTeachingFactsRequest(null);
      setTeachingFacts(null);
      setTeachingFactsBusy(false);
      setTeachingFactsError('');
      return;
    }
    const ply = plies[plyIndex];
    let request: TeachingFactsRequestV1;
    try {
      const playedMoveUci = plyRecordToUci(ply);
      const bestLine = analysis ? sanLineToUci(ply.fenBefore, analysis.evalBefore.pv) : [];
      if (analysis?.evalBefore.pv.length && bestLine.length !== analysis.evalBefore.pv.length) {
        throw new Error('move_conversion_failed: Stockfish best line could not be fully replayed');
      }
      const refutationLine = analysis ? sanLineToUci(ply.fenAfter, analysis.evalAfter.pv) : [];
      if (analysis?.evalAfter.pv.length && refutationLine.length !== analysis.evalAfter.pv.length) {
        throw new Error('move_conversion_failed: Stockfish refutation could not be fully replayed');
      }
      request = {
        schemaVersion: 1,
        fenBefore: ply.fenBefore,
        playedMoveUci,
        bestMoveUci: bestLine[0],
        refutationUci: refutationLine[0],
        principalVariationUci: bestLine.length ? bestLine : undefined,
        options: { includeMotifOpportunities: true, includeCounterfactual: true },
      };
    } catch (error) {
      setTeachingFactsRequest(null);
      setTeachingFacts(null);
      setTeachingFactsBusy(false);
      setTeachingFactsError(String((error as Error)?.message ?? error));
      return;
    }

    const run = ++teachingFactsRunRef.current;
    setTeachingFactsRequest(request);
    setTeachingFacts(null);
    setTeachingFactsBusy(true);
    setTeachingFactsError('');
    const timer = window.setTimeout(() => {
      getTeachingFacts(request)
        .then((result) => {
          if (teachingFactsRunRef.current === run) setTeachingFacts(result);
        })
        .catch((error) => {
          if (teachingFactsRunRef.current === run) {
            setTeachingFactsError(String((error as Error)?.message ?? error));
          }
        })
        .finally(() => {
          if (teachingFactsRunRef.current === run) setTeachingFactsBusy(false);
        });
    }, 80);
    return () => {
      window.clearTimeout(timer);
      if (teachingFactsRunRef.current === run) teachingFactsRunRef.current += 1;
    };
  }, [analysis, cvsEngineHealth.available, plies, plyIndex, tab, view]);

  // ── LLM commentary handlers ────────────────────────────────────────────────
  const saveKey = (key: string) => {
    localStorage.setItem('cvs_openai_key', key);
    setApiKey(key);
  };
  const runHandshake = async () => {
    const client = commentaryClient();
    if (!client) return;
    setHandshake({ state: 'testing', detail: '' });
    try {
      const reply = await client.ping();
      setHandshake({ state: 'ok', detail: reply.slice(0, 60) });
    } catch (e) {
      setHandshake({ state: 'error', detail: String((e as Error)?.message ?? e) });
    }
  };
  // Auto-handshake once a usable key is known (server proxy or browser), so the status
  // is live without a surprise token cost on every reload.
  useEffect(() => {
    if (!proxy.checked) return;
    const token = proxy.hasKey ? `proxy:${effectiveModel}` : apiKey;
    if (token && handshakeForKeyRef.current !== token) {
      handshakeForKeyRef.current = token;
      void runHandshake();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxy.checked, proxy.hasKey, effectiveModel, apiKey]);
  const cacheCommentary = (gameKey: string, next: Map<number, string>) => {
    commentaryCacheRef.current.set(gameKey, new Map(next));
  };
  const explainCurrent = async () => {
    const client = commentaryClient();
    if (!client || !analysis || plyIndex < 0) return;
    setExplaining(true);
    try {
      const feat = getFeatureEntry(
        featureCacheRef.current,
        currentGameKey,
        plies[plyIndex],
        plyIndex,
        analysis,
      ).features;
      const text = await narrate(client, analysis, feat);
      setCommentary((prev) => {
        const next = new Map(prev).set(plyIndex, text);
        cacheCommentary(currentGameKey, next);
        return next;
      });
    } catch (e) {
      setCommentaryJob((j) => ({ ...j, error: String((e as Error)?.message ?? e) }));
    } finally {
      setExplaining(false);
    }
  };
  const generateAllCommentary = async () => {
    const client = commentaryClient();
    if (!client) return;
    const targets = [...analyses.keys()].sort((a, b) => a - b);
    const gameKey = currentGameKey;
    setCommentaryJob({ running: true, done: 0, total: targets.length, error: '' });
    try {
      for (let k = 0; k < targets.length; k++) {
        const idx = targets[k];
        if (!commentaryCacheRef.current.get(gameKey)?.has(idx)) {
          const a = analyses.get(idx);
          if (a && plies[idx]) {
            const feat = getFeatureEntry(
              featureCacheRef.current,
              gameKey,
              plies[idx],
              idx,
              a,
            ).features;
            const text = await narrate(client, a, feat);
            if (currentGameKeyRef.current !== gameKey) return; // user switched games — stop
            setCommentary((prev) => {
              const next = new Map(prev).set(idx, text);
              cacheCommentary(gameKey, next);
              return next;
            });
          }
        }
        setCommentaryJob((j) => ({ ...j, done: k + 1 }));
      }
    } catch (e) {
      setCommentaryJob((j) => ({ ...j, error: String((e as Error)?.message ?? e) }));
    } finally {
      setCommentaryJob((j) => ({ ...j, running: false }));
    }
  };

  // Track the live view so the preloader can prioritize the position being looked at.
  const viewRef = useRef(view);
  viewRef.current = view;
  const claimedRef = useRef<Set<number>>(new Set());

  // PRELOAD: when the engine is ready, analyze EVERY ply once in the background and
  // cache it, so stepping through the game is instant (no per-click eval). The
  // currently-viewed ply jumps the queue. The single shared engine is serialized,
  // so this fills progressively without overlapping searches.
  useEffect(() => {
    if (engineState !== 'ready') return;
    if (datasetJob.running) return;
    const engine = engineRef.current;
    if (!engine) return;
    const cached = analysisCacheRef.current.get(currentGameKey) ?? new Map<number, MoveAnalysis>();
    claimedRef.current = new Set(cached.keys());
    setAnalyses(new Map(cached));
    let alive = true;

    (async () => {
      const total = plies.length;
      const firstUnclaimed = () => {
        for (let i = 0; i < total; i++) if (!claimedRef.current.has(i)) return i;
        return -1;
      };
      while (alive) {
        const vIdx = viewRef.current - 1;
        const target = vIdx >= 0 && !claimedRef.current.has(vIdx) ? vIdx : firstUnclaimed();
        if (target < 0) break; // whole game analyzed
        claimedRef.current.add(target);
        try {
          const a = withRepetitionWarning(
            await analyzeMoveLive(engine, plies[target].fenBefore, plies[target].san),
            plies,
            target,
          );
          if (!alive) return;
          setAnalyses((prev) => {
            const next = new Map(prev).set(target, a);
            analysisCacheRef.current.set(currentGameKey, new Map(next));
            return next;
          });
        } catch {
          claimedRef.current.delete(target); // let it retry later
        }
      }
      // Whole game analyzed in the background → make it durable + flip its ✓.
      const done = analysisCacheRef.current.get(currentGameKey);
      if (alive && total > 0 && done && done.size >= total) {
        void saveGameAnalysis(currentGameKey, done);
        setCacheVersion((n) => n + 1);
      }
    })();

    return () => {
      alive = false;
    };
  }, [engineState, plies, currentGameKey, datasetJob.running]);

  // On move advance, snap the inspection to the piece that JUST MOVED ("follow
  // move"), so BOTH the arrows and the active mode (e.g. Legal Move) broadcast the
  // move that just happened. A manual click overrides until the next advance.
  // Also clear any focused insight / teaching event when the ply changes.
  useEffect(() => {
    setFocused(null);
    setTeachingFocus(null);
    setPuzzleEvent(null);
    setBestMovePuzzlePly(null);
    if (followMove) setSelected(view > 0 ? (plies[view - 1]?.to as Square) : undefined);
  }, [view, plies, followMove]);

  // Compile Rust facts + the Stockfish grade into committed teaching events and run progressive verification.
  useEffect(() => {
    if (!teachingFacts || !analysis || !plies[view - 1]) {
      setTeachingNodes([]);
      return;
    }
    const ply = plies[view - 1];
    const playedMoveUci = plyRecordToUci(ply);
    const bestLine = analysis ? sanLineToUci(ply.fenBefore, analysis.evalBefore.pv) : [];

    const defaultPolicy = {
      tacticalClaims: 'required' as const,
      counterfactualClaims: 'required' as const,
      betterMoveClaims: 'required' as const,
      structuralClaims: 'deterministic-or-engine' as const,
      minimumDepth: 14,
      timeoutMs: 1000,
    };

    const request = {
      rootFen: ply.fenBefore,
      subjectMove: playedMoveUci,
      resultingFen: ply.fenAfter,
      principalVariation: bestLine,
      verificationPolicy: defaultPolicy,
      facts: teachingFacts,
    };

    // 1. Propose immediately
    const hypotheses = proposeTeachingHypotheses(teachingFacts, request);
    const initialNodes = commitTeachingNodes(teachingFacts, hypotheses);
    setTeachingNodes(initialNodes);

    let alive = true;
    const engine = engineRef.current;

    if (engine && engineState === 'ready') {
      (async () => {
        // Run verification using the engine
        const verified = await verifyTeachingHypotheses(
          { ...request, engine },
          hypotheses,
          teachingFacts
        );
        if (!alive) return;
        const committed = commitTeachingNodes(teachingFacts, verified);
        setTeachingNodes(committed);
      })();
    }

    return () => {
      alive = false;
    };
  }, [teachingFacts, analysis, view, plies, engineState]);

  // What the played move accomplishes (fork/pin/winning capture) — shown when the
  // move wasn't a mistake, so strong moves aren't reported as "no teaching topic".
  const teachingIdea = useMemo<MoveIdea | null>(
    () => (teachingFacts ? describeMoveIdea(teachingFacts) : null),
    [teachingFacts],
  );

  // The teaching log for Analyze: one turn per analyzed move up to the current view,
  // built from the SAME shape Play uses. Every move carries its summary + White-eval;
  // the move you're standing on (view-1) carries the full rich teaching (events/idea)
  // since that's the position whose Rust facts are loaded.
  const analyzeLog = useMemo<CoachTurn[]>(() => {
    const sans = plies.map((p) => p.san);
    const turns: CoachTurn[] = [];
    for (let i = 0; i < view; i += 1) {
      const a = analyses.get(i);
      if (!a) continue;
      const side: 'w' | 'b' = i % 2 === 0 ? 'w' : 'b';
      const current = i === view - 1;
      turns.push({
        ply: i,
        who: 'you',
        side,
        san: plies[i]?.san ?? '',
        classification: a.classification,
        cpLoss: a.cpLoss,
        betterMove: a.evalBefore.pv[0],
        teaching: null,
        nodes: current ? teachingNodes : [],
        idea: current ? teachingIdea : null,
        hazardNote: current && teachingFacts ? hangingNote(teachingFacts, teachingNodes) : undefined,
        summary: a.topExplanation,
        evalText: whiteEvalText(a, side),
        evalCp: whiteEvalCp(a, side),
        opening: bookOpening(sans.slice(0, i + 1)),
        status: 'done',
      });
    }
    return turns;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plies, analyses, view, teachingNodes, teachingIdea, cacheVersion]);

  // The engine PositionFacts matching the board right now — Square facts reads the
  // inspected piece's attackers/defenders/SEE from here (matched by piece placement).
  const engineSquareFacts = useMemo<PositionFacts | null>(() => {
    if (!teachingFacts) return null;
    // Fail closed on the full legal-position key (placement + side-to-move +
    // castling + en-passant), not piece placement alone (AnalysisFrameV2 §3.1):
    // a stale bundle, or one for a position that shares placement but differs in
    // side-to-move/castling/en-passant, yields no facts rather than the wrong ones.
    return matchPositionFacts(teachingFacts, fen)?.position ?? null;
  }, [teachingFacts, fen]);

  const bestMovePuzzle = useMemo(
    () =>
      bestMovePuzzlePly === view && teachingFacts ? buildBestMovePuzzle(teachingFacts) : null,
    [bestMovePuzzlePly, view, teachingFacts],
  );

  // A two-stage practice puzzle for a named teaching event, falling back to a
  // single-stage best-move drill for plain inaccuracies.
  const teachingPuzzle = useMemo(() => {
    const eventPuzzle =
      puzzleEvent && teachingFacts ? buildTeachingPuzzle(puzzleEvent, teachingFacts) : null;
    return eventPuzzle ?? bestMovePuzzle;
  }, [puzzleEvent, teachingFacts, bestMovePuzzle]);

  useEffect(() => {
    if (requestedPuzzlePly === null || requestedPuzzlePly !== view) return;
    if (teachingFactsBusy || !teachingFacts) return;

    const event = teachingNodes.find((node) => buildTeachingPuzzle(node, teachingFacts));
    if (event) {
      setPuzzleEvent(event);
      setBestMovePuzzlePly(null);
      setRequestedPuzzlePly(null);
      return;
    }

    if (buildBestMovePuzzle(teachingFacts)) {
      setPuzzleEvent(null);
      setBestMovePuzzlePly(view);
      setRequestedPuzzlePly(null);
    }
  }, [requestedPuzzlePly, view, teachingFactsBusy, teachingFacts, teachingNodes]);

  useEffect(() => {
    if (!teachingPuzzle || !scrollPuzzleOnOpen) return;
    window.setTimeout(() => {
      puzzleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setScrollPuzzleOnOpen(false);
    }, 80);
  }, [teachingPuzzle, scrollPuzzleOnOpen]);

  const gradePuzzleAlternative = async (stage: PuzzleStage, uci: string): Promise<boolean> => {
    const engine = engineRef.current;
    if (!analysis || !engine || stage.requiredAvoidedFacts.length === 0) return false;

    try {
      const candidate = new Chess(stage.fen);
      const move = candidate.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4) || undefined,
      });
      if (!move) return false;

      const [candidateBundle, candidateAfterEval] = await Promise.all([
        getTeachingFacts({
          schemaVersion: 1,
          fenBefore: stage.fen,
          playedMoveUci: uci,
          options: { includeMotifOpportunities: true, includeCounterfactual: false },
        }),
        engine.evaluate({ fen: candidate.fen(), depth: analysis.evalBefore.depth }),
      ]);

      return isAlternativePuzzleSolution(
        stage,
        uci,
        candidateBundle.played,
        analysis.evalBefore,
        candidateAfterEval,
      );
    } catch {
      return false;
    }
  };

  // Teaching themes are LIBRARY-wide (aggregated across every analyzed game), so a
  // game switch must NOT drop them — the profile persists until a new PGN is loaded
  // (loadPgn) or the user recomputes. Switching games only navigates examples.

  // Shared corpus pass: fetch Rust facts for a game's analyzed plies, build a full
  // teaching record per ply, and cache it (gameKey -> plyIndex -> record). Reused by
  // export, themes, and aggregation; the cache makes re-runs free. Bridge-bound +
  // concurrency-capped; bails if a newer pass on the same runRef supersedes it.
  const computeTeachingRecords = async (
    gameKey: string,
    recordPlies: PlyRecord[],
    analysesMap: Map<number, MoveAnalysis>,
    runRef: { current: number },
    runId: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<number, TeachingRecordV1>> => {
    let records = teachingRecordCacheRef.current.get(gameKey);
    if (!records) {
      records = new Map<number, TeachingRecordV1>();
      teachingRecordCacheRef.current.set(gameKey, records);
    }
    const cache = records;
    const tasks: { ply: number; record: PlyRecord; analysis: MoveAnalysis }[] = [];
    recordPlies.forEach((p, i) => {
      const a = analysesMap.get(i);
      // Recompute when uncached OR when the cached record is stale (older compiler/
      // schema) — the versioned cache never serves stale topics.
      const cached = cache.get(i);
      if (a && !(cached && isRecordFresh(cached, teachingStockfishSettings(a)))) {
        tasks.push({ ply: i, record: p, analysis: a });
      }
    });
    let done = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < tasks.length) {
        const t = tasks[cursor++];
        if (!t || runRef.current !== runId) return;
        const request = factsRequestForPly(t.record, t.analysis);
        if (request) {
          try {
            const facts = await getTeachingFacts(request);
            cache.set(
              t.ply,
              buildTeachingRecord({
                gameKey,
                ply: t.ply,
                san: t.record.san,
                analysis: t.analysis,
                facts,
              }),
            );
          } catch {
            // Skip a ply whose facts request fails — never count it as "no mistake".
          }
        }
        done += 1;
        onProgress?.(done, tasks.length);
      }
    };
    await Promise.all(Array.from({ length: 4 }, () => worker()));
    // Persist the freshly computed records (durable local corpus + instant re-review).
    if (tasks.length > 0 && runRef.current === runId) void saveGameTeaching(gameKey, cache);
    return cache;
  };

  // On-demand teaching themes — LIBRARY-wide: compute (or reuse cached) records for
  // EVERY analyzed game, then aggregate all committed events into one cross-game
  // profile. This is the player profile ("across your games you allowed N forks"),
  // not just the active game. Records are cached + persisted per game, so a second
  // run only touches games analyzed since the last pass.
  const runTeachingThemes = async () => {
    if (teachingThemesJob.running || !cvsEngineHealth.available) return;
    const runId = ++teachingThemesRunRef.current;
    // Every game with at least one analyzed ply is in scope.
    const jobs = games
      .map((game) => {
        const key = gameCacheKey(game);
        return { game, key, analyses: analysisCacheRef.current.get(key) };
      })
      .filter(
        (j): j is { game: ParsedGame; key: string; analyses: Map<number, MoveAnalysis> } =>
          !!j.analyses && [...j.analyses.keys()].some((i) => j.game.plies[i]),
      );
    if (jobs.length === 0) return;
    setTeachingThemesJob({ running: true, done: 0, total: jobs.length });
    const samples: TeachingSample[] = [];
    for (let g = 0; g < jobs.length; g += 1) {
      if (teachingThemesRunRef.current !== runId) return;
      const job = jobs[g];
      const records = await computeTeachingRecords(
        job.key,
        job.game.plies,
        job.analyses,
        teachingThemesRunRef,
        runId,
      );
      if (teachingThemesRunRef.current !== runId) return;
      job.game.plies.forEach((p, i) => {
        const rec = records.get(i);
        if (rec) {
          const phase = classifyPhase(i, p.fenBefore);
          for (const event of rec.events) samples.push({ event, gameKey: job.key, ply: p.ply, phase });
        }
      });
      setTeachingThemesJob({ running: true, done: g + 1, total: jobs.length });
    }
    if (teachingThemesRunRef.current !== runId) return;
    setTeachingThemes(buildTeachingProfile(samples));
    setTeachingThemesJob((job) => ({ ...job, running: false }));
  };

  // Jump to a teaching example that may live in another game: switch to that game
  // (loading its analyses) and surface the position on the board.
  const jumpToTeachingExample = (gameKey: string, ply: number) => {
    const idx = games.findIndex((game) => gameCacheKey(game) === gameKey);
    if (idx < 0) return;
    const target = games[idx];
    if (idx !== gameIndex) selectGame(idx);
    setView(Math.max(0, Math.min(target.plies.length, ply)));
    setTab('board');
  };

  const generatePuzzleFromPly = (ply: number) => {
    if (!cvsEngineHealth.available) return;
    const target = Math.max(1, Math.min(plies.length, ply));
    setRequestedPuzzlePly(target);
    setPuzzleEvent(null);
    setBestMovePuzzlePly(null);
    setScrollPuzzleOnOpen(true);
    setView(target);
    setTab('board');
  };

  // A human-readable tag for an example's source game (cross-game profiles list
  // examples from many games). Prefers "White–Black", falls back to the label.
  const teachingGameLabel = (gameKey: string): string => {
    const game = games.find((g) => gameCacheKey(g) === gameKey);
    if (!game) return 'Unknown game';
    const white = game.headers.White ?? '';
    const black = game.headers.Black ?? '';
    if (white || black) return `${white || '?'}–${black || '?'}`;
    return game.label ?? 'Game';
  };

  // LED: a focused teaching event or insight overrides the mode overlay.
  const ledMap = useMemo(() => {
    if (hideOverlays) return { mode: 'off' as any, squares: {} };
    if (teachingFocus) return teachingNodeLedMap(teachingFocus, 'focus');
    if (focused) return focusLedMap(focused);
    return computeLedMap(modeId, { fen, selectedSquare: selected, analysis });
  }, [modeId, fen, selected, analysis, focused, teachingFocus, hideOverlays]);

  // Annotation arrows:
  //   • selected piece — DEFENDERS (green in), ATTACKERS (red in), and the piece's
  //     OWN attacks raycast OUTWARD (magenta out)
  //   • threat lines — the top refutation's call-and-response sequence, or ALL of
  //     them, each numbered and colored by the moving side
  const baseArrows = useMemo<Arrow[]>(() => {
    if (hideOverlays) return [];
    // TEACHING FOCUS: a clicked teaching event draws its played move, punishment,
    // and correction and suppresses everything else.
    if (teachingFocus) return teachingNodeArrows(teachingFocus);
    // FOCUS MODE: a clicked insight spotlights only its own line; everything else
    // is suppressed so the user sees exactly that one tactic.
    if (focused) return lineArrows(fen, focused, false);

    const out: Arrow[] = [];

    // The played move itself — a subtle slate arrow (thin, small head) so "moved
    // here" never reads as "attacks here".
    if (followMove && view > 0) {
      const p = plies[view - 1];
      if (p)
        out.push({ from: p.from as Square, to: p.to as Square, color: ARROW.move, move: true });
    }

    if (selected) out.push(...selectionArrows(fen, selected, cascade));

    if (analysis && analysis.rankedInsights.length) {
      const top = analysis.rankedInsights[0];
      const threats = showAllThreats
        ? analysis.rankedInsights.filter(
            (i) => i.source === 'refutation' || i.source === 'available',
          )
        : showThreats && top.source === 'refutation'
          ? [top]
          : [];
      for (const ins of threats) out.push(...lineArrows(fen, ins, ins !== top));
    }
    return out;
  }, [
    fen,
    selected,
    analysis,
    showThreats,
    showAllThreats,
    cascade,
    focused,
    teachingFocus,
    followMove,
    view,
    plies,
    hideOverlays,
  ]);

  const arrows = useMemo(() => {
    if (previewLine) return previewArrows;

    if (hoveredAltId) {
      const alt = alternatives.find((x) => x.id === hoveredAltId);
      if (alt) {
        return [...baseArrows, ...analysisArrows].map((a) => {
          const isFromAlt = alt.moves.some(
            (m) => m.from === a.from && m.to === a.to && m.promotion === a.promotion
          );
          const isBase = baseArrows.includes(a);
          return {
            ...a,
            dim: !isBase && !isFromAlt,
          };
        });
      }
    }
    return [...baseArrows, ...analysisArrows];
  }, [baseArrows, analysisArrows, hoveredAltId, previewLine, previewArrows]);

  // Keyboard navigation: ← → step, Home/End jump.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (previewLine) return;
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft') setView((v) => Math.max(0, v - 1));
      else if (e.key === 'ArrowRight') setView((v) => Math.min(plies.length, v + 1));
      else if (e.key === 'Home') setView(0);
      else if (e.key === 'End') setView(plies.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plies.length]);

  const resetViewState = (nextAnalyses: Map<number, MoveAnalysis>) => {
    setView(0);
    setSelected(undefined);
    setFocused(null);
    setAnalyses(new Map(nextAnalyses));
    claimedRef.current = new Set(nextAnalyses.keys());
  };
  const loadPgn = () => {
    const g = gamesFromPgn(pgnText);
    if (g.length) {
      datasetRunRef.current += 1;
      setDatasetJob({ ...IDLE_DATASET_JOB });
      // Keep analysisCacheRef: it's keyed by content, so re-importing the same games
      // reuses their persisted analyses. Feature cache is cheap/derived — drop it.
      featureCacheRef.current = new Map();
      // The teaching profile is library-wide; a new library invalidates it.
      teachingThemesRunRef.current += 1;
      setTeachingThemes(null);
      setTeachingThemesJob({ running: false, done: 0, total: 0 });
      setGames(g);
      setGameIndex(0);
      resetViewState(analysisCacheRef.current.get(gameCacheKey(g[0])) ?? new Map());
      setCacheVersion((n) => n + 1);
    }
  };
  const selectGame = (i: number) => {
    setGameIndex(i);
    resetViewState(analysisCacheRef.current.get(gameCacheKey(games[i])) ?? new Map());
  };
  const returnToBranchSource = () => {
    if (!currentGame || currentGame.headers.CVSBranch !== 'analysis') return;
    const parentIndex = Number(currentGame.headers.CVSBranchParentIndex ?? 0);
    const parent = games[parentIndex];
    if (!parent) return;
    const atPly = Number(currentGame.headers.CVSBranchAtPly ?? 0);
    setGameIndex(parentIndex);
    resetViewState(analysisCacheRef.current.get(gameCacheKey(parent)) ?? new Map());
    setView(Math.max(0, Math.min(parent.plies.length, Number.isFinite(atPly) ? atPly : 0)));
  };

  const exportPreviewGif = async () => {
    if (!previewLine || !gifCaptureRef.current || gifJob.running) return;
    const originalIndex = previewLine.currentIndex;
    setGifJob({ running: true, done: 0, total: previewPositions.length });
    try {
      await exportElementGif({
        element: gifCaptureRef.current,
        frameCount: previewPositions.length,
        filename: `cvs-teaching-${Date.now()}.gif`,
        setFrame: (index) =>
          setPreviewLine((current) => (current ? { ...current, currentIndex: index } : current)),
        onProgress: (done, total) => setGifJob({ running: true, done, total }),
      });
    } finally {
      setPreviewLine((current) =>
        current
          ? {
              ...current,
              currentIndex: Math.min(originalIndex, Math.max(0, previewPositions.length - 1)),
            }
          : current,
      );
      setGifJob({ running: false, done: 0, total: 0 });
    }
  };

  const applyAnalysisMove = (from: Square, to: Square, promotion?: string) => {
    if (!currentGame) return;
    const before = fen;
    const chess = new Chess(before);
    const moveNumber = chess.moveNumber();
    let moved: VerboseMove | null = null;
    try {
      moved = chess.move({ from, to, promotion }) as unknown as VerboseMove;
    } catch {
      moved = null;
    }
    if (!moved) return;

    const prefix = plies.slice(0, view);
    const nextPly: PlyRecord = {
      ply: prefix.length + 1,
      moveNumber,
      san: moved.san,
      color: moved.color,
      from: moved.from,
      to: moved.to,
      fenBefore: before,
      fenAfter: chess.fen(),
    };
    const nextPlies = [...prefix, nextPly];
    const nextAnalyses = new Map([...analyses].filter(([i]) => i < prefix.length));
    const canExtendCurrentBranch =
      currentGame.headers.CVSBranch === 'analysis' && view === plies.length;

    if (canExtendCurrentBranch) {
      const updated: ParsedGame = { ...currentGame, plies: nextPlies };
      setGames(games.map((g, i) => (i === gameIndex ? updated : g)));
      analysisCacheRef.current.set(gameCacheKey(updated), nextAnalyses);
    } else {
      const branchIndex = games.length;
      const origin =
        view > 0
          ? `${plies[view - 1]?.moveNumber}${plies[view - 1]?.color === 'w' ? '.' : '...'} ${plies[view - 1]?.san}`
          : 'start';
      const branch: ParsedGame = {
        index: branchIndex,
        headers: {
          ...currentGame.headers,
          Result: '*',
          CVSBranch: 'analysis',
          CVSBranchFrom: currentGame.label,
          CVSBranchParentIndex: String(gameIndex),
          CVSBranchAtPly: String(view),
          CVSBranchOrigin: origin,
        },
        initialFen: currentGame.initialFen,
        plies: nextPlies,
        label: `#${branchIndex + 1}  branch after ${origin}: ${moved.san}`,
      };
      setGames([...games, branch]);
      setGameIndex(branchIndex);
      analysisCacheRef.current.set(gameCacheKey(branch), nextAnalyses);
    }

    setView(nextPlies.length);
    setAnalyses(nextAnalyses);
    claimedRef.current = new Set(nextAnalyses.keys());
    setSelected(followMove ? (moved.to as Square) : undefined);
    setFocused(null);
    setAnalysisPromo(null);
    setCacheVersion((n) => n + 1);
  };
  const tryAnalysisMove = (from: Square, to: Square) => {
    const matches = legalMovesFrom(fen, from).filter((m) => m.to === to);
    if (!matches.length) return;
    if (matches.every((m) => m.promotion)) {
      setAnalysisPromo({ from, to });
      return;
    }
    applyAnalysisMove(from, to, matches[0].promotion);
  };
  const onAnalysisSquareClick = (sq: Square) => {
    if (analysisPromo) return;
    // Clicking the board returns to normal inspection: drop any latched teaching
    // overlay so selection/threat arrows + mode LED show again.
    setTeachingFocus(null);
    if (selected) {
      const legalTargets = legalMovesFrom(fen, selected).map((m) => m.to as Square);
      if (legalTargets.includes(sq)) {
        tryAnalysisMove(selected, sq);
        return;
      }
      if (selected === sq) {
        setSelected(undefined);
        setFocused(null);
        return;
      }
    }
    setFocused(null);
    setSelected(sq);
  };
  const analyzeAllGames = async () => {
    if (engineState !== 'ready' || datasetJob.running) return;
    const runId = ++datasetRunRef.current;
    const tasks = games.flatMap((game) => {
      const key = gameCacheKey(game);
      const cached = analysisCacheRef.current.get(key) ?? new Map<number, MoveAnalysis>();
      return game.plies
        .map((ply, plyIndex) => ({ game, key, ply, plyIndex }))
        .filter((task) => !cached.has(task.plyIndex));
    });
    if (tasks.length === 0) {
      setDatasetJob({ ...IDLE_DATASET_JOB });
      return;
    }
    // Per-game remaining counts → we can mark a game "done" + persist it the instant
    // its last ply lands, even though many games are in flight at once.
    const remainingByKey = new Map<string, number>();
    for (const t of tasks) remainingByKey.set(t.key, (remainingByKey.get(t.key) ?? 0) + 1);
    const gamesTotal = remainingByKey.size;
    setDatasetJob({
      running: true,
      done: 0,
      total: tasks.length,
      gamesDone: 0,
      gamesTotal,
      currentGame: 'starting engines…',
    });

    // The actual work for one ply — shared by the pool and the single-engine fallback.
    const analyzeTask = async (engine: UciEngine, task: (typeof tasks)[number]) => {
      if (datasetRunRef.current !== runId) return;
      const a = withRepetitionWarning(
        await analyzeMoveLive(engine, task.ply.fenBefore, task.ply.san),
        task.game.plies,
        task.plyIndex,
      );
      if (datasetRunRef.current !== runId) return;
      const cached = analysisCacheRef.current.get(task.key) ?? new Map<number, MoveAnalysis>();
      cached.set(task.plyIndex, a);
      analysisCacheRef.current.set(task.key, cached);
      if (task.key === currentGameKeyRef.current) {
        setAnalyses((prev) => new Map(prev).set(task.plyIndex, a));
      }
      const rem = (remainingByKey.get(task.key) ?? 1) - 1;
      remainingByKey.set(task.key, rem);
      if (rem === 0) {
        gamesDone += 1;
        const gd = gamesDone;
        setDatasetJob((prev) => ({ ...prev, gamesDone: gd, currentGame: task.game.label }));
        void saveGameAnalysis(task.key, analysisCacheRef.current.get(task.key)!); // durable
        setCacheVersion((n) => n + 1);
      }
    };
    const onProgress = (done: number) => {
      if (datasetRunRef.current === runId)
        setDatasetJob((prev) => ({ ...prev, done: Math.min(done, prev.total) }));
    };

    let gamesDone = 0;
    // Native rust path: the champion analyzes a position in tens of ms, so even
    // a few serialized streams beat the browser-Stockfish worker pool. Falls
    // back to the browser pool automatically when the bridge is down.
    if (cvsEngineHealth.available) {
      const mkCvsEngine = () =>
        ({
          evaluate: async ({ fen, depth }: { fen: string; depth?: number; timeoutMs?: number }) => {
            try {
              const r = await analyzeWithCvsEngine(
                fen,
                Math.min(depth ?? 6, cvsEngineHealth.depth ?? 6),
              );
              if (r.error)
                return {
                  depth: depth ?? 0,
                  pv: [],
                  status: 'unavailable' as const,
                  reason: 'engine_error' as const,
                };
              const chess = new Chess(fen);
              const sanPv: string[] = [];
              for (const u of r.pv ?? []) {
                try {
                  const m = chess.move({
                    from: u.slice(0, 2),
                    to: u.slice(2, 4),
                    promotion: u.slice(4) || undefined,
                  });
                  if (!m) break;
                  sanPv.push(m.san);
                } catch {
                  break;
                }
              }
              return r.mate != null
                ? { mate: r.mate, depth: r.depth, pv: sanPv }
                : { cp: r.scoreCp, depth: r.depth, pv: sanPv };
            } catch {
              return {
                depth: depth ?? 0,
                pv: [],
                status: 'unavailable' as const,
                reason: 'engine_error' as const,
              };
            }
          },
        }) as unknown as UciEngine;
      const STREAMS = 12; // backend pools rust procs now — keep them all fed
      setDatasetJob((prev) => ({ ...prev, currentGame: 'CVS engine (native) working…' }));
      let done = 0;
      let next = 0;
      const worker = async () => {
        const eng = mkCvsEngine();
        while (datasetRunRef.current === runId && next < tasks.length) {
          const task = tasks[next++];
          await analyzeTask(eng, task);
          onProgress(++done);
        }
      };
      await Promise.all(Array.from({ length: STREAMS }, worker));
      if (datasetRunRef.current === runId) {
        setDatasetJob((prev) => ({
          ...prev,
          running: false,
          gamesDone: prev.gamesTotal,
          currentGame: '',
        }));
        setCacheVersion((n) => n + 1);
      }
      return;
    }
    // A pool of independent engines turns this from serial (one worker) into parallel
    // (≈cores) throughput — the only way 20k+ positions finish in reasonable time.
    const pool = await createEnginePool(defaultPoolSize());
    if (datasetRunRef.current !== runId) {
      pool.dispose();
      return;
    }
    enginePoolRef.current = pool;
    try {
      if (pool.size > 0) {
        setDatasetJob((prev) => ({
          ...prev,
          currentGame: `${pool.size} engine${pool.size === 1 ? '' : 's'} working…`,
        }));
        await pool.run(tasks, analyzeTask, onProgress);
      } else if (engineRef.current) {
        // No extra workers booted — fall back to the single shared engine.
        let done = 0;
        for (const task of tasks) {
          if (datasetRunRef.current !== runId) break;
          await analyzeTask(engineRef.current, task);
          onProgress(++done);
        }
      }
    } finally {
      pool.dispose();
      if (enginePoolRef.current === pool) enginePoolRef.current = null;
    }
    if (datasetRunRef.current === runId) {
      setDatasetJob((prev) => ({
        ...prev,
        running: false,
        gamesDone: prev.gamesTotal,
        currentGame: '',
      }));
      setCacheVersion((n) => n + 1);
    }
  };

  // ── CVS-engine dataset adapter ────────────────────────────────────────────
  // "Analyze all games" historically ran on the browser-Stockfish worker pool.
  // The native rust champion is far faster per position, so when the bridge is
  // healthy we drive the same analyzeMoveLive pipeline through it: only
  // .evaluate() is consumed, so a tiny adapter suffices. UCI pv → SAN here.
  // ──────────────────────────────────────────────────────────────────────────

  // Per-ply analyzed entries (the panel scopes + aggregates these itself).
  const entries = useMemo(() => {
    const out: AnalyzedEntry[] = [];
    plies.forEach((p, i) => {
      const a = analyses.get(i);
      if (a) out.push({ ply: p.ply, color: p.color, analysis: a });
    });
    return out;
  }, [plies, analyses]);

  useEffect(() => {
    const cached = featureCacheRef.current.get(currentGameKey);
    const pending = [...analyses.keys()]
      .sort((a, b) => {
        if (a === plyIndex) return -1;
        if (b === plyIndex) return 1;
        return a - b;
      })
      .filter((i) => {
        const a = analyses.get(i);
        return Boolean(plies[i] && a && cached?.get(i)?.analysis !== a);
      });

    if (pending.length === 0) return;

    let cancelled = false;
    const pump = () => {
      const start = performance.now();
      let didWork = false;
      while (!cancelled && pending.length && performance.now() - start < 8) {
        const i = pending.shift()!;
        const p = plies[i];
        const a = analyses.get(i);
        if (p && a) {
          getFeatureEntry(featureCacheRef.current, currentGameKey, p, i, a);
          didWork = true;
        }
      }
      if (didWork && !cancelled) setFeatureVersion((v) => v + 1);
      if (pending.length && !cancelled) window.setTimeout(pump, 16);
    };

    const timer = window.setTimeout(pump, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [plies, analyses, currentGameKey, plyIndex]);

  const featureEntries = useMemo(() => {
    const cached = featureCacheRef.current.get(currentGameKey);
    if (!cached) return [];
    return [...cached.values()].map((item) => item.entry).sort((a, b) => a.ply - b.ply);
  }, [currentGameKey, featureVersion]);
  const currentFeatures = useMemo(() => {
    if (view <= 0 || !analysis) return undefined;
    const cached = featureCacheRef.current.get(currentGameKey)?.get(plyIndex);
    return cached?.analysis === analysis ? cached.entry.features : undefined;
  }, [view, analysis, plyIndex, currentGameKey, featureVersion]);

  // Export the on-screen view + the full per-ply analysis (move, classification,
  // ranked insights, features, board control, coach) for EVERY ply as JSON.
  const exportAnalysis = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // Build the teaching corpus records for analyzed plies (cached after first run)
      // so the export carries the full per-ply training rows when the bridge is up.
      let teaching: Map<number, TeachingRecordV1> | undefined;
      if (cvsEngineHealth.available) {
        const runId = ++teachingExportRunRef.current;
        teaching = await computeTeachingRecords(
          currentGameKey,
          plies,
          analyses,
          teachingExportRunRef,
          runId,
        );
      }
      downloadJson(
        boardExportFilename(currentGame),
        buildBoardExport({
          game: currentGame,
          plies,
          view,
          fen,
          modeId,
          selected,
          focused,
          moveLabel,
          ledMap,
          arrows,
          analyses,
          commentary,
          teaching,
          annotations: { showThreats, showAllThreats, cascade, followMove },
          exportedAt: new Date().toISOString(),
        }),
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="app-shell__inner">
        <AppHeader
          tab={tab}
          onTabChange={setTab}
          gameCount={games.length}
          datasetJob={datasetJob}
          stockfishNative={sfNative}
          engineState={engineState}
          analysesCount={analyses.size}
          plyCount={plies.length}
          cvsHealth={cvsEngineHealth}
          cvsBusy={disagreementView.overall === 'pending'}
        />

        <AppSourceBar
          games={games}
          gameIndex={gameIndex}
          onSelectGame={selectGame}
          tab={tab}
          pgnText={pgnText}
          setPgnText={setPgnText}
          onLoad={loadPgn}
        />

        {tab === 'dataset' ? (
          <DatasetPanel
            games={games}
            engineReady={engineState === 'ready'}
            analysisProgress={datasetJob}
            cache={analysisCacheRef.current}
            cacheVersion={cacheVersion}
            keyOf={gameCacheKey}
            onAnalyzeAll={analyzeAllGames}
            onOpenGame={(i) => {
              selectGame(i);
              setTab('board');
            }}
          />
        ) : tab === 'play' ? (
          <PlayMode
            engine={engineState === 'ready' ? engineRef.current : null}
            engineReady={engineState === 'ready'}
            narrateMove={hasKey ? (a, f) => narrate(commentaryClient()!, a, f) : undefined}
            narrateTeaching={
              hasKey ? (event) => narrateTeachingPlan(commentaryClient()!, event.plan) : undefined
            }
            cvsHealth={cvsEngineHealth}
          />
        ) : (
          <>
            <div className="cvs-workspace">
              <AnnotationCommandList />
              <div
                ref={gifCaptureRef}
                className="cvs-gif-capture cvs-gif-capture--analysis"
              >
              <AnalysisBoardPanel
                modeId={modeId}
                onModePick={setModeId}
                engineReady={engineState === 'ready'}
                hideOverlays={hideOverlays}
                onHideOverlaysChange={setHideOverlays}
                legalDots={previewLine || hideOverlays ? undefined : legalDots}
                activeFen={activeFen}
                ledMap={previewLine || hideOverlays ? ({ mode: 'off', squares: {} } as LedMap) : ledMap}
                selected={previewLine || hideOverlays ? undefined : selected}
                onSelect={previewLine ? () => {} : onAnalysisSquareClick}
                arrows={arrows}
                draggable={!previewLine}
                onPieceDrop={previewLine ? undefined : (from, to) => tryAnalysisMove(from, to)}
                onArrowDrawn={previewLine ? undefined : handleArrowDrawn}
                onArrowRightClick={previewLine ? undefined : handleArrowDrawn}
                promotion={analysisPromo}
                onPromote={applyAnalysisMove}
                onCancelPromotion={() => setAnalysisPromo(null)}
                view={view}
                totalPlies={plies.length}
                onViewChange={setView}
                previewLine={previewLine}
                previewPositions={previewPositions}
                gifJob={gifJob}
                onPreviewStep={(currentIndex) =>
                  previewLine && setPreviewLine({ ...previewLine, currentIndex })
                }
                onSaveVariation={saveVariation}
                onExportPreviewGif={exportPreviewGif}
                onExitPreview={() => setPreviewLine(null)}
                alternatives={alternatives}
                mainLineEval={
                  analysis
                    ? { scoreCp: analysis.evalBefore.cp ?? 0, mate: analysis.evalBefore.mate ?? null }
                    : null
                }
                onPinToggle={togglePin}
                onDeleteAlternative={deleteAlternative}
                onDeleteMove={deleteMove}
                onDeepenAlternative={deepenAlternative}
                onEnterVariation={(alt) => setPreviewLine({ alt, currentIndex: 0 })}
                onHoverAlternative={(alt) => setHoveredAltId(alt?.id ?? null)}
                onToggleReveal={toggleReveal}
                onGenerateBestLine={generateBestLine}
                generatingBestLine={generatingBestLine}
                onRefuteLine={refuteLine}
                exporting={exporting}
                onExportAnalysis={exportAnalysis}
                features={currentFeatures}
                plies={plies}
                showThreats={showThreats}
                setShowThreats={setShowThreats}
                showAllThreats={showAllThreats}
                setShowAllThreats={setShowAllThreats}
                cascade={cascade}
                setCascade={setCascade}
                followMove={followMove}
                setFollowMove={setFollowMove}
                hasSelection={!!selected}
                onClearSelection={() => setSelected(undefined)}
              />
              {/* Middle: Teaching (board-level) · facts · engine */}
              <div className="analysis-detail-column">
                <div data-gif-crop="true">
                {gifJob.running && previewLine ? (
                  <PreviewTeachingCard previewLine={previewLine} />
                ) : (
                <TeachingLog
                  log={analyzeLog}
                  title="Teaching"
                  opening={bookOpening(plies.slice(0, view).map((p) => p.san))}
                  bothSides
                  latestPly={view - 1}
                  focusedId={teachingFocus?.id ?? null}
                  onShow={setTeachingFocus}
                  onPractice={setPuzzleEvent}
                  emptyHint="Step through the game — each move is taught here, newest at the bottom."
                />
                )}
                {!(gifJob.running && previewLine) && teachingPuzzle && (
                  <TeachingPuzzle
                    ref={puzzleRef}
                    puzzle={teachingPuzzle}
                    onClose={() => {
                      setPuzzleEvent(null);
                      setBestMovePuzzlePly(null);
                    }}
                    gradeAlternative={gradePuzzleAlternative}
                  />
                )}
                </div>
                <div data-gif-exclude="true">
                <FactsPanel
                  fen={fen}
                  selected={selected}
                  analysis={analysis}
                  move={moveLabel}
                  focused={focused}
                  onFocus={(ins) => setFocused((cur) => (cur === ins ? null : ins))}
                  enginePosition={engineSquareFacts}
                />
                <MoveReviewCard
                  stockfishState={engineState}
                  analysis={analysis}
                  move={moveLabel}
                />
                <EngineDisagreementCard view={disagreementView} />
                <TeachingFactsDebugPanel
                  request={teachingFactsRequest}
                  facts={teachingFacts}
                  busy={teachingFactsBusy}
                  error={teachingFactsError}
                />
                {analysis?.mateProof && <MateCard proof={analysis.mateProof} fen={fen} />}
                <CommentaryPanel
                  hasKey={hasKey}
                  keySource={keySource}
                  model={effectiveModel}
                  onSaveKey={saveKey}
                  handshake={handshake}
                  onHandshake={runHandshake}
                  currentText={plyIndex >= 0 ? commentary.get(plyIndex) : undefined}
                  onExplainCurrent={explainCurrent}
                  canExplain={!!analysis}
                  explaining={explaining}
                  job={commentaryJob}
                  onGenerateAll={generateAllCommentary}
                  totalAnalyzed={analyses.size}
                />
                </div>
              </div>
              </div>

              {/* Right: LED twin + move list */}
              <div className="cvs-side-column">
                <LedPreview ledMap={ledMap} />
                <MoveHistory
                  plies={plies}
                  view={view}
                  setView={setView}
                  analyses={analyses}
                  branchLabel={
                    currentGame?.headers.CVSBranch === 'analysis' ? currentGame.label : undefined
                  }
                  branchSourceLabel={
                    currentGame?.headers.CVSBranch === 'analysis'
                      ? currentGame.headers.CVSBranchFrom
                      : undefined
                  }
                  onBackToBranchSource={
                    currentGame?.headers.CVSBranch === 'analysis' ? returnToBranchSource : undefined
                  }
                />
              </div>
            </div>

            {entries.length > 0 && (
              <AnalyticsPanel
                entries={entries}
                features={featureEntries}
                view={view}
                onJump={(ply) => setView(ply)}
                teachingProfile={teachingThemes}
                teachingThemesJob={teachingThemesJob}
                onComputeThemes={cvsEngineHealth.available ? runTeachingThemes : undefined}
                onJumpTeaching={jumpToTeachingExample}
                teachingGameLabel={teachingGameLabel}
                onGeneratePuzzle={cvsEngineHealth.available ? generatePuzzleFromPly : undefined}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// lineArrows now lives in ./annotate (shared with Play mode).

/** Spotlight one insight on the LED grid: executor purple, targets orange. */
/** Game-level pass the per-move analyzer cannot do: repetition/conversion
 * awareness (the IUBKTvjF lesson). When it fires, it OWNS the headline —
 * "mobility improved" must never outrank "you are repeating a won game". */
function withRepetitionWarning(
  a: MoveAnalysis,
  plies: PlyRecord[],
  plyIndex: number,
): MoveAnalysis {
  const warning = repetitionConversionWarning(plies, plyIndex, a);
  if (!warning) return a;
  return {
    ...a,
    rankedInsights: [warning, ...a.rankedInsights],
    topExplanation: warning.evidence[0],
  };
}

function focusLedMap(ins: InsightCandidate): LedMap {
  const squares: Record<string, LedColor> = {};
  for (const sq of allSquares()) squares[sq] = 'off';
  const execSq =
    ins.kind === 'motif' && ins.byPiece.length >= 3 ? ins.byPiece.slice(2) : ins.squares[0];
  if (execSq) squares[execSq] = 'purple';
  for (const sq of ins.squares.slice(1)) if (squares[sq] === 'off') squares[sq] = 'orange';
  return { mode: 'focus', squares };
}

function safeGames(pgn: string): ParsedGame[] {
  try {
    return gamesFromPgn(pgn);
  } catch {
    return [];
  }
}
