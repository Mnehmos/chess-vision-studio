// Play mode — the same perception + coaching suite as the analysis board, but for
// a LIVE game you play (hot-seat). Drag-and-drop OR click-to-move, full legality
// via chess.js, every mode-scoped overlay applied to the live position, a Facts
// inspect card for any square, and — once the engine is loaded — a per-move
// analysis (classification + What-Changed) plus deterministic teaching events
// compiled from Stockfish judgment and Rust facts.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
import { allSquares, computeLedMap, type ModeId } from '../engine/led';
import { MODES, LED_CSS } from './modes';
import { selectionArrows, lineArrows } from './annotate';
import { AnnotationLegend } from './AnnotationLegend';
import { analyzeMoveLive } from '../engine/analyze';
import { sanLineToUci } from '../engine/adapters/uci-line';
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
import { buildTeachingNodes, type TeachingNode, getPositionAfterMove } from '../engine/teaching/node';
import type { InsightCandidate, LedMap, MoveAnalysis, Square } from '../engine/types';
import { useArrowAnalysis, type AlternativeLine, type AlternativeLineMove, getMoveSan, evalColor } from './arrow-analysis-store';
import { AlternativeLinesPanel } from './AlternativeLinesPanel';
import { AnnotationCommandList } from './AnnotationCommandList';
import { analyzeWithStockfish } from './stockfish-client';
import { buildBoardExport, downloadJson } from './exportState';
import { exportElementGif } from './gif-export';
import { PreviewTeachingCard } from './PreviewTeachingCard';
import type { PlyRecord } from '../engine/position';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Engine-opponent search depth (Stockfish; CVS uses its configured depth) and a
// short "thinking" beat so a human can read their own move's teaching before reply.
const OPPONENT_DEPTH = 12;
const OPPONENT_THINK_MS = 500;
type Opponent = 'none' | 'cvs' | 'stockfish';

type VerboseMove = { from: string; to: string; san: string; flags: string; promotion?: string };
type HistEntry = { san: string; fen: string; from: Square; to: Square; uci: string };
const PROMO_PIECES = ['q', 'r', 'n', 'b'] as const;
const PROMO_GLYPH: Record<string, Record<string, string>> = {
  w: { q: '♕', r: '♖', n: '♘', b: '♗' },
  b: { q: '♛', r: '♜', n: '♞', b: '♝' },
};
function legalMovesFrom(fen: string, sq: Square): VerboseMove[] {
  try {
    return new Chess(fen).moves({ square: sq as never, verbose: true }) as unknown as VerboseMove[];
  } catch {
    return [];
  }
}

const TACTIC_TOPICS = new Set(['allowed_fork', 'allowed_pin', 'failed_defense', 'missed_hanging_piece']);

function firstMotifMove(c: { status: string; items?: { moveUci: string }[] }): string | undefined {
  return c.status === 'computed' ? c.items?.[0]?.moveUci : undefined;
}

function appliedFen(fen: string, uci: string | undefined): string | null {
  if (!uci || uci.length < 4) return null;
  try {
    const board = new Chess(fen);
    const moved = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    return moved ? board.fen() : null;
  } catch {
    return null;
  }
}

// The position right after the punishing move a callout names — the move we re-grade.
// Fork/pin: apply the motif move. Failed defense: the refutation is already played.
// Missed hanging: the capture the engine wanted is the best move.
function tacticPositionAfter(event: TeachingEvent, facts: TeachingFactBundleV1): string | null {
  switch (event.topicId) {
    case 'allowed_fork':
      return appliedFen(facts.played.fenAfter, firstMotifMove(facts.played.position.availableMotifs));
    case 'allowed_pin':
      return appliedFen(facts.played.fenAfter, firstMotifMove(facts.played.position.availablePins));
    case 'failed_defense':
      return facts.refutation?.fenAfter ?? null;
    case 'missed_hanging_piece':
      return facts.best?.fenAfter ?? null;
    default:
      return null;
  }
}

// "A fork is exposed" doesn't make it good. Re-grade EVERY exposed tactic against the
// engine: play its punishing move, evaluate, and attach the attacker's score so each
// callout can show confirmed (winning) or refuted (not winning). attackerCp negates
// the eval because the side to move after the punishing move is the victim. Returns
// the teaching unchanged on any failure.
async function validateExposedTactics(
  teaching: TeachingAnalysis | null,
  facts: TeachingFactBundleV1,
  engine: UciEngine,
  depth: number,
): Promise<TeachingAnalysis | null> {
  if (!teaching?.computed) return teaching;
  const events = await Promise.all(
    teaching.events.map(async (event) => {
      if (!TACTIC_TOPICS.has(event.topicId)) return event;
      const fen = tacticPositionAfter(event, facts);
      if (!fen) return event;
      try {
        const ev = await engine.evaluate({ fen, depth });
        if (ev.status === 'unavailable') return event;
        const cp = typeof ev.mate === 'number' ? (ev.mate > 0 ? 100000 : -100000) : (ev.cp ?? 0);
        return { ...event, engineCheck: { attackerCp: -cp, depth } };
      } catch {
        return event;
      }
    }),
  );
  return { ...teaching, events };
}

export interface ReviewMoment {
  id: string;
  ply: number;
  fenBefore: string;
  playedMove: string;
  playedMoveSan: string;
  predictedLine: {
    moves: AlternativeLineMove[];
    scoreCp: number;
    mate: number | null;
    pv: string[];
  };
  insight: string;
  playedScore?: number;
  playedMate?: number | null;
}

export function PlayMode({
  engine,
  engineReady = false,
  narrateMove,
  cvsHealth,
  loadTeachingFacts = getTeachingFacts,
}: {
  engine?: UciEngine | null;
  engineReady?: boolean;
  narrateMove?: (a: MoveAnalysis, features: PlyFeatures) => Promise<string>;
  narrateTeaching?: (event: TeachingEvent) => Promise<string>;
  cvsHealth?: CvsEngineHealth;
  loadTeachingFacts?: (request: TeachingFactsRequestV1) => Promise<TeachingFactBundleV1>;
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
    const plies: PlyRecord[] = history.map((h, i) => {
      const prevEntry = i === 0 ? undefined : history[i - 1];
      const fenBefore = prevEntry ? prevEntry.fen : START_FEN;
      return {
        ply: i + 1,
        moveNumber: Math.floor(i / 2) + 1,
        color: i % 2 === 0 ? 'w' as const : 'b' as const,
        san: h.san,
        from: h.from,
        to: h.to,
        fenBefore,
        fenAfter: h.fen,
      };
    });

    const commentary = new Map<number, string>();
    coachLog.forEach((turn) => {
      if (turn.summary) commentary.set(turn.ply, turn.summary);
    });

    const baseExport = buildBoardExport({
      game: {
        headers: {
          Event: 'CVS Play Mode Game',
          Date: new Date().toISOString().split('T')[0],
          White: playerSide === 'w' ? 'You' : opponent === 'none' ? 'Player 1' : opponent,
          Black: playerSide === 'b' ? 'You' : opponent === 'none' ? 'Player 2' : opponent,
        },
      } as any,
      plies,
      view: history.length,
      fen,
      modeId: mode,
      selected: selected || undefined,
      ledMap: { mode: 'off' as any, squares: {} },
      arrows: [],
      analyses: analysesRef.current,
      commentary,
      annotations: { showThreats, showAllThreats, cascade, followMove },
      exportedAt: new Date().toISOString(),
    });

    downloadJson(
      `cvs-play-game-${Date.now()}.json`,
      {
        ...baseExport,
        reviewMoments,
      }
    );
  };

  const handlePredictionBreak = (
    playedMoveUci: string,
    playedMoveSan: string,
    brokenAlt: AlternativeLine,
    fenBefore: string
  ) => {
    const ply = history.length;
    const momentId = `rev-${Date.now()}-${playedMoveUci}`;
    const newMoment: ReviewMoment = {
      id: momentId,
      ply,
      fenBefore,
      playedMove: playedMoveUci,
      playedMoveSan,
      predictedLine: {
        moves: [...brokenAlt.moves],
        scoreCp: brokenAlt.scoreCp,
        mate: brokenAlt.mate,
        pv: [...brokenAlt.pv],
      },
      insight: `Analyzing break at ply ${ply + 1}...`,
    };

    setReviewMoments((prev) => [...prev, newMoment]);

    // Async analysis of the played move
    const isSf = engineReady;
    const depth = isSf ? 12 : (cvsHealth?.depth ?? 12);
    const analyzePromise = isSf
      ? analyzeWithStockfish(fenBefore, depth, playedMoveUci)
      : analyzeWithCvsEngine(fenBefore, depth, playedMoveUci);

    analyzePromise.then((res) => {
      const mover = new Chess(fenBefore).turn() === 'w' ? 1 : -1;
      const playedScore = res.scoreCp;
      const predictedScore = brokenAlt.scoreCp;
      const diff = (playedScore - predictedScore) * mover / 100;

      let insightText = '';

      const firstPredSan = brokenAlt.moves[0]?.san || playedMoveSan;

      if (diff < -1.5) {
        insightText = `Blunder! You played ${playedMoveSan} but predicted ${firstPredSan}. This dropped the evaluation by ${Math.abs(diff).toFixed(2)} pawns.`;
      } else if (diff < -0.5) {
        insightText = `Mistake. Played ${playedMoveSan} instead of predicted ${firstPredSan}, losing ${Math.abs(diff).toFixed(2)} pawns.`;
      } else if (diff > 0.5) {
        insightText = `Nice find! Played ${playedMoveSan} is better than predicted ${firstPredSan} by ${diff.toFixed(2)} pawns.`;
      } else {
        insightText = `Played ${playedMoveSan} is comparable to your predicted ${firstPredSan} (diff: ${diff.toFixed(2)} pawns).`;
      }

      setReviewMoments((prev) => {
        const updated = prev.map((m) =>
          m.id === momentId
            ? { ...m, insight: insightText, playedScore: res.scoreCp, playedMate: res.mate }
            : m
        );

        setTimeout(() => {
          const plies: PlyRecord[] = history.map((h, i) => {
            const prevEntry = i === 0 ? undefined : history[i - 1];
            const fenBefore = prevEntry ? prevEntry.fen : START_FEN;
            return {
              ply: i + 1,
              moveNumber: Math.floor(i / 2) + 1,
              color: i % 2 === 0 ? 'w' as const : 'b' as const,
              san: h.san,
              from: h.from,
              to: h.to,
              fenBefore,
              fenAfter: h.fen,
            };
          });

          const commentary = new Map<number, string>();
          coachLog.forEach((turn) => {
            if (turn.summary) commentary.set(turn.ply, turn.summary);
          });

          const baseExport = buildBoardExport({
            game: {
              headers: {
                Event: 'CVS Play Mode Game',
                Date: new Date().toISOString().split('T')[0],
                White: playerSide === 'w' ? 'You' : opponent === 'none' ? 'Player 1' : opponent,
                Black: playerSide === 'b' ? 'You' : opponent === 'none' ? 'Player 2' : opponent,
              },
            } as any,
            plies,
            view: history.length,
            fen,
            modeId: mode,
            selected: selected || undefined,
            ledMap: { mode: 'off' as any, squares: {} },
            arrows: [],
            analyses: analysesRef.current,
            commentary,
            annotations: { showThreats, showAllThreats, cascade, followMove },
            exportedAt: new Date().toISOString(),
          });

          downloadJson(
            `cvs-play-game-${Date.now()}.json`,
            {
              ...baseExport,
              reviewMoments: updated,
            }
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
  } = useArrowAnalysis(fen, cvsHealth, engineReady, handlePredictionBreak);

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
    if (!previewLine) return [];
    const out: { fen: string; san?: string }[] = [];
    let currFen = previewLine.alt.rootFen;
    const moves = [...previewLine.alt.moves.map(m => m.uci), ...previewLine.alt.pv];
    for (const move of moves) {
      const resulting = getPositionAfterMove(currFen, move);
      if (!resulting) break;
      const from = move.slice(0, 2) as Square;
      const to = move.slice(2, 4) as Square;
      const promo = move.slice(4) || undefined;
      const san = getMoveSan(currFen, from, to, promo);
      out.push({ fen: resulting, san });
      currFen = resulting;
    }
    return out;
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

  const status = useMemo(() => {
    const c = new Chess(fen);
    const sideToMove = c.turn() === 'w' ? 'White' : 'Black';
    const winner = c.turn() === 'w' ? 'Black' : 'White';
    if (c.isCheckmate()) return { text: `Checkmate — ${winner} wins`, over: true, tone: 'var(--bad)' };
    if (c.isStalemate()) return { text: 'Stalemate — draw', over: true, tone: 'var(--text-soft)' };
    if (c.isInsufficientMaterial()) return { text: 'Draw — insufficient material', over: true, tone: 'var(--text-soft)' };
    if (c.isThreefoldRepetition()) return { text: 'Draw — threefold repetition', over: true, tone: 'var(--text-soft)' };
    if (c.isDraw()) return { text: 'Draw — fifty-move rule', over: true, tone: 'var(--text-soft)' };
    const check = c.inCheck() ? ' — check' : '';
    return { text: `${sideToMove} to move${check}`, over: false, tone: check ? '#b54708' : 'var(--text)' };
  }, [fen]);

  // Whose move it is from the human's seat — true when there's no engine opponent
  // or it's the human's colour to move. Gates manual moves so you can't play the
  // engine's pieces, and tells the opponent effect when to reply.
  const humanToMove = useMemo(
    () => opponent === 'none' || (new Chess(fen).turn() as 'w' | 'b') === playerSide,
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
    if (!previewLine) return [];
    const alt = previewLine.alt;
    const moves = [
      ...alt.moves.map(m => ({ from: m.from, to: m.to, promotion: m.promotion, fenBefore: m.fenBefore, moveData: m })),
      ...alt.pv.map((uci, idx) => {
        const fenBefore = idx === 0
          ? (alt.moves.length > 0 ? alt.moves[alt.moves.length - 1].fenAfter : alt.rootFen)
          : (previewPositions[alt.moves.length + idx - 1]?.fen ?? '');
        return {
          from: uci.slice(0, 2) as Square,
          to: uci.slice(2, 4) as Square,
          promotion: uci.slice(4) || undefined,
          fenBefore,
          moveData: null as AlternativeLineMove | null,
        };
      })
    ];

    const out: Arrow[] = [];
    for (let i = previewLine.currentIndex + 1; i < moves.length; i++) {
      const m = moves[i];
      if (!m || !m.fenBefore) continue;
      const sideToMove = new Chess(m.fenBefore).turn();
      const isEngineMove = i >= alt.moves.length;
      // Only show eval-based colors when analysis is revealed (no spoilers)
      const defaultColor = sideToMove === 'w' ? '#ffffff' : '#1a1a1a';
      const playerColor = (alt.revealed && m.moveData) ? (evalColor(m.moveData) ?? defaultColor) : defaultColor;
      out.push({
        from: m.from,
        to: m.to,
        color: isEngineMove ? '#dd6b20' : playerColor,
        dashed: isEngineMove,
        pulse: i === previewLine.currentIndex + 1,
        promotion: m.promotion,
        label: String(i + 1),
      });
    }
    return out;
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

  const turn = new Chess(fen).turn(); // side to move — drives the turn plates + promo glyphs
  const topSide: 'w' | 'b' = flipped ? 'w' : 'b';
  const bottomSide: 'w' | 'b' = flipped ? 'b' : 'w';
  const rows: { n: number; white?: string; black?: string }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({ n: i / 2 + 1, white: history[i]?.san, black: history[i + 1]?.san });
  }

  return (
    <div className="cvs-workspace">
      {/* ── Left column: controls legend + game review ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }}>
        <AnnotationCommandList />
        {reviewMoments.length > 0 && (
          <div style={{ ...card, padding: '14px', width: '180px', boxSizing: 'border-box' }}>
            <h4
              style={{
                margin: 0,
                fontSize: '13px',
                color: 'var(--accent-light, #d4956a)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderBottom: '1px solid var(--border, #322d28)',
                paddingBottom: '8px',
                marginBottom: '10px'
              }}
            >
              Game Review
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={exportGameData}
                style={{
                  width: '100%',
                  border: '1px solid var(--border, #322d28)',
                  background: 'var(--card2, #211d19)',
                  color: 'var(--accent-light, #d4956a)',
                  borderRadius: 6,
                  padding: '6px 8px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                }}
              >
                ⬇ Export JSON
              </button>
              <div
                style={{
                  maxHeight: '300px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  paddingRight: '4px'
                }}
              >
                {reviewMoments.map((m) => (
                  <div key={m.id} style={{ fontSize: '11px', borderBottom: '1px solid var(--border, #322d28)', paddingBottom: '6px' }}>
                    <div style={{ fontWeight: 'bold', color: 'var(--text)' }}>Ply {m.ply + 1} break:</div>
                    <div style={{ color: 'var(--text-soft)', marginTop: 2, lineHeight: 1.3 }}>{m.insight}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Board + controls ───────────────────────────────────────────── */}
      <div
        ref={gifCaptureRef}
        className="cvs-gif-capture"
      >
        <div style={{ ...card, padding: 12, boxSizing: 'border-box', width: '100%', maxWidth: 480 }}>
        <div data-gif-crop="true">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 10 }}>
          <strong data-testid="play-status" style={{ fontSize: 15, color: status.tone }}>
            {status.text}
          </strong>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={btn} onClick={undo} disabled={!history.length}>
              Undo
            </button>
            <button style={btn} onClick={() => setFlipped((f) => !f)}>
              Flip
            </button>
            <button style={btn} onClick={exportGameData} disabled={!history.length}>
              Export
            </button>
            <button style={primaryBtn} onClick={newGame}>
              New game
            </button>
          </div>
        </div>

        {/* Engine opponent: play vs CVS or Stockfish, or leave off to play both sides. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 2 }}>Opponent</span>
          {(['none', 'cvs', 'stockfish'] as Opponent[]).map((o) => {
            const disabled =
              o === 'cvs' ? !cvsHealth?.available : o === 'stockfish' ? !engineReady : false;
            const label = o === 'none' ? 'Off (both sides)' : o === 'cvs' ? 'CVS' : 'Stockfish';
            return (
              <button
                key={o}
                data-testid={`opponent-${o}`}
                disabled={disabled}
                onClick={() => setOpponent(o)}
                title={
                  disabled
                    ? o === 'cvs'
                      ? 'Rust engine unavailable'
                      : 'Stockfish not loaded'
                    : undefined
                }
                style={o === opponent ? modeBtnActive : disabled ? modeBtnDisabled : modeBtn}
              >
                {label}
              </button>
            );
          })}
          {opponent !== 'none' && (
            <>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8, marginRight: 2 }}>
                You play
              </span>
              {(['w', 'b'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => choosePlayerSide(s)}
                  style={s === playerSide ? modeBtnActive : modeBtn}
                >
                  {s === 'w' ? 'White' : 'Black'}
                </button>
              ))}
              {thinking && (
                <span
                  data-testid="opponent-thinking"
                  style={{ fontSize: 11, color: 'var(--accent)', marginLeft: 6 }}
                >
                  Engine thinking…
                </span>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignItems: 'center', width: '100%' }}>
          {MODES.map((m) => {
            const disabled = !!m.needsAnalysis && !lastAnalysis;
            return (
              <button
                key={m.id}
                disabled={disabled}
                onClick={() => setMode(m.id)}
                title={disabled ? 'Make a move with the engine loaded to populate this' : undefined}
                style={m.id === mode ? modeBtnActive : disabled ? modeBtnDisabled : modeBtn}
              >
                {m.label}
              </button>
            );
          })}
          <button
            onClick={() => setHideOverlays(!hideOverlays)}
            style={{
              ...(hideOverlays ? modeBtnActive : modeBtn),
              marginLeft: 'auto',
            }}
          >
            {hideOverlays ? 'Show Overlays' : 'Hide Overlays'}
          </button>
        </div>

        <TurnPlate color={topSide} active={!status.over && turn === topSide} />

        <div style={{ position: 'relative', width: '100%' }}>
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
          {promo && (
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
              <div style={{ ...card, padding: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-soft)', marginRight: 2 }}>Promote to</span>
                {PROMO_PIECES.map((p) => (
                  <button
                    key={p}
                    aria-label={`promote-${p}`}
                    onClick={() => applyMove(promo.from, promo.to, p)}
                    style={{
                      fontSize: 30,
                      lineHeight: 1,
                      width: 44,
                      height: 44,
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--card)',
                      cursor: 'pointer',
                    }}
                  >
                    {PROMO_GLYPH[turn][p]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <TurnPlate color={bottomSide} active={!status.over && turn === bottomSide} />

        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', margin: '8px 2px 0', fontSize: 12, color: 'var(--text-soft)' }}
        >
          {(MODES.find((m) => m.id === mode)?.legend ?? []).map((l) => (
            <span key={l.color + l.meaning} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 3,
                  background: LED_CSS[l.color],
                  border: '1px solid rgba(0,0,0,0.12)',
                  display: 'inline-block',
                }}
              />
              {l.meaning}
            </span>
          ))}
        </div>
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
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 2px 0' }}>
          Drag a piece or click from → to. Only legal moves are allowed.
          <label style={{ marginLeft: 10, cursor: 'pointer' }} title="dev overlay: artifact identity + eval status">
            <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /> debug
          </label>
        </p>

        {previewLine && (
          <div
            style={{
              ...card,
              padding: '12px',
              marginTop: '12px',
              background: 'rgba(184, 115, 51, 0.08)',
              border: '1.5px solid var(--accent)',
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: 'var(--accent-light)', fontSize: '14px' }}>
                Previewing Variation
              </span>
              <span style={{ fontSize: '12px', color: 'var(--muted)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                Step: {previewLine.currentIndex + 1} / {previewPositions.length}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '4px 6px', flexWrap: 'wrap', fontSize: '13px', color: 'var(--text-soft)' }}>
              {previewPositions.map((pos, idx) => {
                if (!pos.san) return null;
                const active = idx === previewLine.currentIndex;
                return (
                  <span
                    key={idx}
                    onClick={() => setPreviewLine({ ...previewLine, currentIndex: idx })}
                    style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: active ? 700 : 400,
                      background: active ? 'var(--accent)' : 'transparent',
                      color: active ? '#fff' : 'var(--text-soft)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {pos.san}
                  </span>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
              <button
                onClick={() => setPreviewLine({ ...previewLine, currentIndex: 0 })}
                disabled={previewLine.currentIndex === 0}
                style={{ ...btn, width: '40px', padding: '6px 0' }}
              >
                Ref
              </button>
              <button
                onClick={() => setPreviewLine({ ...previewLine, currentIndex: previewLine.currentIndex - 1 })}
                disabled={previewLine.currentIndex === 0}
                style={{ ...btn, width: '40px', padding: '6px 0' }}
              >
                ◀
              </button>
              <button
                onClick={() => setPreviewLine({ ...previewLine, currentIndex: previewLine.currentIndex + 1 })}
                disabled={previewLine.currentIndex === previewPositions.length - 1}
                style={{ ...btn, width: '40px', padding: '6px 0' }}
              >
                ▶
              </button>
              <button
                onClick={() => setPreviewLine({ ...previewLine, currentIndex: previewPositions.length - 1 })}
                disabled={previewLine.currentIndex === previewPositions.length - 1}
                style={{ ...btn, width: '40px', padding: '6px 0' }}
              >
                End
              </button>

              <button
                onClick={saveVariation}
                data-gif-exclude="true"
                style={{
                  ...primaryBtn,
                  background: 'var(--accent)',
                  color: '#fff',
                  marginLeft: 'auto',
                  padding: '6px 12px',
                }}
              >
                Save Variation
              </button>
              <button
                onClick={exportPreviewGif}
                disabled={gifJob.running}
                data-gif-exclude="true"
                style={{ ...btn, padding: '6px 12px' }}
              >
                {gifJob.running ? `GIF ${gifJob.done}/${gifJob.total}` : 'Export GIF'}
              </button>
              <button
                onClick={() => setPreviewLine(null)}
                data-gif-exclude="true"
                style={{ ...btn, padding: '6px 12px' }}
              >
                Exit (Esc)
              </button>
            </div>
          </div>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', minWidth: 300, boxSizing: 'border-box' }}>
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

        <div style={{ ...card, padding: 12 }}>
          <strong style={{ fontSize: 13, color: 'var(--text)' }}>Commentary</strong>
          {narrateMove ? (
            <>
              <button
                style={{ ...btn, marginTop: 10 }}
                onClick={explain}
                disabled={!liveAnalysis || explaining}
              >
                {explaining ? 'Explaining…' : 'Explain this move'}
              </button>
              {coachText && (
                <p
                  style={{
                    fontSize: 13,
                    color: 'var(--text)',
                    marginTop: 8,
                    background: 'var(--track)',
                    padding: 8,
                    borderRadius: 6,
                    lineHeight: 1.5,
                  }}
                >
                  {coachText}
                </p>
              )}
            </>
          ) : (
            engineReady && (
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
                Add an OpenAI key (.env, server-side) for written commentary.
              </p>
            )
          )}
        </div>

        <div style={{ ...card, padding: 12 }}>
          <strong style={{ fontSize: 13, color: 'var(--text)' }}>Moves</strong>
          {rows.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>No moves yet — White to start.</p>
          ) : (
            <ol style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              {rows.map((r) => (
                <li key={r.n} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
                  <span style={{ color: 'var(--muted)', width: 24, textAlign: 'right' }}>{r.n}.</span>
                  <span style={{ width: 64 }}>{r.white}</span>
                  <span style={{ width: 64, color: 'var(--text)' }}>{r.black ?? ''}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {debug && (
          <div
            data-testid="debug-overlay"
            style={{
              ...card,
              padding: 10,
              fontSize: 11,
              fontFamily: 'ui-monospace, monospace',
              color: 'var(--text-soft)',
              wordBreak: 'break-all',
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: 'var(--text)' }}>debug</strong>
            <div>ply: {history.length} · sideToMove: {turn}</div>
            <div>selected: {selected ?? '—'} · focused: {focused ? focused.squares.join(',') : '—'}</div>
            <div>fen: {fen}</div>
            <div>analysis.positionId: {lastAnalysis?.positionId ?? '—'}</div>
            <div>
              positionAfter===fen: {lastAnalysis ? String(lastAnalysis.positionAfter === fen) : '—'} · live:{' '}
              {liveAnalysis ? 'yes' : 'no'}
            </div>
            <div>
              class: {lastAnalysis?.classification ?? '—'} · cpLoss:{' '}
              {lastAnalysis ? lastAnalysis.cpLoss.toFixed(2) : '—'}
            </div>
            <div>
              evalBefore: {lastAnalysis?.evalBefore.status ?? (lastAnalysis ? 'ok' : '—')}
              {lastAnalysis?.evalBefore.reason ? ` (${lastAnalysis.evalBefore.reason})` : ''} · evalAfter:{' '}
              {lastAnalysis?.evalAfter.status ?? (lastAnalysis ? 'ok' : '—')}
              {lastAnalysis?.evalAfter.reason ? ` (${lastAnalysis.evalAfter.reason})` : ''}
            </div>
            <div>teaching events: {teachingNodes ? teachingNodes.length : '—'}</div>
          </div>
        )}
        </div>
      </div>
      </div>
    </div>
  );
}

function teachingRequestForLiveMove(
  fenBefore: string,
  playedMoveUci: string,
  analysis: MoveAnalysis,
): TeachingFactsRequestV1 | null {
  const bestLine = sanLineToUci(fenBefore, analysis.evalBefore.pv);
  const refutationLine = sanLineToUci(analysis.positionAfter, analysis.evalAfter.pv);
  if (analysis.evalBefore.pv.length !== bestLine.length) return null;
  if (analysis.evalAfter.pv.length !== refutationLine.length) return null;
  return {
    schemaVersion: 1,
    fenBefore,
    playedMoveUci,
    ...(bestLine[0] ? { bestMoveUci: bestLine[0] } : {}),
    ...(refutationLine[0] ? { refutationUci: refutationLine[0] } : {}),
    ...(bestLine.length ? { principalVariationUci: bestLine } : {}),
    options: { includeMotifOpportunities: true, includeCounterfactual: true },
  };
}

function teachingNodeArrows(node: TeachingNode): Arrow[] {
  const out: Arrow[] = [];
  const arrow = (uci: string, color: string, extra?: Partial<Arrow>): void => {
    if (uci.length < 4) return;
    out.push({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, color, ...extra });
  };
  arrow(node.subjectMove, ARROW.move, { move: true });

  if (node.boardPayload.arrows) {
    for (const arr of node.boardPayload.arrows) {
      out.push({
        from: arr.from as Square,
        to: arr.to as Square,
        color: arr.color === 'red' ? ARROW.attack : ARROW.defend,
        dashed: arr.style === 'dashed',
      });
    }
  } else {
    if (node.verification.expectedMove) {
      arrow(node.verification.expectedMove, ARROW.attack, { label: '!' });
    }
  }
  return out;
}

function teachingLedMap(node: TeachingNode): LedMap {
  const squares = {} as LedMap['squares'];
  for (const square of allSquares()) squares[square] = 'off';
  if (node.boardPayload.squares) {
    for (const sq of node.boardPayload.squares) {
      squares[sq.square as Square] = sq.color === 'red' ? 'red' : sq.color === 'gray' ? 'off' : 'orange';
    }
  } else {
    for (const square of node.involvedSquares) {
      squares[square as Square] = 'orange';
    }
  }
  return { mode: 'teaching', squares };
}

function TurnPlate({ color, active }: { color: 'w' | 'b'; active: boolean }) {
  return (
    <div
      data-testid={`turn-${color}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 9px',
        margin: '6px 0',
        width: 'max-content',
        borderRadius: 8,
        border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: active ? 'rgba(184,115,51,0.18)' : 'var(--card2)',
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: color === 'w' ? '#fff' : '#111',
          border: '1px solid var(--border)',
          display: 'inline-block',
        }}
      />
      <strong style={{ fontSize: 13, color: 'var(--text)' }}>{color === 'w' ? 'White' : 'Black'}</strong>
      {active && <span style={{ fontSize: 11, color: 'var(--accent-light)', fontWeight: 600 }}>● to move</span>}
    </div>
  );
}

const card: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
};
const btn: CSSProperties = {
  fontSize: 13,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text)',
  cursor: 'pointer',
};
const primaryBtn: CSSProperties = {
  fontSize: 13,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--accent)',
  background: 'var(--accent-light)',
  color: '#fff',
  cursor: 'pointer',
};
const modeBtn: CSSProperties = {
  fontSize: 12,
  padding: '5px 9px',
  borderRadius: 7,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text)',
  cursor: 'pointer',
};
const modeBtnActive: CSSProperties = {
  ...modeBtn,
  border: '1px solid var(--accent)',
  background: 'rgba(184,115,51,0.18)',
  color: 'var(--accent-light)',
  fontWeight: 600,
};
const modeBtnDisabled: CSSProperties = {
  ...modeBtn,
  opacity: 0.45,
  cursor: 'not-allowed',
};

// Always-on legal destinations for the clicked piece, regardless of lens.
function legalDotsFor(fen: string, sq: Square): Square[] | undefined {
  try {
    const c = new Chess(fen);
    const ms = c.moves({ square: sq as never, verbose: true }) as unknown as { to: string }[];
    return ms.length ? (ms.map((m) => m.to) as Square[]) : undefined;
  } catch {
    return undefined;
  }
}
