import { useState } from 'react';
import { Chess } from 'chess.js';
import type { AlternativeLine, AlternativeLineMove } from './arrow-analysis-store';
import { TeachingNodeCard } from './TeachingNodeCard';

type DiffTone = 'good' | 'bad' | 'warn' | 'muted';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function qualityLabel(m: AlternativeLineMove): string {
  switch (m.moveQuality) {
    case 'forced':
      return 'forced';
    case 'best':
      return 'best';
    case 'best-resistance':
      return 'best resistance';
    case 'equivalent':
      return 'equivalent';
    case 'inaccuracy':
    case 'mistake':
    case 'blunder':
      return m.cpLoss !== undefined ? `-${(m.cpLoss / 100).toFixed(2)} loss` : m.moveQuality;
    default:
      return '';
  }
}

function formatMoveScore(m: AlternativeLineMove): string {
  const label = qualityLabel(m);
  if (m.scoreCp === undefined && m.mate === undefined) return label ? ` (${label})` : '';
  let score = '';
  if (m.mate !== undefined && m.mate !== null) {
    score = `M${m.mate}`;
  } else if (m.scoreCp !== undefined) {
    const val = m.scoreCp / 100;
    const sign = val > 0 ? '+' : '';
    score = `${sign}${val.toFixed(2)}`;
  }
  return ` (${score}${label ? ` - ${label}` : ''})`;
}

function moveScoreTitle(m: AlternativeLineMove): string | undefined {
  if (m.cpLoss === undefined && !m.bestMoveSan) return undefined;
  const parts: string[] = [];
  if (m.bestMoveSan) parts.push(`Best available: ${m.bestMoveSan}`);
  if (m.cpLoss !== undefined) parts.push(`Move loss: ${(m.cpLoss / 100).toFixed(2)} pawns`);
  if (m.legalMoveCount === 1) parts.push('Only legal move');
  return parts.join(' - ');
}

function scoreToneClass(m: AlternativeLineMove): string {
  if (
    m.moveQuality === 'forced' ||
    m.moveQuality === 'best' ||
    m.moveQuality === 'best-resistance' ||
    m.moveQuality === 'equivalent'
  ) {
    return 'alternative-lines__move-score--good';
  }
  if (m.cpLoss !== undefined) {
    if (m.cpLoss <= 50) return 'alternative-lines__move-score--good';
    if (m.cpLoss <= 100) return 'alternative-lines__move-score--warn';
    if (m.cpLoss <= 200) return 'alternative-lines__move-score--mistake';
    return 'alternative-lines__move-score--bad';
  }
  if (m.mate !== undefined && m.mate !== null) {
    return m.mate < 0 ? 'alternative-lines__move-score--bad' : 'alternative-lines__move-score--good';
  }
  if (m.scoreCp === undefined) return 'alternative-lines__move-score--warn';
  if (m.scoreCp >= -50) return 'alternative-lines__move-score--good';
  if (m.scoreCp >= -100) return 'alternative-lines__move-score--warn';
  if (m.scoreCp >= -200) return 'alternative-lines__move-score--mistake';
  return 'alternative-lines__move-score--bad';
}

function moveOriginLabel(alt: AlternativeLine, move: AlternativeLineMove): string {
  const origin = move.origin ?? (alt.source === 'best-line' ? 'engine' : 'player');
  return origin === 'engine' ? 'engine' : 'player';
}

function getPlayerMoveLabel(rootFen: string, idx: number): string {
  const fenParts = rootFen.split(' ');
  const startFullMove = parseInt(fenParts[5], 10) || 1;
  const startTurn = fenParts[1] || 'w';

  if (startTurn === 'w') {
    if (idx % 2 === 0) {
      return `${startFullMove + Math.floor(idx / 2)}.`;
    }
  } else if (idx === 0) {
    return `${startFullMove}...`;
  } else if (idx % 2 === 1) {
    return `${startFullMove + Math.floor((idx + 1) / 2)}.`;
  }
  return '';
}

function getPlyFromFen(fen: string): number {
  const parts = fen.split(' ');
  const turn = parts[1] || 'w';
  const fullmove = parseInt(parts[5], 10) || 1;
  return (fullmove - 1) * 2 + (turn === 'b' ? 1 : 0);
}

function formatPv(startFen: string, pv: string[]): string[] {
  const chess = new Chess(startFen);
  const fenParts = startFen.split(' ');
  let currentFullMove = parseInt(fenParts[5], 10) || 1;
  let turn = fenParts[1];

  const lines: string[] = [];
  let i = 0;

  if (turn === 'b' && i < pv.length) {
    const uci = pv[i];
    const from = uci.substring(0, 2);
    const to = uci.substring(2, 4);
    const promotion = uci.length > 4 ? uci.substring(4, 5) : undefined;
    let san = uci;
    try {
      const m = chess.move({ from, to, promotion });
      if (m) san = m.san;
    } catch {}
    lines.push(`${currentFullMove}... ${san}`);
    currentFullMove++;
    i++;
  }

  while (i < pv.length) {
    const whiteUci = pv[i];
    const fromW = whiteUci.substring(0, 2);
    const toW = whiteUci.substring(2, 4);
    const promotionW = whiteUci.length > 4 ? whiteUci.substring(4, 5) : undefined;
    let whiteSan = whiteUci;
    try {
      const m = chess.move({ from: fromW, to: toW, promotion: promotionW });
      if (m) whiteSan = m.san;
    } catch {}
    i++;

    let blackSan = '';
    if (i < pv.length) {
      const blackUci = pv[i];
      const fromB = blackUci.substring(0, 2);
      const toB = blackUci.substring(2, 4);
      const promotionB = blackUci.length > 4 ? blackUci.substring(4, 5) : undefined;
      blackSan = blackUci;
      try {
        const m = chess.move({ from: fromB, to: toB, promotion: promotionB });
        if (m) blackSan = m.san;
      } catch {}
      i++;
    }

    lines.push(blackSan ? `${currentFullMove} ${whiteSan} ${blackSan}` : `${currentFullMove} ${whiteSan}`);
    currentFullMove++;
  }

  return lines;
}

interface AlternativeLinesPanelProps {
  alternatives: AlternativeLine[];
  mainLineEval?: { scoreCp: number; mate: number | null } | null;
  onPinToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onDeepen: (id: string) => void;
  onEnterVariation?: (alt: AlternativeLine) => void;
  onHoverAlternative?: (alt: AlternativeLine | null) => void;
  onToggleReveal?: (id: string) => void;
  onDeleteMove?: (altId: string, moveIdx: number) => void;
  onGenerateBestLine?: (plies: number) => void;
  generatingBestLine?: boolean;
  onRefuteLine?: (id: string) => void;
}

export function AlternativeLinesPanel({
  alternatives,
  mainLineEval,
  onPinToggle,
  onDelete,
  onDeepen,
  onEnterVariation,
  onHoverAlternative,
  onToggleReveal,
  onDeleteMove,
  onGenerateBestLine,
  generatingBestLine,
  onRefuteLine,
}: AlternativeLinesPanelProps) {
  const [bestLinePlies, setBestLinePlies] = useState(4);
  const hasBestLine = alternatives.some((alt) => alt.source === 'best-line');

  if (alternatives.length === 0 && !onGenerateBestLine) {
    return null;
  }

  const formatScore = (scoreCp: number, mate: number | null) => {
    if (mate !== null) {
      return `M${mate}`;
    }
    return (scoreCp / 100).toFixed(2);
  };

  const getDiffText = (alt: AlternativeLine): { text: string; tone: DiffTone } | null => {
    if (!mainLineEval) return null;

    if (alt.mate !== null || mainLineEval.mate !== null) {
      if (alt.mate !== null && mainLineEval.mate !== null) {
        const diff = alt.mate - mainLineEval.mate;
        if (diff === 0) return { text: 'Equivalent', tone: 'good' };
        return {
          text: diff > 0 ? `+${diff} ply mate` : `${diff} ply mate`,
          tone: diff > 0 ? 'good' : 'bad',
        };
      }
      return { text: 'Evaluation diff unavailable', tone: 'muted' };
    }

    const diff = (alt.scoreCp - mainLineEval.scoreCp) / 100;
    if (Math.abs(diff) < 0.05) {
      return { text: 'Equivalent', tone: 'good' };
    }
    if (diff < 0) {
      return { text: `${diff.toFixed(2)}`, tone: diff < -1.5 ? 'bad' : 'warn' };
    }
    return { text: `+${diff.toFixed(2)}`, tone: 'good' };
  };

  return (
    <div className="alternative-lines">
      <div className="alternative-lines__header">
        <h3 className="alternative-lines__title">Alternative Lines / Variations</h3>
        <span className="alternative-lines__hint">
          Right-drag on board to draw sequential calculation steps
        </span>
      </div>

      {onGenerateBestLine && (
        <div className="alternative-lines__generator">
          <button
            className="alternative-lines__primary-action"
            onClick={() => onGenerateBestLine(bestLinePlies)}
            disabled={generatingBestLine}
          >
            {generatingBestLine
              ? 'Generating...'
              : hasBestLine
                ? 'Generate next best line'
                : 'Generate best line'}
          </button>
          <label className="alternative-lines__range-control">
            <span className="alternative-lines__range-label">
              Line {bestLinePlies} ply{bestLinePlies === 1 ? '' : 's'}
            </span>
            <input
              className="alternative-lines__range"
              type="range"
              min={1}
              max={12}
              step={1}
              value={bestLinePlies}
              onChange={(event) => setBestLinePlies(Number(event.currentTarget.value))}
            />
          </label>
        </div>
      )}

      <div className="alternative-lines__list">
        {alternatives.length === 0 ? (
          <div className="alternative-lines__empty">No variations yet.</div>
        ) : (
          alternatives.map((alt) => {
            const diffInfo = getDiffText(alt);
            const canRefute = alt.moves.some(
              (move) =>
                !!move.bestMoveUci && move.bestMoveUci !== move.uci && (move.cpLoss ?? 0) > 50,
            );
            const endFen = alt.moves.length > 0 ? alt.moves[alt.moves.length - 1].fenAfter : alt.rootFen;
            const pvLines = alt.pv && alt.pv.length > 0 ? formatPv(endFen, alt.pv) : [];

            return (
              <div
                key={alt.id}
                onMouseEnter={() => onHoverAlternative?.(alt)}
                onMouseLeave={() => onHoverAlternative?.(null)}
                className="alternative-lines__card"
              >
                <div className="alternative-lines__card-header">
                  <div className="alternative-lines__move-strip">
                    <span className="alternative-lines__ply">ply {getPlyFromFen(alt.rootFen)}</span>
                    {alt.moves.map((m, idx) => (
                      <span key={idx} className="alternative-lines__move">
                        {getPlayerMoveLabel(alt.rootFen, idx)
                          ? `${getPlayerMoveLabel(alt.rootFen, idx)} `
                          : ''}
                        {m.san}
                        {alt.revealed && (m.scoreCp !== undefined || m.mate !== undefined) && (
                          <span
                            title={moveScoreTitle(m)}
                            className={cx(
                              'alternative-lines__move-score',
                              scoreToneClass(m),
                            )}
                          >
                            {formatMoveScore(m)}
                          </span>
                        )}
                        <span className="alternative-lines__origin">({moveOriginLabel(alt, m)})</span>
                        {onDeleteMove && (
                          <button
                            className="alternative-lines__delete-move"
                            onClick={(event) => {
                              event.stopPropagation();
                              onDeleteMove(alt.id, idx);
                            }}
                            title="Delete this move and subsequent moves"
                          >
                            x
                          </button>
                        )}
                      </span>
                    ))}
                  </div>

                  {alt.isAnalyzing && <span className="alternative-lines__analyzing">Analyzing...</span>}

                  <div className="alternative-lines__actions">
                    <button
                      className={cx(
                        'alternative-lines__button',
                        'alternative-lines__button--pin',
                        alt.pinned && 'is-active',
                      )}
                      onClick={() => onPinToggle(alt.id)}
                    >
                      {alt.pinned ? 'Pinned' : 'Pin'}
                    </button>

                    {onEnterVariation && (
                      <button
                        className="alternative-lines__button alternative-lines__button--preview"
                        onClick={() => onEnterVariation(alt)}
                        disabled={alt.isAnalyzing}
                      >
                        Preview
                      </button>
                    )}

                    {onRefuteLine && (
                      <button
                        className="alternative-lines__button alternative-lines__button--refute"
                        onClick={() => onRefuteLine(alt.id)}
                        disabled={alt.isAnalyzing || !canRefute}
                        title={
                          canRefute
                            ? 'Branch at the first move Stockfish improves on.'
                            : 'No refutation found; the line is best or close to best so far.'
                        }
                      >
                        Refute line
                      </button>
                    )}

                    <button
                      className="alternative-lines__button alternative-lines__button--delete"
                      onClick={() => onDelete(alt.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {alt.revealed ? (
                  <div className="alternative-lines__analysis">
                    <div className="alternative-lines__analysis-row">
                      <span className="alternative-lines__engine-score">
                        Engine Score: {formatScore(alt.scoreCp, alt.mate)}
                      </span>
                      {diffInfo && (
                        <span
                          className={`alternative-lines__diff alternative-lines__diff--${diffInfo.tone}`}
                        >
                          {diffInfo.text}
                        </span>
                      )}

                      <div className="alternative-lines__analysis-actions">
                        <button
                          className="alternative-lines__small-button"
                          onClick={() => onDeepen(alt.id)}
                          disabled={alt.isAnalyzing || alt.depth >= 20}
                        >
                          {alt.depth >= 20 ? 'Max Depth' : 'Deepen'}
                        </button>

                        {onToggleReveal && (
                          <button
                            className="alternative-lines__small-button alternative-lines__small-button--muted"
                            onClick={() => onToggleReveal(alt.id)}
                          >
                            Hide Analysis
                          </button>
                        )}
                      </div>
                    </div>

                    {pvLines.length > 0 && (
                      <div className="alternative-lines__pv">
                        <div className="alternative-lines__pv-title">Engine PV:</div>
                        {pvLines.join('\n')}
                      </div>
                    )}

                    {alt.teachingNodes && alt.teachingNodes.length > 0 && (
                      <div className="alternative-lines__teaching-nodes">
                        {alt.teachingNodes.map((node) => (
                          <TeachingNodeCard key={node.id} node={node} focused={false} />
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="alternative-lines__spoiler">
                    <button
                      className="alternative-lines__reveal"
                      onClick={() => onToggleReveal?.(alt.id)}
                      disabled={alt.isAnalyzing}
                    >
                      Reveal Engine Analysis
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
