import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chess } from 'chess.js';
import samplePgn from '../fixtures/sample-game.pgn?raw';
import { gamesFromPgn, type ParsedGame, type PlyRecord } from '../engine/position';
import { computeLedMap, allSquares } from '../engine/led';
import { analyzeMoveLive } from '../engine/analyze';
import type { AnalyzedEntry } from '../engine/analytics';
import { extractPlyFeatures, controlShare, type FeatureEntry, type PlyFeatures } from '../engine/features';
import { UciEngine } from '../engine/evaluation';
import type { InsightCandidate, LedColor, LedMap, MoveAnalysis, Square } from '../engine/types';
import { tryCreateEngine } from './engine-browser';
import { MODES, LED_CSS } from './modes';
import { Board2D } from './Board2D';
import { ARROW, type Arrow } from './BoardArrows';
import { selectionArrows } from './annotate';
import { FactsPanel } from './FactsPanel';
import { MateCard } from './MateCard';
import { AnalyticsPanel } from './AnalyticsPanel';
import { DatasetPanel } from './DatasetPanel';
import { CommentaryPanel, type CommentaryJob, type Handshake } from './CommentaryPanel';
import { LedPreview } from './LedPreview';
import { createOpenAIClient, type ChatClient } from '../llm/openai';
import { narrate } from '../llm/narrate';

const env = import.meta.env as Record<string, string | undefined>;
const initialKey = () => env.VITE_OPENAI_API_KEY || localStorage.getItem('cvs_openai_key') || '';
const OPENAI_MODEL = env.VITE_OPENAI_MODEL || 'gpt-5.5';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function App() {
  const [pgnText, setPgnText] = useState(samplePgn);
  const [games, setGames] = useState<ParsedGame[]>(() => safeGames(samplePgn));
  const [gameIndex, setGameIndex] = useState(0);
  const currentGame = games[gameIndex];
  const plies = useMemo(() => currentGame?.plies ?? [], [currentGame]);
  const currentGameKey = useMemo(() => gameCacheKey(currentGame), [currentGame]);
  const [view, setView] = useState(0); // 0 = start; k = after move k
  const [tab, setTab] = useState<'board' | 'dataset'>('board');
  const [modeId, setModeId] = useState(MODES[0].id);
  const [selected, setSelected] = useState<Square | undefined>(undefined);
  const [showThreats, setShowThreats] = useState(true);
  const [showAllThreats, setShowAllThreats] = useState(false);
  const [cascade, setCascade] = useState(true);
  const [followMove, setFollowMove] = useState(true);
  const [focused, setFocused] = useState<InsightCandidate | null>(null);
  const [analyses, setAnalyses] = useState<Map<number, MoveAnalysis>>(new Map());
  const [engineState, setEngineState] = useState<'loading' | 'ready' | 'off'>('loading');
  const [datasetJob, setDatasetJob] = useState({ running: false, done: 0, total: 0 });
  const engineRef = useRef<UciEngine | null>(null);
  const analysisCacheRef = useRef<Map<string, Map<number, MoveAnalysis>>>(new Map());
  const featureCacheRef = useRef<Map<string, Map<number, CachedFeatureEntry>>>(new Map());
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
    };
  }, []);

  const fen = view === 0 ? plies[0]?.fenBefore ?? START_FEN : plies[view - 1].fenAfter;
  const plyIndex = view - 1; // index into plies for the move that produced `fen`
  const analysis = view > 0 ? analyses.get(plyIndex) : undefined;
  const moveLabel = view > 0 ? `${plies[plyIndex].moveNumber}${plies[plyIndex].color === 'w' ? '.' : '...'} ${plies[plyIndex].san}` : undefined;

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
          const a = await analyzeMoveLive(engine, plies[target].fenBefore, plies[target].san);
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
      setDatasetJob({ running: false, done: 0, total: 0 });
      analysisCacheRef.current = new Map();
      featureCacheRef.current = new Map();
      setGames(g);
      setGameIndex(0);
      resetViewState(new Map());
    }
  };
  const selectGame = (i: number) => {
    setGameIndex(i);
    resetViewState(analysisCacheRef.current.get(gameCacheKey(games[i])) ?? new Map());
  };
  const analyzeAllGames = async () => {
    const engine = engineRef.current;
    if (!engine || engineState !== 'ready' || datasetJob.running) return;
    const runId = ++datasetRunRef.current;
    const tasks = games.flatMap((game) => {
      const key = gameCacheKey(game);
      const cached = analysisCacheRef.current.get(key) ?? new Map<number, MoveAnalysis>();
      return game.plies
        .map((ply, plyIndex) => ({ game, key, ply, plyIndex }))
        .filter((task) => !cached.has(task.plyIndex));
    });
    setDatasetJob({ running: true, done: 0, total: tasks.length });
    if (tasks.length === 0) {
      setDatasetJob({ running: false, done: 0, total: 0 });
      return;
    }
    for (const task of tasks) {
      if (datasetRunRef.current !== runId) return;
      const a = await analyzeMoveLive(engine, task.ply.fenBefore, task.ply.san);
      const cached = analysisCacheRef.current.get(task.key) ?? new Map<number, MoveAnalysis>();
      cached.set(task.plyIndex, a);
      analysisCacheRef.current.set(task.key, cached);
      if (task.key === currentGameKeyRef.current) {
        setAnalyses((prev) => new Map(prev).set(task.plyIndex, a));
      }
      setDatasetJob((prev) => ({ ...prev, done: Math.min(prev.done + 1, prev.total) }));
    }
    if (datasetRunRef.current === runId) setDatasetJob((prev) => ({ ...prev, running: false }));
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

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 20, color: '#1a1a1a' }}>
      <style>{`@keyframes csvBlink{50%{opacity:0.1}}`}</style>
      <h1 style={{ margin: '0 0 4px' }}>Chess Vision Studio</h1>
      <div style={{ color: '#666', marginBottom: 12 }}>
        2D chess perception — relations · SEE · diff · saliency · validated motifs.{' '}
        <EngineBadge state={engineState} />{' '}
        {engineState === 'ready' && analyses.size < plies.length && (
          <span style={{ fontSize: 12, color: '#888' }}>
            · analyzing {analyses.size}/{plies.length}…
          </span>
        )}
        {engineState === 'ready' && plies.length > 0 && analyses.size >= plies.length && (
          <span style={{ fontSize: 12, color: '#3fbf5f' }}>· analysis complete ✓</span>
        )}
      </div>

      {games.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <TabButton active={tab === 'board'} onClick={() => setTab('board')}>
            Board
          </TabButton>
          <TabButton active={tab === 'dataset'} onClick={() => setTab('dataset')}>
            Dataset · {games.length} games
          </TabButton>
        </div>
      )}

      {tab === 'dataset' ? (
        <DatasetPanel
          games={games}
          engineReady={engineState === 'ready'}
          analysisProgress={datasetJob}
          onAnalyzeAll={analyzeAllGames}
          onOpenGame={(i) => {
            selectGame(i);
            setTab('board');
          }}
        />
      ) : (
        <>
      {games.length > 1 && (
        <div style={{ marginBottom: 12, fontSize: 13 }}>
          <strong style={{ marginRight: 6 }}>Game {gameIndex + 1} / {games.length}:</strong>
          <select
            value={gameIndex}
            onChange={(e) => selectGame(Number(e.target.value))}
            style={{ maxWidth: 460, fontSize: 13 }}
          >
            {games.map((g, i) => (
              <option key={i} value={i}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: board + nav */}
        <div>
          <ModeBar modeId={modeId} onPick={setModeId} engineReady={engineState === 'ready'} />
          <Board2D
            fen={fen}
            ledMap={ledMap}
            selected={selected}
            onSelect={setSelected}
            arrows={arrows}
          />
          <Nav view={view} total={plies.length} setView={setView} />
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
        <div>
          <FactsPanel
            fen={fen}
            selected={selected}
            analysis={analysis}
            move={moveLabel}
            focused={focused}
            onFocus={(ins) => setFocused((cur) => (cur === ins ? null : ins))}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <LedPreview ledMap={ledMap} />
          <MoveHistory plies={plies} view={view} setView={setView} analyses={analyses} />
        </div>
      </div>

      {entries.length > 0 && (
        <AnalyticsPanel entries={entries} features={featureEntries} view={view} onJump={(ply) => setView(ply)} />
      )}
        </>
      )}

      <details style={{ marginTop: 20 }}>
        <summary style={{ cursor: 'pointer' }}>Import PGN (single game or full export)</summary>
        <textarea
          value={pgnText}
          onChange={(e) => setPgnText(e.target.value)}
          placeholder="Paste a PGN — one game or a multi-game export"
          style={{ width: 480, height: 120, display: 'block', marginTop: 8 }}
        />
        <button onClick={loadPgn} style={{ marginTop: 6 }}>
          Load
        </button>
      </details>
    </div>
  );
}

/** Replay an insight's forcing line into numbered tactical arrows. */
function lineArrows(fen: string, ins: InsightCandidate, dashed: boolean): Arrow[] {
  const out: Arrow[] = [];
  const line = ins.kind === 'motif' ? ins.line : [];
  if (line.length) {
    const c = new Chess(fen);
    line.slice(0, 6).forEach((san, i) => {
      let m: ReturnType<Chess['move']> | null = null;
      try {
        m = c.move(san);
      } catch {
        m = null;
      }
      if (m)
        out.push({ from: m.from, to: m.to, color: ARROW.tactical, label: String(i + 1), dashed });
    });
  } else {
    for (const [from, to] of ins.arrows) out.push({ from, to, color: ARROW.attack, dashed });
  }
  return out;
}

/** Spotlight one insight on the LED grid: executor purple, targets orange. */
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

function gameCacheKey(game: ParsedGame | undefined): string {
  if (!game) return 'no-game';
  const first = game.plies[0]?.fenBefore ?? '';
  const last = game.plies[game.plies.length - 1]?.fenAfter ?? '';
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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: '1px solid ' + (active ? '#3b6fd4' : '#ccc'),
        background: active ? '#3b6fd4' : '#fff',
        color: active ? '#fff' : '#444',
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

function EngineBadge({ state }: { state: 'loading' | 'ready' | 'off' }) {
  const text = state === 'loading' ? 'engine: loading…' : state === 'ready' ? 'engine: ready' : 'engine: off (pure modes only)';
  const bg = state === 'ready' ? '#3fbf5f' : state === 'loading' ? '#e8923b' : '#999';
  return (
    <span style={{ background: bg, color: '#fff', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>
      {text}
    </span>
  );
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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8, maxWidth: 460 }}>
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
    <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
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
        { pct: c.exclusiveWhitePct, color: '#3b6fd4', label: `White ${c.exclusiveWhitePct}%` },
        { pct: c.contestedPct, color: '#8a5cc4', label: `contested ${c.contestedPct}%` },
        { pct: c.exclusiveBlackPct, color: '#d43b3b', label: `Black ${c.exclusiveBlackPct}%` },
        { pct: c.neutralPct, color: '#e6e6e6', label: `neutral ${c.neutralPct}%` },
      ]
    : [];
  return (
    <div style={{ width: 456, marginTop: 6 }} title="Share of the 64 squares each side's pieces attack (contested = both).">
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#666', marginBottom: 2 }}>
        <span>Board control</span>
        {c && <span>center {c.centerWhite}–{c.centerBlack}</span>}
      </div>
      <div style={{ display: 'flex', height: 12, borderRadius: 3, overflow: 'hidden', background: '#f0f0f0' }}>
        {segs.map((s, i) =>
          s.pct > 0 ? (
            <div key={i} title={s.label} style={{ width: `${s.pct}%`, background: s.color }} />
          ) : null,
        )}
      </div>
      {c && (
        <div
          style={{ display: 'flex', gap: 10, fontSize: 11, color: '#777', marginTop: 2 }}
          title={`Total reach (overlaps on contested): White ${c.whitePct}%, Black ${c.blackPct}%`}
        >
          <span style={{ color: '#3b6fd4' }}>White {c.exclusiveWhitePct}%</span>
          <span style={{ color: '#8a5cc4' }}>contested {c.contestedPct}%</span>
          <span style={{ color: '#d43b3b' }}>Black {c.exclusiveBlackPct}%</span>
          <span style={{ color: '#aaa' }}>neutral {c.neutralPct}%</span>
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
        width: 456,
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
            background: '#fafafa',
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

function AnnotationLegend({
  showThreats,
  setShowThreats,
  showAllThreats,
  setShowAllThreats,
  cascade,
  setCascade,
  followMove,
  setFollowMove,
  hasSelection,
  onClear,
}: {
  showThreats: boolean;
  setShowThreats: (v: boolean) => void;
  showAllThreats: boolean;
  setShowAllThreats: (v: boolean) => void;
  cascade: boolean;
  setCascade: (v: boolean) => void;
  followMove: boolean;
  setFollowMove: (v: boolean) => void;
  hasSelection: boolean;
  onClear: () => void;
}) {
  const swatch = (color: string, label: string) => (
    <span style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
      <span
        style={{
          display: 'inline-block',
          width: 14,
          height: 4,
          background: color,
          borderRadius: 2,
          marginRight: 4,
          verticalAlign: 'middle',
        }}
      />
      {label}
    </span>
  );
  return (
    <div style={{ marginTop: 8, fontSize: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
      <strong style={{ marginRight: 6 }}>Arrows:</strong>
      {swatch(ARROW.attack, 'attacks / threats')}
      {swatch(ARROW.defend, 'defends / protects')}
      {swatch(ARROW.tactical, 'tactical line (1·2·3)')}
      {swatch(ARROW.move, 'played move')}
      <label style={{ marginLeft: 8, cursor: 'pointer' }} title="track the move that just happened">
        <input type="checkbox" checked={followMove} onChange={(e) => setFollowMove(e.target.checked)} />{' '}
        follow move
      </label>
      <label style={{ marginLeft: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={showThreats} onChange={(e) => setShowThreats(e.target.checked)} />{' '}
        threat line
      </label>
      <label style={{ marginLeft: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={showAllThreats}
          onChange={(e) => setShowAllThreats(e.target.checked)}
        />{' '}
        all threats
      </label>
      <label style={{ marginLeft: 8, cursor: 'pointer' }} title="surface the next hop in the chain">
        <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />{' '}
        cascade
      </label>
      {hasSelection && (
        <button onClick={onClear} style={{ marginLeft: 6, fontSize: 11 }}>
          clear selection
        </button>
      )}
    </div>
  );
}

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
        maxWidth: 8 * 56,
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
}: {
  plies: PlyRecord[];
  view: number;
  setView: (n: number) => void;
  analyses: Map<number, MoveAnalysis>;
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
      <div ref={scrollRef} style={{ maxHeight: 360, overflowY: 'auto', fontSize: 13 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            {rows.map((r) => {
              const isCurrentRow = view === (r.w?.i ?? -2) + 1 || view === (r.b?.i ?? -2) + 1;
              return (
                <tr key={r.no} ref={isCurrentRow ? currentRef : undefined}>
                  <td style={{ color: '#999', paddingRight: 6 }}>{r.no}.</td>
                  {cell(r.w)}
                  {cell(r.b)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>← → keys to step</div>
    </div>
  );
}
