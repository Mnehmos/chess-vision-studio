// Play mode — the same perception + coaching suite as the analysis board, but for
// a LIVE game you play (hot-seat). Drag-and-drop OR click-to-move, full legality
// via chess.js, every mode-scoped overlay applied to the live position, a Facts
// inspect card for any square, and — once the engine is loaded — a per-move
// analysis (classification + What-Changed) plus deterministic teaching events
// compiled from Stockfish judgment and Rust facts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board2D } from './Board2D';
import { ARROW, type Arrow } from './BoardArrows';
import { FactsPanel } from './FactsPanel';
import { EngineComparisonPanel } from './EngineComparisonPanel';
import {
  analyzeWithCvsEngine,
  getTeachingFacts,
  type CvsEngineAnalysis,
  type CvsEngineHealth,
} from './cvs-engine-client';
import { TeachingLog, whiteEvalText, whiteEvalCp, hangingNote, type CoachTurn } from './TeachingLog';
import { computeLedMap, type ModeId } from '../engine/led';
import { selectionArrows, lineArrows } from './annotate';
import { AnnotationLegend } from './AnnotationLegend';
import { analyzeMoveLive } from '../engine/analyze';
import { extractPlyFeatures, type PlyFeatures } from '../engine/features';
import type { UciEngine } from '../engine/evaluation';
import { compileTeachingEvents } from '../engine/teaching/compile';
import { detectOpening } from '../engine/teaching/openings';
import { describeMoveIdea, type MoveIdea } from '../engine/teaching/moveIdea';
import type {
  TeachingAnalysis,
  TeachingEvent,
  TeachingFactBundleV1,
  TeachingFactsRequestV1,
} from '../engine/teaching/types';
import { buildTeachingNodes, type TeachingNode } from '../engine/teaching/node';
import type { InsightCandidate, MoveAnalysis, Square } from '../engine/types';
import { useArrowAnalysis, type AlternativeLine, type ArrowAnalysisClients } from './arrow-analysis-store';
import { AlternativeLinesPanel } from './AlternativeLinesPanel';
import { AnnotationCommandList } from './AnnotationCommandList';
import { analyzeWithStockfish } from './stockfish-client';
import { downloadJson } from './exportState';
import { exportElementGif } from './gif-export';
import { PlayBoardHelp } from './PlayBoardHelp';
import { PlayBoardHeader } from './PlayBoardHeader';
import { PlayCommentaryPanel } from './PlayCommentaryPanel';
import { PlayDebugOverlay } from './PlayDebugOverlay';
import { PlayGameReview } from './PlayGameReview';
import { PlayMoveHistory } from './PlayMoveHistory';
import { PlayModeControls } from './PlayModeControls';
import { PlayModeLegend } from './PlayModeLegend';
import { PlayOpponentControls } from './PlayOpponentControls';
import { PlayPromotionOverlay } from './PlayPromotionOverlay';
import { PreviewTeachingCard } from './PreviewTeachingCard';
import { VariationPreviewPanel } from './VariationPreviewPanel';
import { PlayTurnPlate } from './PlayTurnPlate';
import { buildVariationPreviewArrows, buildVariationPreviewPositions } from './variation-preview';
import {
  legalDotsFor,
  legalMovesFrom,
  teachingLedMap,
  teachingNodeArrows,
  teachingRequestForLiveMove,
  validateExposedTactics,
  type VerboseMove,
} from './play-mode-helpers';
import { buildPlayModeExportPayload, type PlayOpponent } from './play-mode-export';
import { isHumanTurn, moveHistoryRows, playStatus, sideToMove } from './play-mode-state';
import {
  applyReviewAnalysis,
  buildReviewMoment,
  predictionBreakInsight,
  type ReviewMoment,
} from './play-mode-review';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Engine-opponent search depth (Stockfish; CVS uses its configured depth) and a
// short "thinking" beat so a human can read their own move's teaching before reply.
const OPPONENT_DEPTH = 12;
const OPPONENT_THINK_MS = 500;
type Opponent = PlayOpponent;

type HistEntry = { san: string; fen: string; from: Square; to: Square; uci: string };
export function PlayMode({
  engine,
  engineReady = false,
  narrateMove,
  cvsHealth,
  loadTeachingFacts = getTeachingFacts,
  arrowAnalysisClients,
}: {
  engine?: UciEngine | null;
  engineReady?: boolean;
  narrateMove?: (a: MoveAnalysis, features: PlyFeatures) => Promise<string>;
  narrateTeaching?: (event: TeachingEvent) => Promise<string>;
  cvsHealth?: CvsEngineHealth;
  loadTeachingFacts?: (request: TeachingFactsRequestV1) => Promise<TeachingFactBundleV1>;
  arrowAnalysisClients?: ArrowAnalysisClients;
}) {
  const [fen, setFen] = useState(START_FEN);
  const [selected, setSelected] = useState<Square | null>(null);
  const [history, setHistory] = useState<HistEntry[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [mode, setMode] = useState<ModeId>('legal');
  // Annotation toggles — the same controls as the analysis board.
  const [showThreats, setShowThreats] = useState(true);
  const [showAllThreats, setShowAllThreats] = useState(false);
  const [cascade, setCascade] = useState(true);
  const [followMove, setFollowMove] = useState(true);
  const [hideOverlays, setHideOverlays] = useState(false);
  const [focused, setFocused] = useState<InsightCandidate | null>(null);

  // Live coaching state for the move just played.
  const [lastAnalysis, setLastAnalysis] = useState<MoveAnalysis | null>(null);
  const [coachText, setCoachText] = useState('');
  const [explaining, setExplaining] = useState(false);
  const [debug, setDebug] = useState(false); // dev overlay: artifact identity + eval status
  const [teachingNodes, setTeachingNodes] = useState<import('../engine/teaching/node').TeachingNode[]>([]);
  const [teachingFocus, setTeachingFocus] = useState<import('../engine/teaching/node').TeachingNode | null>(null);
  const analyzeIdRef = useRef(0); // cancels stale analyses when you move/undo fast

  // Live analysis cache map for exporting
  const analysesRef = useRef<Map<number, MoveAnalysis>>(new Map());

  // Game review moments for prediction breaks
  const [reviewMoments, setReviewMoments] = useState<ReviewMoment[]>([]);

  // Export game + teaching corpus
  const exportGameData = () => {
    downloadJson(
      `cvs-play-game-${Date.now()}.json`,
      buildPlayModeExportPayload({
        history,
        startFen: START_FEN,
        fen,
        modeId: mode,
        selected,
        analyses: analysesRef.current,
        coachLog,
        annotations: { showThreats, showAllThreats, cascade, followMove },
        playerSide,
        opponent,
        reviewMoments,
        exportedAt: new Date().toISOString(),
      }),
    );
  };

  const handlePredictionBreak = (
    playedMoveUci: string,
    playedMoveSan: string,
    brokenAlt: AlternativeLine,
    fenBefore: string
  ) => {
    const newMoment = buildReviewMoment({
      ply: history.length,
      playedMoveUci,
      playedMoveSan,
      brokenAlt,
      fenBefore,
      nowMs: Date.now(),
    });
    const momentId = newMoment.id;

    setReviewMoments((prev) => [...prev, newMoment]);

    // Async analysis of the played move
    const isSf = engineReady;
    const depth = isSf ? 12 : (cvsHealth?.depth ?? 12);
    const analyzePromise = isSf
      ? analyzeWithStockfish(fenBefore, depth, playedMoveUci)
      : analyzeWithCvsEngine(fenBefore, depth, playedMoveUci);

    analyzePromise.then((res) => {
      const insightText = predictionBreakInsight({
        fenBefore,
        playedMoveSan,
        predictedMoveSan: brokenAlt.moves[0]?.san || playedMoveSan,
        playedScore: res.scoreCp,
        predictedScore: brokenAlt.scoreCp,
      });

      setReviewMoments((prev) => {
        const updated = applyReviewAnalysis(prev, momentId, res, insightText);

        setTimeout(() => {
          downloadJson(
            `cvs-play-game-${Date.now()}.json`,
            buildPlayModeExportPayload({
              history,
              startFen: START_FEN,
              fen,
              modeId: mode,
              selected,
              analyses: analysesRef.current,
              coachLog,
              annotations: { showThreats, showAllThreats, cascade, followMove },
              playerSide,
              opponent,
              reviewMoments: updated,
              exportedAt: new Date().toISOString(),
            }),
          );
        }, 100);

        return updated;
      });
    }).catch((err) => {
      console.error("Failed to analyze prediction break:", err);
    });
  };

  // Interactive arrow-to-variation states
  const {
    arrows: candidateArrows,
    alternatives,
    handleArrowDrawn,
    deleteAlternative,
    deleteMove,
    togglePin,
    deepenAlternative,
    generateBestLine,
    generatingBestLine,
    refuteLine,
    toggleReveal,
  } = useArrowAnalysis(fen, cvsHealth, engineReady, handlePredictionBreak, arrowAnalysisClients);

  const [previewLine, setPreviewLine] = useState<{ alt: AlternativeLine; currentIndex: number } | null>(null);
  const [hoveredAltId, setHoveredAltId] = useState<string | null>(null);
  const gifCaptureRef = useRef<HTMLDivElement | null>(null);
  const [gifJob, setGifJob] = useState<{ running: boolean; done: number; total: number }>({
    running: false,
    done: 0,
    total: 0,
  });

  // Esc key exits variation preview mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewLine(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const previewPositions = useMemo(() => {
    return previewLine ? buildVariationPreviewPositions(previewLine.alt) : [];
  }, [previewLine]);

  const activeFen = previewLine
    ? (previewPositions[previewLine.currentIndex]?.fen ?? fen)
    : fen;

  const saveVariation = () => {
    if (!previewLine) return;
    opponentSeqRef.current += 1; // cancel any pending engine reply
    setThinking(false);

    // Find the move/ply index in the history that matches the preview start position
    const fenBeforeVariation = previewLine.alt.rootFen;
    let targetIndex = -1;
    if (fenBeforeVariation === START_FEN) {
      targetIndex = 0;
    } else {
      targetIndex = history.findIndex(h => h.fen === fenBeforeVariation) + 1;
    }

    // Construct the next history
    const nextHistory = history.slice(0, targetIndex);
    let currChess = new Chess(fenBeforeVariation);
    const moves = [...previewLine.alt.moves.map(m => m.uci), ...previewLine.alt.pv];

    // Settle turns in the coachLog
    const nextCoachLog = coachLog.filter((turn) => turn.ply < targetIndex);

    for (let i = 0; i < moves.length; i++) {
      const moveUci = moves[i];
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

      const newFen = currChess.fen();
      const san = moved.san;
      const from = moved.from as Square;
      const to = moved.to as Square;
      const promotion = moved.promotion;
      const uci = `${from}${to}${promotion ?? ''}`;
      const ply = nextHistory.length;
      const mover: 'w' | 'b' = ply % 2 === 0 ? 'w' : 'b';
      const who: 'you' | 'coach' = opponent === 'none' || mover === playerSide ? 'you' : 'coach';
      const opening = detectOpening([...nextHistory.map((h) => h.san), san]);

      nextHistory.push({ san, fen: newFen, from, to, uci });

      nextCoachLog.push({
        ply,
        who,
        side: mover,
        san,
        teaching: null,
        nodes: i === 0 ? previewLine.alt.teachingNodes : [],
        idea: null,
        summary: i === 0 ? (previewLine.alt.scoreCp ? `Alternative evaluation: ${(previewLine.alt.scoreCp / 100).toFixed(2)}` : '') : '',
        evalText: '',
        evalCp: null,
        opening,
        status: 'done',
      });
    }

    setHistory(nextHistory);
    const finalFen = nextHistory.length ? nextHistory[nextHistory.length - 1].fen : START_FEN;
    setFen(finalFen);
    setSelected(null);
    setPromo(null);
    setCoachLog(nextCoachLog);
    setPreviewLine(null);
    resetCoach();
  };

  const exportPreviewGif = async () => {
    if (!previewLine || !gifCaptureRef.current || gifJob.running || previewPositions.length === 0) return;
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

  // Engine opponent: off by default (you play both sides). When set, the engine
  // plays whichever side you don't, replying after each of your moves.
  const [opponent, setOpponent] = useState<Opponent>('none');
  const [playerSide, setPlayerSide] = useState<'w' | 'b'>('w');
  const [thinking, setThinking] = useState(false);
  const opponentSeqRef = useRef(0); // cancels a pending engine reply on undo/new game
  // Running coaching dialogue (vs an engine opponent): one entry per move.
  const [coachLog, setCoachLog] = useState<CoachTurn[]>([]);
  const coachScrollRef = useRef<HTMLDivElement | null>(null);

  const status = useMemo(() => playStatus(fen), [fen]);

  // Whose move it is from the human's seat — true when there's no engine opponent
  // or it's the human's colour to move. Gates manual moves so you can't play the
  // engine's pieces, and tells the opponent effect when to reply.
  const humanToMove = useMemo(
    () => isHumanTurn(fen, opponent, playerSide),
    [opponent, fen, playerSide],
  );

  // Keep the coaching dialogue pinned to the newest turn as it grows.
  useEffect(() => {
    const el = coachScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [coachLog]);

  // The named opening for the current line — only while still in book, so the card
  // doesn't keep claiming "London System" deep into a tactical middlegame.
  const currentOpening = useMemo(() => {
    const found = detectOpening(history.map((h) => h.san));
    return found?.inBook ? found : null;
  }, [history]);

  // Legal destinations of the picked-up piece — for click-to-move acceptance.
  const targets = useMemo(
    () => (selected ? legalMovesFrom(fen, selected).map((m) => m.to as Square) : []),
    [fen, selected],
  );

  // Gate the played-move analysis to the CURRENT board: a consumer must never render
  // an artifact computed for a different position. positionAfter is the artifact's
  // identity; it equals fen after a move and after an inspect-click, so this is a
  // defense-in-depth guard that fails safe if an async race ever desyncs them.
  const liveAnalysis = lastAnalysis && lastAnalysis.positionAfter === fen ? lastAnalysis : null;

  // Native engine eval of the current board (same panel as Analyze mode).
  const [cvsAnalysis, setCvsAnalysis] = useState<CvsEngineAnalysis | null>(null);
  const [cvsBusy, setCvsBusy] = useState(false);
  const [cvsError, setCvsError] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!cvsHealth?.available) return;
    let cancelled = false;
    setCvsBusy(true);
    const t = setTimeout(() => {
      analyzeWithCvsEngine(fen, cvsHealth.depth)
        .then((r) => { if (!cancelled) { setCvsAnalysis(r); setCvsError(undefined); } })
        .catch((e) => { if (!cancelled) setCvsError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!cancelled) setCvsBusy(false); });
    }, 60);
    return () => { cancelled = true; clearTimeout(t); };
  }, [fen, cvsHealth?.available, cvsHealth?.depth]);

  // The board overlay: the SAME mode-scoped lenses as the analysis view, applied
  // live to the current position. 'legal' doubles as the move-target hint; the
  // 'What Changed' lens uses the live MoveAnalysis of the move you just played.
  const ledMap = useMemo(
    () => {
      if (hideOverlays) return { mode: 'off' as any, squares: {} };
      return teachingFocus
        ? teachingLedMap(teachingFocus)
        : computeLedMap(mode, {
            fen,
            selectedSquare: selected ?? undefined,
            analysis: liveAnalysis ?? undefined,
          });
    },
    [mode, fen, selected, liveAnalysis, teachingFocus, hideOverlays],
  );

  // Validated coaching for the played move: hazard diff → control action.
  const featuresOfLast = useMemo(
    () =>
      liveAnalysis
        ? extractPlyFeatures(liveAnalysis.positionBefore, liveAnalysis.positionAfter, liveAnalysis.move, liveAnalysis)
        : null,
    [liveAnalysis],
  );
  const last = history[history.length - 1];

  // The full annotation suite, live: focus mode spotlights one tactic; otherwise
  // the played-move arrow (follow move) + the selected piece's attack/defend/
  // cascade arrows + numbered threat lines from the move's analysis.
  const baseArrows = useMemo<Arrow[]>(() => {
    if (hideOverlays) return [];
    if (teachingFocus) return teachingNodeArrows(teachingFocus);
    if (focused) return lineArrows(fen, focused, false);
    const out: Arrow[] = [];
    if (followMove && last) out.push({ from: last.from, to: last.to, color: ARROW.move, move: true });
    if (selected) out.push(...selectionArrows(fen, selected, cascade));
    if (liveAnalysis && liveAnalysis.rankedInsights.length) {
      const top = liveAnalysis.rankedInsights[0];
      const threats = showAllThreats
        ? liveAnalysis.rankedInsights.filter((i) => i.source === 'refutation' || i.source === 'available')
        : showThreats && top.source === 'refutation'
          ? [top]
          : [];
      for (const ins of threats) out.push(...lineArrows(fen, ins, ins !== top));
    }
    return out;
  }, [fen, selected, liveAnalysis, showThreats, showAllThreats, cascade, focused, teachingFocus, followMove, last, hideOverlays]);

  const previewArrows = useMemo(() => {
    return previewLine
      ? buildVariationPreviewArrows({
          alt: previewLine.alt,
          previewPositions,
          currentIndex: previewLine.currentIndex,
        })
      : [];
  }, [previewLine, previewPositions]);

  const arrows = useMemo<Arrow[]>(() => {
    if (previewLine) return previewArrows;
    const list = [...baseArrows, ...candidateArrows];
    if (hoveredAltId) {
      const alt = alternatives.find((x) => x.id === hoveredAltId);
      if (alt) {
        return list.map((a) => {
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
    return list;
  }, [baseArrows, candidateArrows, hoveredAltId, previewLine, previewArrows, alternatives]);

  function applyMove(from: Square, to: Square, promotion?: string) {
    const before = fen;
    const c = new Chess(before);
    let m: VerboseMove | null = null;
    try {
      m = c.move({ from, to, promotion }) as unknown as VerboseMove;
    } catch {
      m = null;
    }
    if (!m) return;
    const san = m.san;
    const uci = `${from}${to}${promotion ?? ''}`;
    const ply = history.length; // 0-based index of THIS move
    const mover: 'w' | 'b' = ply % 2 === 0 ? 'w' : 'b';
    const who: 'you' | 'coach' = opponent === 'none' || mover === playerSide ? 'you' : 'coach';
    const logging = true; // always keep the running teaching log — off-mode too
    const opening = detectOpening([...history.map((h) => h.san), san]);

    setHistory((h) => [...h, { san, fen: c.fen(), from, to, uci }]);
    setFen(c.fen());
    setSelected(followMove ? to : null); // "follow move" — broadcast the move just made
    setFocused(null);
    setPromo(null);
    setCoachText('');
    setTeachingNodes([]);
    setTeachingFocus(null);
    if (logging) {
      setCoachLog((log) => [
        ...log,
        { ply, who, side: mover, san, teaching: null, idea: null, summary: '', evalText: '', evalCp: null, opening, status: 'analyzing' },
      ]);
    }

    // Settle this ply's dialogue entry. Keyed by ply and NOT gated by the live-board
    // latest-wins guard, so every move in the conversation keeps its own teaching.
    const defaultPolicy = {
      tacticalClaims: 'required' as const,
      counterfactualClaims: 'required' as const,
      betterMoveClaims: 'required' as const,
      structuralClaims: 'deterministic-or-engine' as const,
      minimumDepth: 14,
      timeoutMs: 1000,
    };

    // Settle this ply's dialogue entry. Keyed by ply and NOT gated by the live-board
    // latest-wins guard, so every move in the conversation keeps its own teaching.
    const settleTurn = (
      a: MoveAnalysis | null,
      teaching: TeachingAnalysis | null,
      nodes: TeachingNode[],
      idea: MoveIdea | null,
      hazardNote: string | undefined,
    ) => {
      if (!logging) return;
      setCoachLog((log) =>
        log.map((turn) =>
          turn.ply === ply
            ? {
                ...turn,
                teaching,
                nodes,
                idea,
                hazardNote,
                summary: a?.topExplanation ?? '',
                evalText: a ? whiteEvalText(a, mover) : '',
                evalCp: a ? whiteEvalCp(a, mover) : null,
                classification: a?.classification,
                cpLoss: a?.cpLoss,
                betterMove: a?.evalBefore.pv[0],
                status: 'done',
              }
            : turn,
        ),
      );
    };

    // Kick a live analysis of the move (free, local). Latest-wins via the seq ref
    // for the live board; the log entry settles per-ply regardless.
    const id = ++analyzeIdRef.current;
    if (engine && engineReady) {
      setLastAnalysis(null);
      analyzeMoveLive(engine, before, san)
        .then(async (a) => {
          analysesRef.current.set(ply, a);
          if (analyzeIdRef.current === id) setLastAnalysis(a);
          let teaching: TeachingAnalysis | null = null;
          let nodes: TeachingNode[] = [];
          let idea: MoveIdea | null = null;
          let hazardNote: string | undefined;
          if (cvsHealth?.available) {
            const request = teachingRequestForLiveMove(before, uci, a);
            if (request) {
              try {
                const facts = await loadTeachingFacts(request);

                // Unified teaching nodes
                const nodeReq = {
                  rootFen: before,
                  subjectMove: uci,
                  resultingFen: a.positionAfter,
                  principalVariation: request.principalVariationUci,
                  verificationPolicy: defaultPolicy,
                  facts,
                  engine: engine || undefined,
                };
                nodes = await buildTeachingNodes(nodeReq);

                teaching = compileTeachingEvents({ analysis: a, facts });
                idea = describeMoveIdea(facts); // fork / pin / winning capture
                if (engine) {
                  // Re-grade an exposed fork/pin against the engine — a tactic that's
                  // refuted at depth must not read as won material.
                  teaching = await validateExposedTactics(teaching, facts, engine, a.evalAfter.depth);
                }
                // Surface a hanging piece the compiler didn't name (it's in the facts).
                hazardNote = hangingNote(facts, nodes);
              } catch (e) {
                console.error("PlayMode teaching nodes error", e);
              }
            }
          }
          if (analyzeIdRef.current === id) {
            setTeachingNodes(nodes);
          }
          settleTurn(a, teaching, nodes, idea, hazardNote);
        })
        .catch(() => settleTurn(null, null, [], null, undefined));
    } else {
      setLastAnalysis(null);
      settleTurn(null, null, [], null, undefined);
    }
  }

  // Engine opponent reply: when it's the opponent's turn, think briefly then play
  // the engine's best move through the same applyMove path (so it gets analyzed and
  // taught like any move). A sequence ref + fen dependency cancel a stale reply
  // when you undo, start a new game, or change settings mid-think.
  useEffect(() => {
    if (opponent === 'none' || status.over || humanToMove) return;
    const canPlay = opponent === 'cvs' ? !!cvsHealth?.available : !!(engine && engineReady);
    if (!canPlay) return;
    const seq = ++opponentSeqRef.current;
    const moveFen = fen;
    let cancelled = false;
    setThinking(true);
    (async () => {
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, OPPONENT_THINK_MS));
        if (cancelled || opponentSeqRef.current !== seq) return;
        const uci =
          opponent === 'cvs' && cvsHealth?.available
            ? (await analyzeWithCvsEngine(moveFen, cvsHealth.depth)).uci
            : engine && engineReady
              ? await engine.bestMove(moveFen, OPPONENT_DEPTH)
              : null;
        if (cancelled || opponentSeqRef.current !== seq) return;
        if (uci && uci.length >= 4 && uci !== '(none)' && uci !== '0000') {
          applyMove(uci.slice(0, 2) as Square, uci.slice(2, 4) as Square, uci.slice(4) || undefined);
        }
      } catch {
        // Leave it the opponent's turn; the human can switch the opponent off or
        // start a new game. Never fabricate a move.
      } finally {
        if (!cancelled && opponentSeqRef.current === seq) setThinking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // applyMove is a stable per-render closure; fen/turn changes drive re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, opponent, playerSide, humanToMove, status.over, cvsHealth?.available, cvsHealth?.depth, engine, engineReady]);

  function tryMove(from: Square, to: Square) {
    if (status.over || !humanToMove) return; // not your turn vs an engine opponent
    const matches = legalMovesFrom(fen, from).filter((m) => m.to === to);
    if (!matches.length) return; // illegal — no state change
    if (matches.every((m) => m.promotion)) {
      setPromo({ from, to }); // pawn reaching the last rank — ask which piece
      return;
    }
    applyMove(from, to, matches[0].promotion);
  }

  function onSquareClick(sq: Square) {
    if (promo) return; // resolve the promotion choice first
    // If a side-to-move piece is up and you click a legal destination → move.
    if (!status.over && selected && targets.includes(sq)) {
      tryMove(selected, sq);
      return;
    }
    // Click the selection again to clear it.
    if (selected === sq) {
      setSelected(null);
      setFocused(null);
      setTeachingFocus(null);
      return;
    }
    // Otherwise inspect ANY square on demand — your piece, the opponent's, or
    // empty. The Facts card + selection arrows + legal overlay populate for it.
    // Starting a new inspection drops any focused-insight spotlight (it was painting
    // a prior selection's tactic, not this square).
    setFocused(null);
    setTeachingFocus(null);
    setSelected(sq);
  }

  function resetCoach() {
    analyzeIdRef.current++; // cancel any in-flight analysis
    setLastAnalysis(null);
    setCoachText('');
    setFocused(null);
    setTeachingNodes([]);
    setTeachingFocus(null);
    setPreviewLine(null);
  }

  function undo() {
    if (!history.length) return;
    opponentSeqRef.current += 1; // cancel any pending engine reply
    setThinking(false);
    let next = history.slice(0, -1);
    // vs an engine opponent, also take back the engine's reply so it's your move.
    if (opponent !== 'none' && next.length) {
      const sideToMove = new Chess(next[next.length - 1].fen).turn();
      if (sideToMove !== playerSide) next = next.slice(0, -1);
    }
    setHistory(next);
    setFen(next.length ? next[next.length - 1].fen : START_FEN);
    setSelected(null);
    setPromo(null);
    setCoachLog((log) => log.filter((turn) => turn.ply < next.length)); // drop undone turns
    setReviewMoments((prev) => prev.filter((m) => m.ply < next.length));
    for (const ply of Array.from(analysesRef.current.keys())) {
      if (ply >= next.length) {
        analysesRef.current.delete(ply);
      }
    }
    resetCoach();
  }

  function newGame() {
    opponentSeqRef.current += 1; // cancel any pending engine reply
    setThinking(false);
    setFen(START_FEN);
    setHistory([]);
    setSelected(null);
    setPromo(null);
    setMode('legal');
    setCoachLog([]);
    setReviewMoments([]);
    analysesRef.current = new Map();
    resetCoach();
  }

  // Pick the side you play; flips the board to your view and starts fresh so the
  // engine can open if you chose Black.
  function choosePlayerSide(side: 'w' | 'b') {
    setPlayerSide(side);
    setFlipped(side === 'b');
    newGame();
  }

  async function explain() {
    if (!narrateMove || !liveAnalysis || !featuresOfLast) return;
    setExplaining(true);
    setCoachText('');
    try {
      setCoachText(await narrateMove(liveAnalysis, featuresOfLast));
    } catch (e) {
      setCoachText(`Coach unavailable — ${String((e as Error)?.message ?? e)}`);
    } finally {
      setExplaining(false);
    }
  }

  const turn = sideToMove(fen); // side to move — drives the turn plates + promo glyphs
  const topSide: 'w' | 'b' = flipped ? 'w' : 'b';
  const bottomSide: 'w' | 'b' = flipped ? 'b' : 'w';
  const rows = moveHistoryRows(history);

  return (
    <div className="cvs-workspace">
      <div className="play-left-rail">
        <AnnotationCommandList />
        <PlayGameReview reviewMoments={reviewMoments} onExport={exportGameData} />
      </div>

      {/* ── Board + controls ───────────────────────────────────────────── */}
      <div
        ref={gifCaptureRef}
        className="cvs-gif-capture cvs-gif-capture--play"
      >
        <div className="play-board-card">
        <div data-gif-crop="true">
        <PlayBoardHeader
          status={status}
          hasHistory={history.length > 0}
          onUndo={undo}
          onFlip={() => setFlipped((f) => !f)}
          onExport={exportGameData}
          onNewGame={newGame}
        />

        <PlayOpponentControls
          opponent={opponent}
          cvsAvailable={!!cvsHealth?.available}
          stockfishAvailable={engineReady}
          playerSide={playerSide}
          thinking={thinking}
          onOpponentChange={setOpponent}
          onPlayerSideChange={choosePlayerSide}
        />

        <PlayModeControls
          mode={mode}
          hasAnalysis={!!lastAnalysis}
          hideOverlays={hideOverlays}
          onModeChange={setMode}
          onHideOverlaysChange={setHideOverlays}
        />

        <PlayTurnPlate color={topSide} active={!status.over && turn === topSide} />

        <div className="play-board-stage">
          <Board2D
            legalDots={(previewLine || hideOverlays) ? undefined : (selected ? legalDotsFor(activeFen, selected) : undefined)}
            fen={activeFen}
            ledMap={(previewLine || hideOverlays) ? { mode: 'off' as any, squares: {} } : ledMap}
            selected={(previewLine || hideOverlays) ? undefined : (selected || undefined)}
            onSelect={previewLine ? () => {} : onSquareClick}
            arrows={arrows}
            orientation={flipped ? 'black' : 'white'}
            draggable={previewLine ? false : !status.over}
            onPieceDrop={previewLine ? undefined : (from, to) => tryMove(from, to)}
            onArrowDrawn={previewLine ? undefined : handleArrowDrawn}
            onArrowRightClick={previewLine ? undefined : handleArrowDrawn}
          />
          <PlayPromotionOverlay
            promo={promo}
            turn={turn}
            onPromote={(piece) => {
              if (promo) applyMove(promo.from, promo.to, piece);
            }}
          />
        </div>

        <PlayTurnPlate color={bottomSide} active={!status.over && turn === bottomSide} />

        <PlayModeLegend mode={mode} />
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
          onClear={() => setSelected(null)}
          hideOverlays={hideOverlays}
          setHideOverlays={setHideOverlays}
        />
        <PlayBoardHelp debug={debug} onDebugChange={setDebug} />

        {previewLine && (
          <VariationPreviewPanel
            previewLine={previewLine}
            previewPositions={previewPositions}
            gifJob={gifJob}
            onStep={(currentIndex) => setPreviewLine({ ...previewLine, currentIndex })}
            onSave={saveVariation}
            onExportGif={exportPreviewGif}
            onExit={() => setPreviewLine(null)}
          />
        )}

        </div>
        <div data-gif-exclude="true">
        <AlternativeLinesPanel
          alternatives={alternatives}
          mainLineEval={
            liveAnalysis
              ? { scoreCp: liveAnalysis.evalBefore.cp ?? 0, mate: liveAnalysis.evalBefore.mate ?? null }
              : null
          }
          onPinToggle={togglePin}
          onDelete={deleteAlternative}
          onDeleteMove={deleteMove}
          onDeepen={deepenAlternative}
          onEnterVariation={(alt) => setPreviewLine({ alt, currentIndex: 0 })}
          onHoverAlternative={(alt) => setHoveredAltId(alt?.id ?? null)}
          onToggleReveal={toggleReveal}
          onGenerateBestLine={generateBestLine}
          generatingBestLine={generatingBestLine}
          onRefuteLine={refuteLine}
        />
        </div>
      </div>

      {/* ── Right column: Teaching (board-level) · Facts · Engine · Moves ── */}
      </div>
      <div className="play-side-column">
        <div data-gif-crop="true">
        {gifJob.running && previewLine ? (
          <PreviewTeachingCard previewLine={previewLine} />
        ) : (
        <TeachingLog
          log={coachLog}
          title={opponent === 'none' ? 'Teaching' : `Teaching · vs ${opponent === 'cvs' ? 'CVS' : 'Stockfish'}`}
          opening={currentOpening}
          bothSides={opponent === 'none'}
          coachName={opponent === 'cvs' ? 'CVS' : 'Stockfish'}
          thinking={thinking}
          latestPly={history.length - 1}
          focusedId={teachingFocus?.id ?? null}
          scrollRef={coachScrollRef}
          onShow={(event) => {
            setTeachingFocus(event);
            if (event) setFocused(null);
          }}
        />
        )}

        </div>
        <div data-gif-exclude="true">
        <FactsPanel
          fen={fen}
          selected={selected ?? undefined}
          analysis={liveAnalysis ?? undefined}
          move={liveAnalysis?.move}
          focused={focused}
          onFocus={(ins) => setFocused((cur) => (cur === ins ? null : ins))}
        />

        {cvsHealth && (
          <EngineComparisonPanel
            stockfishState={engineReady ? 'ready' : 'off'}
            stockfishAnalysis={liveAnalysis ?? undefined}
            move={liveAnalysis?.move}
            cvsHealth={cvsHealth}
            cvsAnalysis={cvsAnalysis}
            cvsBusy={cvsBusy}
            cvsError={cvsError}
            cvsContext="current board"
            cvsPlayedUci={last?.uci}
          />
        )}

        <PlayCommentaryPanel
          narrationAvailable={!!narrateMove}
          canExplain={!!liveAnalysis}
          explaining={explaining}
          coachText={coachText}
          engineReady={engineReady}
          onExplain={explain}
        />

        <PlayMoveHistory rows={rows} />

        {debug && (
          <PlayDebugOverlay
            ply={history.length}
            turn={turn}
            selected={selected}
            focused={focused}
            fen={fen}
            lastAnalysis={lastAnalysis}
            liveAnalysis={liveAnalysis}
            teachingNodes={teachingNodes}
          />
        )}
        </div>
      </div>
    </div>
  );
}

