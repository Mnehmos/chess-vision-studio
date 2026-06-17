import { useState, useEffect, useRef } from 'react';
import type { Square } from '../engine/types';
import type { Arrow } from './BoardArrows';
import type { TeachingNode } from '../engine/teaching/node';
import { buildTeachingNodes, getPositionAfterMove } from '../engine/teaching/node';
import { analyzeWithStockfish } from './stockfish-client';
import { analyzeWithCvsEngine, getTeachingFacts } from './cvs-engine-client';
import { Chess } from 'chess.js';

export interface AlternativeLineMove {
  uci: string;
  san: string;
  origin?: 'player' | 'engine';
  from: Square;
  to: Square;
  promotion?: string;
  fenBefore: string;
  fenAfter: string;
  scoreCp?: number;
  mate?: number | null;
  bestScoreCp?: number;
  bestMate?: number | null;
  bestMoveUci?: string;
  bestMoveSan?: string;
  cpLoss?: number;
  legalMoveCount?: number;
  moveQuality?: 'best' | 'equivalent' | 'forced' | 'best-resistance' | 'inaccuracy' | 'mistake' | 'blunder';
}


export interface AlternativeLine {
  id: string; // Unique ID
  rootFen: string;
  moves: AlternativeLineMove[];
  source?: 'manual' | 'best-line' | 'refutation';
  isAnalyzing: boolean;
  scoreCp: number;
  mate: number | null;
  pv: string[];
  depth: number;
  teachingNodes: TeachingNode[];
  pinned: boolean;
  revealed: boolean; // spoiler mode flag
}

type EngineResult = {
  scoreCp: number;
  mate: number | null;
  pv: string[];
  depth: number;
  bestmove?: string;
  uci?: string | null;
};

export function isMoveLegal(fen: string, from: Square, to: Square, promotion?: string): boolean {
  try {
    const chess = new Chess(fen);
    const moves = chess.moves({ square: from as any, verbose: true }) as any[];
    return moves.some(
      (m) => m.from === from && m.to === to && (!promotion || m.promotion === promotion)
    );
  } catch {
    return false;
  }
}

/**
 * Maps a move's evaluation to a color for arrow visualisation.
 *  - green  (#4cae6e): neutral or positive (cp ≥ −50)
 *  - yellow (#e8923b): inaccuracy (−50 > cp ≥ −100)
 *  - orange (#dd6b20): mistake (−100 > cp ≥ −200)
 *  - red    (#e0635e): blunder (cp < −200 or forced mate)
 *  - null   : no score available → caller falls back to default colour
 */
export function evalColor(m: AlternativeLineMove): string | null {
  if (m.moveQuality === 'forced' || m.moveQuality === 'best' || m.moveQuality === 'best-resistance' || m.moveQuality === 'equivalent') {
    return '#4cae6e';
  }
  if (m.cpLoss !== undefined) {
    if (m.cpLoss <= 50) return '#4cae6e';
    if (m.cpLoss <= 100) return '#e8923b';
    if (m.cpLoss <= 200) return '#dd6b20';
    return '#e0635e';
  }
  if (m.mate !== undefined && m.mate !== null) {
    return m.mate < 0 ? '#e0635e' : '#4cae6e';
  }
  if (m.scoreCp === undefined) return null;
  const cp = m.scoreCp;
  if (cp >= -50) return '#4cae6e';    // good / neutral
  if (cp >= -100) return '#e8923b';   // inaccuracy
  if (cp >= -200) return '#dd6b20';   // mistake
  return '#e0635e';                   // blunder
}

function scoreValue(scoreCp: number, mate: number | null | undefined): number {
  if (mate !== undefined && mate !== null) {
    return mate > 0 ? 100000 - mate : -100000 - mate;
  }
  return scoreCp;
}

function scoreLossCp(best: EngineResult, candidate: EngineResult): number {
  return Math.max(0, scoreValue(best.scoreCp, best.mate) - scoreValue(candidate.scoreCp, candidate.mate));
}

function bestMoveUci(result: EngineResult): string | undefined {
  const raw = result.bestmove ?? result.uci ?? result.pv[0];
  return raw && raw !== '(none)' ? raw : undefined;
}

function legalMoveCount(fen: string): number {
  try {
    return new Chess(fen).moves().length;
  } catch {
    return 0;
  }
}

function classifyAlternativeMove(
  fen: string,
  moveUci: string,
  best: EngineResult,
  candidate: EngineResult,
): Pick<
  AlternativeLineMove,
  | 'bestScoreCp'
  | 'bestMate'
  | 'bestMoveUci'
  | 'bestMoveSan'
  | 'cpLoss'
  | 'legalMoveCount'
  | 'moveQuality'
> {
  const loss = scoreLossCp(best, candidate);
  const bestUci = bestMoveUci(best);
  const count = legalMoveCount(fen);
  const bestValue = scoreValue(best.scoreCp, best.mate);
  const alreadyWorse = bestValue < -150;
  const isBestMove = !!bestUci && moveUci === bestUci;
  let moveQuality: AlternativeLineMove['moveQuality'];

  if (count === 1) moveQuality = 'forced';
  else if (loss <= 20 && isBestMove) moveQuality = alreadyWorse ? 'best-resistance' : 'best';
  else if (loss <= 50) moveQuality = alreadyWorse ? 'best-resistance' : 'equivalent';
  else if (loss <= 100) moveQuality = 'inaccuracy';
  else if (loss <= 200) moveQuality = 'mistake';
  else moveQuality = 'blunder';

  return {
    bestScoreCp: best.scoreCp,
    bestMate: best.mate,
    bestMoveUci: bestUci,
    bestMoveSan: bestUci
      ? getMoveSan(
          fen,
          bestUci.slice(0, 2) as Square,
          bestUci.slice(2, 4) as Square,
          bestUci.slice(4) || undefined,
        )
      : undefined,
    cpLoss: loss,
    legalMoveCount: count,
    moveQuality,
  };
}

/**
 * Compact chess move label from a FEN, e.g. "5." (White) or "5…" (Black).
 */
export function moveLabel(fen: string): string {
  const parts = fen.split(' ');
  const turn = parts[1] || 'w';
  const fullmove = parts[5] || '1';
  return turn === 'w' ? `${fullmove}.` : `${fullmove}…`;
}

export function getMoveUci(from: Square, to: Square, promotion?: string): string {
  return `${from}${to}${promotion || ''}`;
}

export function getMoveSan(fen: string, from: Square, to: Square, promotion?: string): string {
  try {
    const chess = new Chess(fen);
    const m = chess.move({ from, to, promotion });
    return m ? m.san : `${from}-${to}`;
  } catch {
    return `${from}-${to}`;
  }
}

async function getFactsForAlternative(fen: string, moveUci: string, pv: string[]) {
  try {
    return await getTeachingFacts({
      schemaVersion: 1,
      fenBefore: fen,
      playedMoveUci: moveUci,
      bestMoveUci: pv[0],
      refutationUci: pv[1],
      principalVariationUci: pv.length ? pv : undefined,
      options: { includeMotifOpportunities: true, includeCounterfactual: true },
    });
  } catch {
    return null;
  }
}

function arePositionsEqual(fen1: string, fen2: string): boolean {
  const p1 = fen1.trim().split(/\s+/).slice(0, 4).join(' ');
  const p2 = fen2.trim().split(/\s+/).slice(0, 4).join(' ');
  return p1 === p2;
}

function getMoveBetweenFens(fen1: string, fen2: string): { uci: string; san: string } | null {
  try {
    const chess = new Chess(fen1);
    const moves = chess.moves({ verbose: true }) as any[];
    for (const m of moves) {
      const chessTemp = new Chess(fen1);
      chessTemp.move(m);
      if (arePositionsEqual(chessTemp.fen(), fen2)) {
        return { uci: `${m.from}${m.to}${m.promotion || ''}`, san: m.san };
      }
    }
  } catch {}
  return null;
}

export function useArrowAnalysis(
  fen: string,
  cvsHealth: any,
  stockfishReady: boolean,
  onPredictionBreak?: (
    playedMoveUci: string,
    playedMoveSan: string,
    brokenAlt: AlternativeLine,
    fenBefore: string
  ) => void
) {
  // Alternatives list: analyzed variations
  const [alternatives, setAlternatives] = useState<AlternativeLine[]>([]);
  const [activeAltId, setActiveAltId] = useState<string | null>(null);
  const [generatingBestLine, setGeneratingBestLine] = useState(false);

  const activeKeysRef = useRef<Set<string>>(new Set());
  const prevFenRef = useRef(fen);

  const analyzeEngine = async (targetFen: string, depth: number, forcedMove?: string): Promise<EngineResult> => {
    if (stockfishReady) {
      return analyzeWithStockfish(targetFen, depth, forcedMove);
    }
    return analyzeWithCvsEngine(targetFen, depth, forcedMove);
  };

  const evaluateCandidate = async (targetFen: string, moveUci: string, depth: number) => {
    const [best, candidate] = await Promise.all([
      analyzeEngine(targetFen, depth),
      analyzeEngine(targetFen, depth, moveUci),
    ]);
    return {
      best,
      candidate,
      annotation: classifyAlternativeMove(targetFen, moveUci, best, candidate),
    };
  };

  // Keep predictions active when they match the played moves; detect breaks.
  useEffect(() => {
    const prevFen = prevFenRef.current;
    prevFenRef.current = fen;

    if (prevFen === fen) return;

    const playedMove = getMoveBetweenFens(prevFen, fen);
    if (!playedMove) {
      // Unrelated move or jump - reset alternatives
      setAlternatives([]);
      setActiveAltId(null);
      return;
    }

    setAlternatives((prev) => {
      const nextAlts: AlternativeLine[] = [];
      for (const alt of prev) {
        if (alt.rootFen === prevFen && alt.moves.length > 0) {
          const firstMove = alt.moves[0];
          if (firstMove.uci === playedMove.uci) {
            // Move matches prediction! Advance the line.
            nextAlts.push({
              ...alt,
              rootFen: fen,
              moves: alt.moves.slice(1),
              revealed: false, // reset reveal spoiler status
            });
          } else {
            // Move breaks prediction!
            onPredictionBreak?.(playedMove.uci, playedMove.san, alt, prevFen);
          }
        }
      }
      return nextAlts;
    });
  }, [fen, onPredictionBreak]);

  const triggerAnalysis = async (alt: AlternativeLine, targetFen: string) => {
    const movesCount = alt.moves.length;
    if (movesCount === 0) return;
    const latestMove = alt.moves[movesCount - 1];

    const jobKey = `${alt.id}:${movesCount}`;
    activeKeysRef.current.add(jobKey);

    const activeFen = latestMove.fenBefore;
    const moveUci = latestMove.uci;

    try {
      // Stage 1: Fast Preview (depth 6) on the position resulting after all moves
      const preview = await evaluateCandidate(activeFen, moveUci, 6);
      const r1 = preview.candidate;

      if (!activeKeysRef.current.has(jobKey)) return;

      setAlternatives((prev) =>
        prev.map((x) =>
          x.id === alt.id && x.moves.length === movesCount
            ? {
                ...x,
                scoreCp: r1.scoreCp,
                mate: r1.mate,
                pv: r1.pv,
                depth: r1.depth,
                moves: x.moves.map((m, idx) =>
                  idx === movesCount - 1
                    ? { ...m, scoreCp: r1.scoreCp, mate: r1.mate, ...preview.annotation }
                    : m
                ),
              }
            : x
        )
      );

      // Stage 2: Deepening on the position resulting after all moves
      const targetDepth = stockfishReady ? 12 : (cvsHealth?.depth ?? 12);
      const full = await evaluateCandidate(activeFen, moveUci, targetDepth);
      const r2 = full.candidate;

      if (!activeKeysRef.current.has(jobKey)) return;

      const facts = await getFactsForAlternative(activeFen, moveUci, r2.pv);
      let teachingNodes: TeachingNode[] = [];
      if (facts) {
        const nodeReq = {
          rootFen: activeFen,
          subjectMove: moveUci,
          resultingFen: targetFen,
          principalVariation: r2.pv,
          verificationPolicy: {
            tacticalClaims: 'required' as const,
            counterfactualClaims: 'required' as const,
            betterMoveClaims: 'required' as const,
            structuralClaims: 'deterministic-or-engine' as const,
            minimumDepth: targetDepth,
            timeoutMs: 3500,
          },
          facts,
          engine: {
            evaluate: async (params: { fen: string; depth: number }) => {
              const r = await analyzeEngine(params.fen, params.depth);
              return { cp: r.scoreCp, mate: r.mate ?? undefined };
            },
          },
        };
        teachingNodes = await buildTeachingNodes(nodeReq);
      }

      setAlternatives((prev) =>
        prev.map((x) =>
          x.id === alt.id && x.moves.length === movesCount
            ? {
                ...x,
                isAnalyzing: false,
                scoreCp: r2.scoreCp,
                mate: r2.mate,
                pv: r2.pv,
                depth: r2.depth,
                teachingNodes,
                moves: x.moves.map((m, idx) =>
                  idx === movesCount - 1
                    ? { ...m, scoreCp: r2.scoreCp, mate: r2.mate, ...full.annotation }
                    : m
                ),
              }
            : x
        )
      );
    } catch (err) {
      console.error('Alternative line analysis failed:', err);
      if (activeKeysRef.current.has(jobKey)) {
        setAlternatives((prev) =>
          prev.map((x) =>
            x.id === alt.id && x.moves.length === movesCount
              ? { ...x, isAnalyzing: false }
              : x
          )
        );
      }
    } finally {
      activeKeysRef.current.delete(jobKey);
    }
  };


  const handleArrowDrawn = async (from: Square, to: Square, promotion?: string) => {
    let activeAlt = alternatives.find((x) => x.id === activeAltId);
    if (!activeAlt) {
      activeAlt = alternatives.find((x) => !x.pinned);
    }

    // Toggle / Deletion check: if drawing an arrow that matches an existing move in the chain
    if (activeAlt) {
      const matchIdx = activeAlt.moves.findIndex(
        (m) =>
          m.from === from &&
          m.to === to &&
          m.promotion === promotion
      );
      if (matchIdx !== -1) {
        const newMoves = activeAlt.moves.slice(0, matchIdx);
        if (newMoves.length === 0) {
          setAlternatives((prev) => prev.filter((x) => x.id !== activeAlt!.id));
          setActiveAltId(null);
        } else {
          const lastMove = newMoves[newMoves.length - 1];
          const updatedAlt: AlternativeLine = {
            ...activeAlt,
            moves: newMoves,
            isAnalyzing: true,
            revealed: false, // reset spoiler status on mutation
          };
          setAlternatives((prev) =>
            prev.map((x) => (x.id === activeAlt!.id ? updatedAlt : x))
          );
          triggerAnalysis(updatedAlt, lastMove.fenAfter);
        }
        return;
      }
    }

    // Appending or branching logic
    const activeFen = activeAlt
      ? (activeAlt.moves.length > 0
          ? activeAlt.moves[activeAlt.moves.length - 1].fenAfter
          : activeAlt.rootFen)
      : fen;

    const moveUci = getMoveUci(from, to, promotion);

    // Try appending to the active variation
    if (isMoveLegal(activeFen, from, to, promotion)) {
      const fenAfter = getPositionAfterMove(activeFen, moveUci)!;
      const san = getMoveSan(activeFen, from, to, promotion);
      const newMove: AlternativeLineMove = {
        uci: moveUci,
        san,
        origin: 'player',
        from,
        to,
        promotion,
        fenBefore: activeFen,
        fenAfter,
      };

      if (activeAlt && (activeAlt.moves.length > 0 ? activeAlt.moves[activeAlt.moves.length - 1].fenAfter : activeAlt.rootFen) === activeFen) {
        const updatedAlt: AlternativeLine = {
          ...activeAlt,
          moves: [...activeAlt.moves, newMove],
          isAnalyzing: true,
          revealed: false, // reset spoiler mode
        };
        setAlternatives((prev) =>
          prev.map((x) => (x.id === activeAlt!.id ? updatedAlt : x))
        );
        triggerAnalysis(updatedAlt, fenAfter);
      } else {
        // Fallback: Start a new variation line (overwrite existing unpinned)
        const id = `var-${fen}:${moveUci}-${Date.now()}`;
        const newAlt: AlternativeLine = {
          id,
          rootFen: fen,
          moves: [newMove],
          source: 'manual',
          isAnalyzing: true,
          scoreCp: 0,
          mate: null,
          pv: [],
          depth: 0,
          teachingNodes: [],
          pinned: false,
          revealed: false,
        };
        setAlternatives((prev) => [
          ...prev.filter((x) => x.pinned),
          newAlt,
        ]);
        setActiveAltId(id);
        triggerAnalysis(newAlt, fenAfter);
      }
    } else {
      // Check if starting a different branch from root FEN
      if (isMoveLegal(fen, from, to, promotion)) {
        const fenAfter = getPositionAfterMove(fen, moveUci)!;
        const san = getMoveSan(fen, from, to, promotion);
        const newMove: AlternativeLineMove = {
          uci: moveUci,
          san,
          origin: 'player',
          from,
          to,
          promotion,
          fenBefore: fen,
          fenAfter,
        };
        const id = `var-${fen}:${moveUci}-${Date.now()}`;
        const newAlt: AlternativeLine = {
          id,
          rootFen: fen,
          moves: [newMove],
          source: 'manual',
          isAnalyzing: true,
          scoreCp: 0,
          mate: null,
          pv: [],
          depth: 0,
          teachingNodes: [],
          pinned: false,
          revealed: false,
        };
        setAlternatives((prev) => [
          ...prev.filter((x) => x.pinned),
          newAlt,
        ]);
        setActiveAltId(id);
        triggerAnalysis(newAlt, fenAfter);
      }
    }
  };

  const deleteMove = (altId: string, moveIdx: number) => {
    setAlternatives((prev) => {
      const updated = prev.map((alt) => {
        if (alt.id !== altId) return alt;
        const newMoves = alt.moves.slice(0, moveIdx);
        if (newMoves.length === 0) {
          return null as any;
        }
        const lastMove = newMoves[newMoves.length - 1];
        const updatedAlt: AlternativeLine = {
          ...alt,
          moves: newMoves,
          isAnalyzing: true,
          revealed: false,
        };
        triggerAnalysis(updatedAlt, lastMove.fenAfter);
        return updatedAlt;
      }).filter(Boolean) as AlternativeLine[];

      if (activeAltId === altId && !updated.some((x) => x.id === altId)) {
        setActiveAltId(null);
      }
      return updated;
    });
  };

  const togglePin = (id: string) => {
    setAlternatives(prev => prev.map(x => x.id === id ? { ...x, pinned: !x.pinned } : x));
  };

  const deleteAlternative = (id: string) => {
    setAlternatives(prev => prev.filter(x => x.id !== id));
    if (activeAltId === id) {
      setActiveAltId(null);
    }
  };

  const toggleReveal = (id: string) => {
    setAlternatives(prev => prev.map(x => x.id === id ? { ...x, revealed: !x.revealed } : x));
  };

  const deepenAlternative = async (id: string) => {
    const alt = alternatives.find(x => x.id === id);
    if (!alt || alt.moves.length === 0) return;

    const movesCount = alt.moves.length;
    const latestMove = alt.moves[movesCount - 1];
    const targetFen = latestMove.fenAfter;
    const activeFen = latestMove.fenBefore;
    const uci = latestMove.uci;

    const jobKey = `${id}:deep:${movesCount}`;
    activeKeysRef.current.add(jobKey);

    setAlternatives(prev => prev.map(x => x.id === id ? { ...x, isAnalyzing: true } : x));

    try {
      const deepDepth = stockfishReady ? 20 : Math.min(20, (cvsHealth?.depth ?? 12) + 4);
      const full = await evaluateCandidate(activeFen, uci, deepDepth);
      const r = full.candidate;

      if (!activeKeysRef.current.has(jobKey)) return;

      const facts = await getFactsForAlternative(activeFen, uci, r.pv);
      let teachingNodes: TeachingNode[] = [];
      if (facts) {
        const nodeReq = {
          rootFen: activeFen,
          subjectMove: uci,
          resultingFen: targetFen,
          principalVariation: r.pv,
          verificationPolicy: {
            tacticalClaims: 'required' as const,
            counterfactualClaims: 'required' as const,
            betterMoveClaims: 'required' as const,
            structuralClaims: 'deterministic-or-engine' as const,
            minimumDepth: deepDepth,
            timeoutMs: 5000,
          },
          facts,
          engine: {
            evaluate: async (params: { fen: string; depth: number }) => {
              const r = await analyzeEngine(params.fen, params.depth);
              return { cp: r.scoreCp, mate: r.mate ?? undefined };
            },
          },
        };
        teachingNodes = await buildTeachingNodes(nodeReq);
      }

      setAlternatives(prev => prev.map(x => x.id === id && x.moves.length === movesCount ? {
        ...x,
        isAnalyzing: false,
        scoreCp: r.scoreCp,
        mate: r.mate,
        pv: r.pv,
        depth: r.depth,
        teachingNodes,
        moves: x.moves.map((m, idx) =>
          idx === movesCount - 1
            ? { ...m, scoreCp: r.scoreCp, mate: r.mate, ...full.annotation }
            : m
        ),
      } : x));
    } catch (err) {
      console.error('Deepen analysis failed:', err);
      setAlternatives(prev => prev.map(x => x.id === id && x.moves.length === movesCount ? { ...x, isAnalyzing: false } : x));
    } finally {
      activeKeysRef.current.delete(jobKey);
    }
  };

  const generateBestLine = async (requestedPlies: number) => {
    const linePlies = Math.max(1, Math.min(12, Math.round(requestedPlies)));
    const existing = alternatives.find((x) => x.id === activeAltId && x.source === 'best-line')
      ?? alternatives.find((x) => x.source === 'best-line' && !x.pinned);
    const id = existing?.id ?? `best-${fen}-${Date.now()}`;
    const jobKey = `${id}:best-line`;
    const depth = stockfishReady ? 12 : (cvsHealth?.depth ?? 12);
    activeKeysRef.current.add(jobKey);
    setGeneratingBestLine(true);
    setActiveAltId(id);
    if (existing) {
      setAlternatives((prev) => prev.map((x) => (x.id === id ? { ...x, isAnalyzing: true, revealed: true } : x)));
    } else {
      setAlternatives((prev) => [
        ...prev.filter((x) => x.pinned),
        {
          id,
          rootFen: fen,
          moves: [],
          source: 'best-line',
          isAnalyzing: true,
          scoreCp: 0,
          mate: null,
          pv: [],
          depth: 0,
          teachingNodes: [],
          pinned: false,
          revealed: true,
        },
      ]);
    }

    try {
      const moves: AlternativeLineMove[] = existing?.moves.map((move) => ({ ...move })) ?? [];
      let currentFen = moves.length ? moves[moves.length - 1]!.fenAfter : fen;
      let rootBest: EngineResult | null = existing
        ? { scoreCp: existing.scoreCp, mate: existing.mate, pv: existing.pv, depth: existing.depth }
        : null;

      for (let i = 0; i < linePlies; i += 1) {
        if (!activeKeysRef.current.has(jobKey) || legalMoveCount(currentFen) === 0) break;

        const best = await analyzeEngine(currentFen, depth);
        if (!activeKeysRef.current.has(jobKey)) return;
        if (!rootBest) rootBest = best;

        const moveUci = bestMoveUci(best);
        if (!moveUci) break;

        const from = moveUci.slice(0, 2) as Square;
        const to = moveUci.slice(2, 4) as Square;
        const promotion = moveUci.slice(4) || undefined;
        if (!isMoveLegal(currentFen, from, to, promotion)) break;

        const fenAfter = getPositionAfterMove(currentFen, moveUci);
        if (!fenAfter) break;

        moves.push({
          uci: moveUci,
          san: getMoveSan(currentFen, from, to, promotion),
          origin: 'engine',
          from,
          to,
          promotion,
          fenBefore: currentFen,
          fenAfter,
          scoreCp: best.scoreCp,
          mate: best.mate,
          ...classifyAlternativeMove(currentFen, moveUci, best, best),
        });
        currentFen = fenAfter;

        setAlternatives((prev) =>
          prev.map((x) =>
            x.id === id
              ? {
                  ...x,
                  moves: [...moves],
                  scoreCp: rootBest?.scoreCp ?? best.scoreCp,
                  mate: rootBest?.mate ?? best.mate,
                  depth: best.depth,
                }
              : x,
          ),
        );
      }

      setAlternatives((prev) =>
        prev.map((x) =>
          x.id === id
            ? {
                ...x,
                isAnalyzing: false,
                scoreCp: rootBest?.scoreCp ?? x.scoreCp,
                mate: rootBest?.mate ?? x.mate,
                depth: rootBest?.depth ?? x.depth,
              }
            : x,
        ),
      );
    } catch (err) {
      console.error('Best line generation failed:', err);
      setAlternatives((prev) =>
        prev.map((x) => (x.id === id ? { ...x, isAnalyzing: false } : x)),
      );
    } finally {
      activeKeysRef.current.delete(jobKey);
      setGeneratingBestLine(false);
    }
  };

  const refuteLine = async (id: string) => {
    const alt = alternatives.find((x) => x.id === id);
    if (!alt) return;
    const refuteIdx = alt.moves.findIndex(
      (move) => !!move.bestMoveUci && move.bestMoveUci !== move.uci && (move.cpLoss ?? 0) > 50,
    );
    if (refuteIdx < 0) return;

    const refuted = alt.moves[refuteIdx];
    const firstUci = refuted.bestMoveUci;
    if (!firstUci) return;

    const newId = `refute-${id}-${Date.now()}`;
    const jobKey = `${newId}:refute-line`;
    const depth = stockfishReady ? 12 : (cvsHealth?.depth ?? 12);
    const targetLength = Math.max(alt.moves.length, refuteIdx + 4);
    const moves = alt.moves.slice(0, refuteIdx).map((move) => ({ ...move }));
    activeKeysRef.current.add(jobKey);
    setActiveAltId(newId);
    setAlternatives((prev) => [
      ...prev,
      {
        id: newId,
        rootFen: alt.rootFen,
        moves,
        source: 'refutation',
        isAnalyzing: true,
        scoreCp: alt.scoreCp,
        mate: alt.mate,
        pv: [],
        depth: alt.depth,
        teachingNodes: [],
        pinned: false,
        revealed: true,
      },
    ]);

    try {
      let currentFen = refuted.fenBefore;
      let nextUci: string | undefined = firstUci;

      while (moves.length < targetLength && nextUci && activeKeysRef.current.has(jobKey)) {
        const best = await analyzeEngine(currentFen, depth);
        if (!activeKeysRef.current.has(jobKey)) return;

        const candidate =
          nextUci === bestMoveUci(best) ? best : await analyzeEngine(currentFen, depth, nextUci);
        if (!activeKeysRef.current.has(jobKey)) return;

        const from = nextUci.slice(0, 2) as Square;
        const to = nextUci.slice(2, 4) as Square;
        const promotion = nextUci.slice(4) || undefined;
        if (!isMoveLegal(currentFen, from, to, promotion)) break;

        const fenAfter = getPositionAfterMove(currentFen, nextUci);
        if (!fenAfter) break;

        moves.push({
          uci: nextUci,
          san: getMoveSan(currentFen, from, to, promotion),
          origin: 'engine',
          from,
          to,
          promotion,
          fenBefore: currentFen,
          fenAfter,
          scoreCp: candidate.scoreCp,
          mate: candidate.mate,
          ...classifyAlternativeMove(currentFen, nextUci, best, candidate),
        });

        currentFen = fenAfter;
        setAlternatives((prev) =>
          prev.map((x) =>
            x.id === newId
              ? {
                  ...x,
                  moves: [...moves],
                  scoreCp: candidate.scoreCp,
                  mate: candidate.mate,
                  depth: candidate.depth,
                }
              : x,
          ),
        );

        if (legalMoveCount(currentFen) === 0) break;
        const nextBest = await analyzeEngine(currentFen, depth);
        if (!activeKeysRef.current.has(jobKey)) return;
        nextUci = bestMoveUci(nextBest);
      }

      setAlternatives((prev) =>
        prev.map((x) => (x.id === newId ? { ...x, isAnalyzing: false } : x)),
      );
    } catch (err) {
      console.error('Refute line generation failed:', err);
      setAlternatives((prev) =>
        prev.map((x) => (x.id === newId ? { ...x, isAnalyzing: false } : x)),
      );
    } finally {
      activeKeysRef.current.delete(jobKey);
    }
  };

  // Maps stored moves of the active/previewed variation to BoardArrows compatible layout
  const activeAlt = alternatives.find(x => x.id === activeAltId) || alternatives.find(x => !x.pinned);
  
  const mappedArrows: Arrow[] = activeAlt ? activeAlt.moves.map((m, idx) => {
    const sideToMove = new Chess(m.fenBefore).turn();
    const isLastMove = idx === activeAlt.moves.length - 1;
    const defaultColor = sideToMove === 'w' ? '#ffffff' : '#1a1a1a';
    return {
      from: m.from,
      to: m.to,
      // Only show eval colors when analysis is revealed; otherwise white/black by side.
      color: activeAlt.revealed ? (evalColor(m) ?? defaultColor) : defaultColor,
      dashed: false,
      pulse: isLastMove && activeAlt.isAnalyzing,
      deletable: true,
      promotion: m.promotion,
      label: String(idx + 1),
    };
  }) : [];

  return {
    arrows: mappedArrows,
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
    activeAltId,
    setActiveAltId,
  };
}
