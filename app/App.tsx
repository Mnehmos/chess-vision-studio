import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chess } from 'chess.js';
import samplePgn from '../fixtures/sample-game.pgn?raw';
import { gamesFromPgn, type ParsedGame, type PlyRecord } from '../engine/position';
import { computeLedMap, allSquares } from '../engine/led';
import { analyzeMoveLive } from '../engine/analyze';
import { repetitionConversionWarning } from '../engine/repetition';
import type { AnalyzedEntry } from '../engine/analytics';
import { extractPlyFeatures, controlShare, type FeatureEntry, type PlyFeatures } from '../engine/features';
import { UciEngine } from '../engine/evaluation';
import type { InsightCandidate, LedColor, LedMap, MoveAnalysis, Square } from '../engine/types';
import { tryCreateEngine } from './engine-browser';
import {
  analyzeWithCvsEngine,
  getCvsEngineHealth,
  type CvsEngineAnalysis,
  type CvsEngineHealth,
} from './cvs-engine-client';
import { createEnginePool, defaultPoolSize, type EnginePool } from './engine-pool';
import { loadAnalysisCache, saveGameAnalysis } from './analysis-store';
import { MODES, LED_CSS } from './modes';
import { Board2D } from './Board2D';
import { ARROW, type Arrow } from './BoardArrows';
import { selectionArrows, lineArrows } from './annotate';
import { AnnotationLegend } from './AnnotationLegend';
import { FactsPanel } from './FactsPanel';
import { MateCard } from './MateCard';
import { AnalyticsPanel } from './AnalyticsPanel';
import { DatasetPanel } from './DatasetPanel';
import { PlayMode } from './PlayMode';
import { TrainingMonitor } from './TrainingMonitor';
import { CommentaryPanel, type CommentaryJob, type Handshake } from './CommentaryPanel';
import { LedPreview } from './LedPreview';
import { buildBoardExport, boardExportFilename, downloadJson } from './exportState';
import { createOpenAIClient, type ChatClient } from '../llm/openai';
import { narrate } from '../llm/narrate';

const env = import.meta.env as Record<string, string | undefined>;
const initialKey = () => env.VITE_OPENAI_API_KEY || localStorage.getItem('cvs_openai_key') || '';
const OPENAI_MODEL = env.VITE_OPENAI_MODEL || 'gpt-5.5';

// ── design tokens ─────────────────────────────────────────────────────────────
const PAGE_BG = 'var(--bg)';
const cardStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
};
const primaryBtn: React.CSSProperties = {
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
type AppTab = 'board' | 'dataset' | 'play' | 'training';
type VerboseMove = { san: string; color: 'w' | 'b'; from: string; to: string; promotion?: string };
const PROMOTION_PIECES = ['q', 'r', 'n', 'b'] as const;

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
  const [focused, setFocused] = useState<InsightCandidate | null>(null);
  const [analyses, setAnalyses] = useState<Map<number, MoveAnalysis>>(new Map());
  const [engineState, setEngineState] = useState<'loading' | 'ready' | 'off'>('loading');
  const [cvsEngineHealth, setCvsEngineHealth] = useState<CvsEngineHealth>({ ok: false, available: false });
  const [cvsEngineAnalysis, setCvsEngineAnalysis] = useState<CvsEngineAnalysis | null>(null);
  const [cvsEngineBusy, setCvsEngineBusy] = useState(false);
  const [cvsEngineError, setCvsEngineError] = useState('');
  const [datasetJob, setDatasetJob] = useState({ ...IDLE_DATASET_JOB });
  const engineRef = useRef<UciEngine | null>(null);
  const cvsEngineRunRef = useRef(0);
  const analysisCacheRef = useRef<Map<string, Map<number, MoveAnalysis>>>(new Map());
  const featureCacheRef = useRef<Map<string, Map<number, CachedFeatureEntry>>>(new Map());
  // analysisCacheRef is a ref (stable identity), so bump this to signal the dataset
  // views that its contents changed (after a load, a saved game, or a single ply).
  const [cacheVersion, setCacheVersion] = useState(0);
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
    fetch('/api/openai/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setProxy({ checked: true, hasKey: !!d?.hasKey, model: d?.model || OPENAI_MODEL }))
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
    if (proxy.hasKey) return createOpenAIClient({ apiKey: 'via-proxy', model: effectiveModel, baseUrl: '/api/openai' });
    if (apiKey) return createOpenAIClient({ apiKey, model: OPENAI_MODEL });
    return null;
  };
  const [commentary, setCommentary] = useState<Map<number, string>>(new Map());
  const [commentaryJob, setCommentaryJob] = useState<CommentaryJob>({ running: false, done: 0, total: 0, error: '' });
  const [explaining, setExplaining] = useState(false);
  const commentaryCacheRef = useRef<Map<string, Map<number, string>>>(new Map());
  // Per-game commentary cache: switch games and your generated notes come right back.
  useEffect(() => {
    setCommentary(new Map(commentaryCacheRef.current.get(currentGameKey) ?? new Map()));
  }, [currentGameKey]);

  // Boot Stockfish (best-effort). Pure modes work regardless.
  useEffect(() => {
    let alive = true;
    tryCreateEngine().then((e) => {
      if (!alive) return;
      engineRef.current = e;
      setEngineState(e ? 'ready' : 'off');
    });
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
        setCvsEngineHealth({ ok: false, available: false, error: String((e as Error)?.message ?? e) });
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
    return () => {
      alive = false;
    };
  }, []);

  const fen = view === 0 ? currentGame?.initialFen ?? plies[0]?.fenBefore ?? START_FEN : plies[view - 1].fenAfter;
  const plyIndex = view - 1; // index into plies for the move that produced `fen`
  const analysis = view > 0 ? analyses.get(plyIndex) : undefined;
  const moveLabel = view > 0 ? `${plies[plyIndex].moveNumber}${plies[plyIndex].color === 'w' ? '.' : '...'} ${plies[plyIndex].san}` : undefined;
  const cvsEngineFen = view > 0 ? plies[plyIndex]?.fenBefore ?? fen : fen;
  const cvsEngineContext = view > 0 && moveLabel ? `before ${moveLabel}` : 'current board';
  const cvsPlayedUci = view > 0 ? `${plies[plyIndex]?.from ?? ''}${plies[plyIndex]?.to ?? ''}` : undefined;

  useEffect(() => {
    if (tab !== 'board' || !cvsEngineHealth.available) return;
    const run = ++cvsEngineRunRef.current;
    setCvsEngineBusy(true);
    setCvsEngineError('');
    setCvsEngineAnalysis(null);
    const timer = window.setTimeout(() => {
      analyzeWithCvsEngine(cvsEngineFen, cvsEngineHealth.depth)
        .then((result) => {
          if (cvsEngineRunRef.current !== run) return;
          setCvsEngineAnalysis(result);
        })
        .catch((e) => {
          if (cvsEngineRunRef.current !== run) return;
          setCvsEngineError(String((e as Error)?.message ?? e));
        })
        .finally(() => {
          if (cvsEngineRunRef.current === run) setCvsEngineBusy(false);
        });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      if (cvsEngineRunRef.current === run) cvsEngineRunRef.current += 1;
    };
  }, [cvsEngineFen, tab, cvsEngineHealth.available, cvsEngineHealth.depth]);

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
      const feat = getFeatureEntry(featureCacheRef.current, currentGameKey, plies[plyIndex], plyIndex, analysis).features;
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
            const feat = getFeatureEntry(featureCacheRef.current, gameKey, plies[idx], idx, a).features;
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
          const a = withRepetitionWarning(await analyzeMoveLive(engine, plies[target].fenBefore, plies[target].san), plies, target);
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
  // Also clear any focused insight when the ply changes.
  useEffect(() => {
    setFocused(null);
    if (followMove) setSelected(view > 0 ? (plies[view - 1]?.to as Square) : undefined);
  }, [view, plies, followMove]);

  // LED: a focused insight overrides the mode overlay to spotlight just that motif.
  const ledMap = useMemo(() => {
    if (focused) return focusLedMap(focused);
    return computeLedMap(modeId, { fen, selectedSquare: selected, analysis });
  }, [modeId, fen, selected, analysis, focused]);

  // Annotation arrows:
  //   • selected piece — DEFENDERS (green in), ATTACKERS (red in), and the piece's
  //     OWN attacks raycast OUTWARD (magenta out)
  //   • threat lines — the top refutation's call-and-response sequence, or ALL of
  //     them, each numbered and colored by the moving side
  const arrows = useMemo<Arrow[]>(() => {
    // FOCUS MODE: a clicked insight spotlights only its own line; everything else
    // is suppressed so the user sees exactly that one tactic.
    if (focused) return lineArrows(fen, focused, false);

    const out: Arrow[] = [];

    // The played move itself — a subtle slate arrow (thin, small head) so "moved
    // here" never reads as "attacks here".
    if (followMove && view > 0) {
      const p = plies[view - 1];
      if (p) out.push({ from: p.from as Square, to: p.to as Square, color: ARROW.move, move: true });
    }

    if (selected) out.push(...selectionArrows(fen, selected, cascade));

    if (analysis && analysis.rankedInsights.length) {
      const top = analysis.rankedInsights[0];
      const threats = showAllThreats
        ? analysis.rankedInsights.filter((i) => i.source === 'refutation' || i.source === 'available')
        : showThreats && top.source === 'refutation'
          ? [top]
          : [];
      for (const ins of threats) out.push(...lineArrows(fen, ins, ins !== top));
    }
    return out;
  }, [fen, selected, analysis, showThreats, showAllThreats, cascade, focused, followMove, view, plies]);

  // Keyboard navigation: ← → step, Home/End jump.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
    const canExtendCurrentBranch = currentGame.headers.CVSBranch === 'analysis' && view === plies.length;

    if (canExtendCurrentBranch) {
      const updated: ParsedGame = { ...currentGame, plies: nextPlies };
      setGames(games.map((g, i) => (i === gameIndex ? updated : g)));
      analysisCacheRef.current.set(gameCacheKey(updated), nextAnalyses);
    } else {
      const branchIndex = games.length;
      const origin = view > 0 ? `${plies[view - 1]?.moveNumber}${plies[view - 1]?.color === 'w' ? '.' : '...'} ${plies[view - 1]?.san}` : 'start';
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
      running: true, done: 0, total: tasks.length,
      gamesDone: 0, gamesTotal, currentGame: 'starting engines…',
    });

    // The actual work for one ply — shared by the pool and the single-engine fallback.
    const analyzeTask = async (engine: UciEngine, task: (typeof tasks)[number]) => {
      if (datasetRunRef.current !== runId) return;
      const a = withRepetitionWarning(await analyzeMoveLive(engine, task.ply.fenBefore, task.ply.san), task.game.plies, task.plyIndex);
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
      if (datasetRunRef.current === runId) setDatasetJob((prev) => ({ ...prev, done: Math.min(done, prev.total) }));
    };

    let gamesDone = 0;
    // A pool of independent engines turns this from serial (one worker) into parallel
    // (≈cores) throughput — the only way 20k+ positions finish in reasonable time.
    const pool = await createEnginePool(defaultPoolSize());
    if (datasetRunRef.current !== runId) { pool.dispose(); return; }
    enginePoolRef.current = pool;
    try {
      if (pool.size > 0) {
        setDatasetJob((prev) => ({ ...prev, currentGame: `${pool.size} engine${pool.size === 1 ? '' : 's'} working…` }));
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
      setDatasetJob((prev) => ({ ...prev, running: false, gamesDone: prev.gamesTotal, currentGame: '' }));
      setCacheVersion((n) => n + 1);
    }
  };

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
  const exportAnalysis = () => {
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
        annotations: { showThreats, showAllThreats, cascade, followMove },
        exportedAt: new Date().toISOString(),
      }),
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: PAGE_BG, color: 'var(--text)', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        :root{color-scheme:dark;
          --bg:#12100e; --card:#1c1916; --card2:#211d19; --track:#2a2622;
          --border:#322d28; --text:#ece7e1; --text-soft:#cfc8bf; --muted:#9b9389;
          --accent:#b87333; --accent-light:#d4956a;}
        h1,h2,h3{font-family:'Space Grotesk','Inter',system-ui,sans-serif}
        input,textarea,select{background:var(--card2);color:var(--text);border-color:var(--border)}
        @keyframes csvBlink{50%{opacity:0.1}}
        .cvs-workspace{display:grid;grid-template-columns:480px minmax(0,1fr) 300px;gap:20px;align-items:start}
        @media (max-width:1180px){.cvs-workspace{grid-template-columns:480px minmax(0,1fr)}}
        @media (max-width:820px){.cvs-workspace{grid-template-columns:1fr}}
      `}</style>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px clamp(10px, 3vw, 24px) 56px', overflowX: 'hidden' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 24, letterSpacing: '-0.01em' }}>Chess Vision Studio</h1>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            2D chess perception — relations · SEE · diff · saliency · validated motifs
          </span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <EngineBadge label="Stockfish" state={engineState} />
            <CvsEngineBadge health={cvsEngineHealth} busy={cvsEngineBusy} />
            {engineState === 'ready' && analyses.size < plies.length && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>analyzing {analyses.size}/{plies.length}…</span>
            )}
            {engineState === 'ready' && plies.length > 0 && analyses.size >= plies.length && (
              <span style={{ fontSize: 12, color: '#3fbf5f' }}>analysis complete ✓</span>
            )}
          </span>
        </header>

        <SourceBar
          games={games}
          gameIndex={gameIndex}
          onSelectGame={selectGame}
          tab={tab}
          setTab={setTab}
          datasetJob={datasetJob}
          pgnText={pgnText}
          setPgnText={setPgnText}
          onLoad={loadPgn}
        />

      {tab === 'training' ? (
        <TrainingMonitor />
      ) : tab === 'dataset' ? (
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
        />
      ) : (
        <>
      <div className="cvs-workspace">
        {/* Left: board + nav */}
        <div style={{ ...cardStyle, width: '100%', maxWidth: 480, padding: 12 }}>
          <ModeBar modeId={modeId} onPick={setModeId} engineReady={engineState === 'ready'} />
          <div style={{ position: 'relative', width: 'max-content', maxWidth: '100%' }}>
            <Board2D
              fen={fen}
              ledMap={ledMap}
              selected={selected}
              onSelect={onAnalysisSquareClick}
              arrows={arrows}
              draggable
              onPieceDrop={(from, to) => tryAnalysisMove(from, to)}
            />
            {analysisPromo && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(16,24,40,0.55)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 5,
                }}
              >
                <div style={{ ...cardStyle, padding: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-soft)', marginRight: 2 }}>Promote to</span>
                  {PROMOTION_PIECES.map((piece) => (
                    <button
                      key={piece}
                      onClick={() => applyAnalysisMove(analysisPromo.from, analysisPromo.to, piece)}
                      style={{ ...primaryBtn, width: 42, padding: '8px 0', textTransform: 'uppercase' }}
                    >
                      {piece}
                    </button>
                  ))}
                  <button style={{ ...primaryBtn, background: 'var(--muted)' }} onClick={() => setAnalysisPromo(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          <Nav view={view} total={plies.length} setView={setView} />
          <button
            onClick={exportAnalysis}
            title="Download the full analysis (every ply: move, classification, insights, features, board control, coach) + the current view as JSON"
            style={{
              width: '100%',
              marginTop: 8,
              border: '1px solid #d0d5dd',
              background: 'var(--card)',
              color: 'var(--text)',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ⬇ Export JSON (all plies)
          </button>
          <MiniBadges features={currentFeatures} />
          <ControlBar features={currentFeatures} />
          <MoveStrip plies={plies} view={view} setView={setView} />
          <AnnotationLegend
            showThreats={showThreats}
            setShowThreats={setShowThreats}
            showAllThreats={showAllThreats}
            setShowAllThreats={setShowAllThreats}
            cascade={cascade}
            setCascade={setCascade}
            followMove={followMove}
            setFollowMove={setFollowMove}
            hasSelection={!!selected}
            onClear={() => setSelected(undefined)}
          />
          <Legend modeId={modeId} />
        </div>

        {/* Middle: facts + mate-line card */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FactsPanel
            fen={fen}
            selected={selected}
            analysis={analysis}
            move={moveLabel}
            focused={focused}
            onFocus={(ins) => setFocused((cur) => (cur === ins ? null : ins))}
          />
          <EngineComparisonPanel
            stockfishState={engineState}
            stockfishAnalysis={analysis}
            move={moveLabel}
            cvsHealth={cvsEngineHealth}
            cvsAnalysis={cvsEngineAnalysis}
            cvsBusy={cvsEngineBusy}
            cvsError={cvsEngineError}
            cvsContext={cvsEngineContext}
            cvsPlayedUci={cvsPlayedUci}
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

        {/* Right: LED twin + move list */}
        <div style={{ width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <LedPreview ledMap={ledMap} />
          <MoveHistory
            plies={plies}
            view={view}
            setView={setView}
            analyses={analyses}
            branchLabel={currentGame?.headers.CVSBranch === 'analysis' ? currentGame.label : undefined}
            branchSourceLabel={currentGame?.headers.CVSBranch === 'analysis' ? currentGame.headers.CVSBranchFrom : undefined}
            onBackToBranchSource={currentGame?.headers.CVSBranch === 'analysis' ? returnToBranchSource : undefined}
          />
        </div>
      </div>

      {entries.length > 0 && (
        <AnalyticsPanel entries={entries} features={featureEntries} view={view} onJump={(ply) => setView(ply)} />
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
function withRepetitionWarning(a: MoveAnalysis, plies: PlyRecord[], plyIndex: number): MoveAnalysis {
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
  const execSq = ins.kind === 'motif' && ins.byPiece.length >= 3 ? ins.byPiece.slice(2) : ins.squares[0];
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

function legalMovesFrom(fen: string, sq: Square): VerboseMove[] {
  try {
    return new Chess(fen).moves({ square: sq as never, verbose: true }) as unknown as VerboseMove[];
  } catch {
    return [];
  }
}

function gameCacheKey(game: ParsedGame | undefined): string {
  if (!game) return 'no-game';
  const first = game.plies[0]?.fenBefore ?? game.initialFen ?? '';
  const last = game.plies[game.plies.length - 1]?.fenAfter ?? game.initialFen ?? '';
  return [
    game.headers.White ?? '?',
    game.headers.Black ?? '?',
    game.headers.Result ?? '*',
    game.headers.Date ?? '?',
    game.plies.length,
    first,
    last,
  ].join('|');
}

interface CachedFeatureEntry {
  analysis: MoveAnalysis;
  entry: FeatureEntry;
}

function getFeatureEntry(
  cacheRoot: Map<string, Map<number, CachedFeatureEntry>>,
  gameKey: string,
  ply: PlyRecord,
  plyIndex: number,
  analysis: MoveAnalysis,
): FeatureEntry {
  let gameCache = cacheRoot.get(gameKey);
  if (!gameCache) {
    gameCache = new Map();
    cacheRoot.set(gameKey, gameCache);
  }
  const cached = gameCache.get(plyIndex);
  if (cached?.analysis === analysis) return cached.entry;

  const entry: FeatureEntry = {
    ply: ply.ply,
    color: ply.color,
    analysis,
    features: extractPlyFeatures(ply.fenBefore, ply.fenAfter, ply.san, analysis),
  };
  gameCache.set(plyIndex, { analysis, entry });
  return entry;
}

// The data entry point — front and center. Import any PGN (one game or a full
// Chess.com / Lichess / OpeningTree export), pick a game, and flip to the dataset view.
function SourceBar({
  games,
  gameIndex,
  onSelectGame,
  tab,
  setTab,
  datasetJob,
  pgnText,
  setPgnText,
  onLoad,
}: {
  games: ParsedGame[];
  gameIndex: number;
  onSelectGame: (i: number) => void;
  tab: AppTab;
  setTab: (t: AppTab) => void;
  datasetJob: DatasetJob;
  pgnText: string;
  setPgnText: (s: string) => void;
  onLoad: () => void;
}) {
  const [open, setOpen] = useState(false);
  const multi = games.length > 1;
  const jobPct = datasetJob.total ? Math.round((datasetJob.done / datasetJob.total) * 100) : 0;
  const loadedLabel = multi ? `${games.length} games loaded` : games[gameIndex]?.label ?? 'Sample game';
  return (
    <section style={{ ...cardStyle, padding: 14, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button onClick={() => setOpen((o) => !o)} style={primaryBtn}>
          ⬆ Import PGN
        </button>
        <div style={{ fontSize: 13, color: 'var(--text-soft)' }}>
          <strong style={{ color: 'var(--text)' }}>{loadedLabel}</strong>
          <span style={{ color: 'var(--muted)' }}> · paste your Chess.com / Lichess export to analyze your own games</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {multi && tab === 'board' && (
            <select
              value={gameIndex}
              onChange={(e) => onSelectGame(Number(e.target.value))}
              style={{ maxWidth: 320, fontSize: 13, padding: '7px 8px', borderRadius: 8, border: '1px solid #d0d5dd', background: 'var(--card)' }}
            >
              {games.map((g, i) => (
                <option key={i} value={i}>
                  {g.label}
                </option>
              ))}
            </select>
          )}
          <div style={{ display: 'inline-flex', gap: 6 }}>
            <TabButton active={tab === 'board'} onClick={() => setTab('board')}>
              Board
            </TabButton>
            <TabButton active={tab === 'play'} onClick={() => setTab('play')}>
              Play
            </TabButton>
            <TabButton active={tab === 'training'} onClick={() => setTab('training')}>
              Training
            </TabButton>
            {multi && (
              <TabButton active={tab === 'dataset'} onClick={() => setTab('dataset')}>
                {datasetJob.running ? `Dataset · analyzing ${jobPct}%` : `Dataset · ${games.length}`}
              </TabButton>
            )}
          </div>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          <textarea
            value={pgnText}
            onChange={(e) => setPgnText(e.target.value)}
            placeholder="Paste a PGN — one game or a multi-game export (Chess.com / Lichess / OpeningTree)…"
            style={{
              width: '100%',
              height: 120,
              boxSizing: 'border-box',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              padding: 10,
              borderRadius: 8,
              border: '1px solid #d0d5dd',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <button
              onClick={() => {
                onLoad();
                setOpen(false);
              }}
              style={primaryBtn}
            >
              Load games
            </button>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Multi-game exports open a Dataset view: opening tree, results over time, per-game review.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
        background: active ? 'var(--accent)' : '#fff',
        color: active ? '#fff' : 'var(--text-soft)',
        padding: '6px 14px',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 14,
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

function EngineBadge({ label, state }: { label: string; state: 'loading' | 'ready' | 'off' }) {
  const text = state === 'loading' ? 'engine: loading…' : state === 'ready' ? 'engine: ready' : 'engine: off (pure modes only)';
  const bg = state === 'ready' ? '#3fbf5f' : state === 'loading' ? '#e8923b' : 'var(--muted)';
  return (
    <span title={text} style={{ background: bg, color: '#fff', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>
      {state === 'loading' ? `${label}: loading` : state === 'ready' ? `${label}: ready` : `${label}: off`}
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
  const bg = checking ? '#e8923b' : health.available ? 'var(--accent)' : 'var(--muted)';
  return (
    <span title={health.error} style={{ background: bg, color: '#fff', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>
      {text}
    </span>
  );
}

function EngineComparisonPanel({
  stockfishState,
  stockfishAnalysis,
  move,
  cvsHealth,
  cvsAnalysis,
  cvsBusy,
  cvsError,
  cvsContext,
  cvsPlayedUci,
}: {
  stockfishState: 'loading' | 'ready' | 'off';
  stockfishAnalysis: MoveAnalysis | undefined;
  move: string | undefined;
  cvsHealth: CvsEngineHealth;
  cvsAnalysis: CvsEngineAnalysis | null;
  cvsBusy: boolean;
  cvsError: string;
  cvsContext: string;
  cvsPlayedUci: string | undefined;
}) {
  const labelStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' };
  const valueStyle: React.CSSProperties = { margin: 0, fontSize: 14, color: 'var(--text)', lineHeight: 1.45 };
  return (
    <section style={{ ...cardStyle, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Engine Analysis</h2>
        <span style={{ color: 'var(--muted)', fontSize: 12, flexShrink: 0 }}>local WIP</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <p style={labelStyle}>Stockfish</p>
          {stockfishState !== 'ready' ? (
            <p style={valueStyle}>{stockfishState === 'loading' ? 'loading' : 'off'}</p>
          ) : stockfishAnalysis ? (
            <>
              <p style={valueStyle}>
                {move ?? stockfishAnalysis.move}: {stockfishAnalysis.classification}, loss {stockfishAnalysis.cpLoss.toFixed(2)}
              </p>
              <p style={{ ...valueStyle, fontSize: 13 }}>
                eval {formatEval(stockfishAnalysis.evalAfter)} d{stockfishAnalysis.evalAfter.depth}
              </p>
              <p style={{ ...valueStyle, color: 'var(--muted)', fontSize: 12 }}>{stockfishAnalysis.evalAfter.pv.slice(0, 6).join(' ') || 'no pv'}</p>
            </>
          ) : (
            <p style={valueStyle}>waiting for a played move</p>
          )}
        </div>
        <div style={{ minWidth: 0, borderLeft: '1px solid #eaecf0', paddingLeft: 14 }}>
          <p style={labelStyle}>CVS Engine</p>
          <p style={{ ...valueStyle, color: 'var(--muted)', fontSize: 12 }}>{cvsContext}</p>
          {!cvsHealth.available ? (
            <p style={valueStyle}>{cvsHealth.error || 'local engine unavailable'}</p>
          ) : cvsError ? (
            <p style={{ ...valueStyle, color: '#b42318' }}>{cvsError}</p>
          ) : cvsAnalysis ? (
            <>
              <p style={valueStyle}>
                {cvsPlayedUci ? `played ${cvsPlayedUci}, ` : ''}best {cvsAnalysis.uci ?? 'none'} {formatCvsAgreement(cvsPlayedUci, cvsAnalysis.uci)}{' '}
                {cvsBusy ? '(updating)' : ''}
              </p>
              <p style={{ ...valueStyle, fontSize: 13 }}>
                eval {formatCvsEval(cvsAnalysis)} d{cvsAnalysis.depth} in {cvsAnalysis.timeMs}ms
              </p>
              <p style={{ ...valueStyle, color: 'var(--muted)', fontSize: 12 }}>
                {formatNodes(cvsAnalysis.nodes)} nodes, q {formatNodes(cvsAnalysis.qNodes)}, tt {cvsAnalysis.ttHits}
              </p>
              <p style={{ ...valueStyle, color: 'var(--muted)', fontSize: 12 }}>{cvsAnalysis.pv.slice(0, 6).join(' ') || 'no pv'}</p>
            </>
          ) : (
            <p style={valueStyle}>{cvsBusy ? `analyzing ${cvsContext}` : 'ready'}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function formatEval(evalInfo: MoveAnalysis['evalAfter']): string {
  if (typeof evalInfo.mate === 'number') return `M${evalInfo.mate}`;
  if (typeof evalInfo.cp === 'number') return formatCp(evalInfo.cp);
  return evalInfo.status === 'terminal' ? 'terminal' : 'unavailable';
}

function formatCvsEval(result: CvsEngineAnalysis): string {
  if (typeof result.mate === 'number') return `M${result.mate}`;
  return formatCp(result.scoreCp);
}

function formatCvsAgreement(playedUci: string | undefined, bestUci: string | null): string {
  if (!playedUci || !bestUci) return '';
  return playedUci === bestUci ? '(agrees)' : '(prefers different move)';
}

function formatCp(cp: number): string {
  const pawns = cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

function formatNodes(nodes: number): string {
  if (nodes >= 1_000_000) return `${(nodes / 1_000_000).toFixed(1)}M`;
  if (nodes >= 1_000) return `${(nodes / 1_000).toFixed(1)}k`;
  return String(nodes);
}

function ModeBar({
  modeId,
  onPick,
  engineReady,
}: {
  modeId: string;
  onPick: (id: (typeof MODES)[number]['id']) => void;
  engineReady: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8, maxWidth: 'min(460px, 100%)' }}>
      {MODES.map((m) => {
        const disabled = m.needsAnalysis && !engineReady;
        return (
          <button
            key={m.id}
            onClick={() => onPick(m.id)}
            disabled={disabled}
            title={disabled ? 'needs the engine' : undefined}
            style={{
              padding: '4px 8px',
              fontSize: 13,
              border: modeId === m.id ? '2px solid #16a' : '1px solid #bbb',
              background: modeId === m.id ? '#dceaff' : '#fff',
              borderRadius: 4,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function Nav({ view, total, setView }: { view: number; total: number; setView: (n: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button onClick={() => setView(0)} disabled={view === 0}>
        ⏮
      </button>
      <button onClick={() => setView(Math.max(0, view - 1))} disabled={view === 0}>
        ◀
      </button>
      <span style={{ minWidth: 90, textAlign: 'center' }}>
        ply {view} / {total}
      </span>
      <button onClick={() => setView(Math.min(total, view + 1))} disabled={view === total}>
        ▶
      </button>
      <button onClick={() => setView(total)} disabled={view === total}>
        ⏭
      </button>
    </div>
  );
}

// Plain-language glossary so the badges are never cryptic — keyed by leading phrase.
const BADGE_GLOSSARY: { match: string; explain: string }[] = [
  { match: 'Mobility', explain: 'Mobility — change in the moving side’s total legal moves (higher = freer pieces).' },
  { match: 'Safe moves', explain: 'Safe moves — change in legal moves that don’t drop material (Static Exchange Evaluation ≥ 0).' },
  { match: 'King escapes', explain: 'King escapes — legal squares the side-to-move’s king can flee to. 0 means no escape: mating danger.' },
  { match: 'Loose pieces', explain: 'Loose pieces — the moving side’s pieces with no defender. Undefended pieces are tactic targets.' },
  { match: 'Best SEE', explain: 'Best capture — most material (in pawns) the side to move can safely win right now via a Static-Exchange-Evaluation-safe capture.' },
  { match: 'Motif', explain: 'Tactic — the strongest PROVEN tactic available (fork, pin, skewer, mate net…); “none” if no validated tactic.' },
];

function badgeTitle(badge: string): string {
  const g = BADGE_GLOSSARY.find((x) => badge.startsWith(x.match));
  return g ? `${badge}\n\n${g.explain}` : badge;
}

// Board control — what share of the 64 squares each side's pieces attack (territory
// from the threat map). White = blue, Black = red, contested = purple, neutral = grey.
function ControlBar({ features }: { features?: PlyFeatures }) {
  const c = features ? controlShare(features.threatAfter) : undefined;
  const segs = c
    ? [
        { pct: c.exclusiveWhitePct, color: 'var(--accent)', label: `White ${c.exclusiveWhitePct}%` },
        { pct: c.contestedPct, color: '#8a5cc4', label: `contested ${c.contestedPct}%` },
        { pct: c.exclusiveBlackPct, color: '#d43b3b', label: `Black ${c.exclusiveBlackPct}%` },
        { pct: c.neutralPct, color: '#e6e6e6', label: `neutral ${c.neutralPct}%` },
      ]
    : [];
  return (
    <div style={{ width: 'min(456px, 100%)', marginTop: 6 }} title="Share of the 64 squares each side's pieces attack (contested = both).">
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>
        <span>Board control</span>
        {c && <span>center {c.centerWhite}–{c.centerBlack}</span>}
      </div>
      <div style={{ display: 'flex', height: 12, borderRadius: 3, overflow: 'hidden', background: 'var(--track)' }}>
        {segs.map((s, i) =>
          s.pct > 0 ? (
            <div key={i} title={s.label} style={{ width: `${s.pct}%`, background: s.color }} />
          ) : null,
        )}
      </div>
      {c && (
        <div
          style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--muted)', marginTop: 2, flexWrap: 'wrap' }}
          title={`Total reach (overlaps on contested): White ${c.whitePct}%, Black ${c.blackPct}%`}
        >
          <span style={{ color: 'var(--accent)' }}>White {c.exclusiveWhitePct}%</span>
          <span style={{ color: '#8a5cc4' }}>contested {c.contestedPct}%</span>
          <span style={{ color: '#d43b3b' }}>Black {c.exclusiveBlackPct}%</span>
          <span style={{ color: 'var(--muted)' }}>neutral {c.neutralPct}%</span>
        </div>
      )}
    </div>
  );
}

function MiniBadges({ features }: { features?: PlyFeatures }) {
  const badges = features?.badges ?? ['Mobility --', 'Safe moves --', 'King escapes --', 'Loose pieces --', 'Best SEE --', 'Motif --'];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(120px, 1fr))',
        gap: 6,
        marginTop: 8,
        width: 'min(456px, 100%)',
        minHeight: 54,
      }}
    >
      {badges.map((b) => (
        <div
          key={b}
          title={badgeTitle(b)}
          style={{
            cursor: 'help',
            border: '1px solid #ddd',
            borderRadius: 4,
            padding: '4px 6px',
            fontSize: 12,
            background: 'var(--card2)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {b}
        </div>
      ))}
    </div>
  );
}

// AnnotationLegend now lives in ./AnnotationLegend (shared with Play mode).

function Legend({ modeId }: { modeId: string }) {
  const mode = MODES.find((m) => m.id === modeId)!;
  return (
    <div style={{ marginTop: 10, fontSize: 12 }}>
      {mode.legend.map((l) => (
        <span key={l.color} style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              background: LED_CSS[l.color],
              borderRadius: 2,
              marginRight: 4,
              verticalAlign: 'middle',
            }}
          />
          {l.meaning}
        </span>
      ))}
    </div>
  );
}

// Scroll an element into view by adjusting ONLY its scroll container — never the
// window. (element.scrollIntoView() bubbles to every scrollable ancestor incl. the
// document, which is what made the whole page jump on each step.)
function keepInView(el: HTMLElement | null, container: HTMLElement | null, axis: 'x' | 'y') {
  if (!el || !container) return;
  const e = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  if (axis === 'y') {
    if (e.top < c.top) container.scrollTop -= c.top - e.top;
    else if (e.bottom > c.bottom) container.scrollTop += e.bottom - c.bottom;
  } else {
    if (e.left < c.left) container.scrollLeft -= c.left - e.left;
    else if (e.right > c.right) container.scrollLeft += e.right - c.right;
  }
}

// Compact horizontal notation directly under the board (always visible).
function MoveStrip({
  plies,
  view,
  setView,
}: {
  plies: PlyRecord[];
  view: number;
  setView: (n: number) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    keepInView(ref.current, containerRef.current, 'x');
  }, [view]);
  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        gap: 4,
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        marginTop: 8,
        padding: '6px 4px',
        maxWidth: 'min(448px, 100%)',
        background: '#f3f1ea',
        borderRadius: 6,
        fontSize: 13,
      }}
    >
      {plies.map((p, i) => {
        const current = view === i + 1;
        return (
          <span
            key={i}
            ref={current ? ref : undefined}
            onClick={() => setView(i + 1)}
            style={{
              cursor: 'pointer',
              padding: '2px 5px',
              borderRadius: 4,
              background: current ? '#16a' : 'transparent',
              color: current ? '#fff' : '#222',
              fontWeight: current ? 700 : 400,
            }}
          >
            {p.color === 'w' ? `${p.moveNumber}. ` : ''}
            {p.san}
          </span>
        );
      })}
    </div>
  );
}

// Grouped notation table (move # · White · Black), current ply highlighted and
// auto-scrolled into view as turns progress.
function MoveHistory({
  plies,
  view,
  setView,
  analyses,
  branchLabel,
  branchSourceLabel,
  onBackToBranchSource,
}: {
  plies: PlyRecord[];
  view: number;
  setView: (n: number) => void;
  analyses: Map<number, MoveAnalysis>;
  branchLabel?: string;
  branchSourceLabel?: string;
  onBackToBranchSource?: () => void;
}) {
  const currentRef = useRef<HTMLTableRowElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    keepInView(currentRef.current, scrollRef.current, 'y');
  }, [view]);

  // group plies into full moves
  const rows: { no: number; w?: PlyRecord & { i: number }; b?: PlyRecord & { i: number } }[] = [];
  plies.forEach((p, i) => {
    const row = rows.find((r) => r.no === p.moveNumber) ?? { no: p.moveNumber };
    if (!rows.includes(row)) rows.push(row);
    if (p.color === 'w') row.w = { ...p, i };
    else row.b = { ...p, i };
  });

  const cell = (m?: PlyRecord & { i: number }) => {
    if (!m) return <td />;
    const a = analyses.get(m.i);
    const bad = a && (a.classification === 'blunder' || a.classification === 'mistake');
    const current = view === m.i + 1;
    return (
      <td
        onClick={() => setView(m.i + 1)}
        style={{
          cursor: 'pointer',
          padding: '1px 6px',
          borderRadius: 4,
          background: current ? '#16a' : 'transparent',
          color: current ? '#fff' : bad ? '#c01515' : '#222',
          fontWeight: current ? 700 : 400,
        }}
      >
        {m.san}
        {bad ? (a!.classification === 'blunder' ? ' ??' : ' ?!') : ''}
      </td>
    );
  };

  return (
    <div style={{ minWidth: 200 }}>
      <h4 style={{ margin: '0 0 4px' }}>Move history</h4>
      {branchLabel && (
        <div style={{ margin: '0 0 8px', display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>{branchLabel}</div>
          {onBackToBranchSource && (
            <button
              onClick={onBackToBranchSource}
              title={branchSourceLabel ? `Return to ${branchSourceLabel}` : 'Return to the source line'}
              style={{
                border: '1px solid #d0d5dd',
                background: 'var(--card)',
                color: 'var(--text)',
                borderRadius: 6,
                padding: '5px 8px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              Back to source line
            </button>
          )}
        </div>
      )}
      <div ref={scrollRef} style={{ maxHeight: 360, overflowY: 'auto', fontSize: 13 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {rows.map((r) => {
              const isCurrentRow = view === (r.w?.i ?? -2) + 1 || view === (r.b?.i ?? -2) + 1;
              return (
                <tr key={r.no} ref={isCurrentRow ? currentRef : undefined}>
                  <td style={{ color: 'var(--muted)', paddingRight: 6 }}>{r.no}.</td>
                  {cell(r.w)}
                  {cell(r.b)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>← → keys to step</div>
    </div>
  );
}
