import { useState } from 'react';
import type { AlternativeLine, AlternativeLineMove } from './arrow-analysis-store';
import { evalColor } from './arrow-analysis-store';
import { TeachingNodeCard } from './TeachingNodeCard';
import { Chess } from 'chess.js';

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
  return ` (${score}${label ? ` · ${label}` : ''})`;
}

function moveScoreTitle(m: AlternativeLineMove): string | undefined {
  if (m.cpLoss === undefined && !m.bestMoveSan) return undefined;
  const parts: string[] = [];
  if (m.bestMoveSan) parts.push(`Best available: ${m.bestMoveSan}`);
  if (m.cpLoss !== undefined) parts.push(`Move loss: ${(m.cpLoss / 100).toFixed(2)} pawns`);
  if (m.legalMoveCount === 1) parts.push('Only legal move');
  return parts.join(' · ');
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
  } else {
    if (idx === 0) {
      return `${startFullMove}...`;
    } else if (idx % 2 === 1) {
      return `${startFullMove + Math.floor((idx + 1) / 2)}.`;
    }
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

    if (blackSan) {
      lines.push(`${currentFullMove} ${whiteSan} ${blackSan}`);
    } else {
      lines.push(`${currentFullMove} ${whiteSan}`);
    }
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

  const getDiffText = (alt: AlternativeLine): { text: string; color: string } | null => {
    if (!mainLineEval) return null;
    
    // Mate comparisons are complex, let's focus on CP comparisons when possible
    if (alt.mate !== null || mainLineEval.mate !== null) {
      if (alt.mate !== null && mainLineEval.mate !== null) {
        const diff = alt.mate - mainLineEval.mate;
        if (diff === 0) return { text: 'Equivalent', color: 'var(--good, #4cae6e)' };
        return {
          text: diff > 0 ? `+${diff} ply mate` : `${diff} ply mate`,
          color: diff > 0 ? 'var(--good, #4cae6e)' : 'var(--bad, #e0635e)',
        };
      }
      return { text: 'Evaluation diff unavailable', color: 'var(--muted)' };
    }

    const diff = (alt.scoreCp - mainLineEval.scoreCp) / 100;
    if (Math.abs(diff) < 0.05) {
      return { text: 'Equivalent', color: 'var(--good, #4cae6e)' };
    }
    if (diff < 0) {
      return { text: `${diff.toFixed(2)}`, color: diff < -1.5 ? 'var(--bad, #e0635e)' : 'var(--warn, #e8923b)' };
    }
    return { text: `+${diff.toFixed(2)}`, color: 'var(--good, #4cae6e)' };
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        marginTop: 16,
        borderTop: '1px solid var(--border, #444)',
        paddingTop: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3
          style={{
            margin: 0,
            fontSize: '14px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontFamily: 'var(--mono)',
            color: 'var(--text-soft)',
          }}
        >
          Alternative Lines / Variations
        </h3>
        <span style={{ fontSize: '11px', color: 'var(--muted)', marginLeft: 'auto' }}>
          Right-drag on board to draw sequential calculation steps
        </span>
      </div>

      {onGenerateBestLine && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            padding: '8px 10px',
            border: '1px solid var(--border, #444)',
            borderRadius: 8,
            background: 'var(--card2, #1f1f1f)',
          }}
        >
          <button
            onClick={() => onGenerateBestLine(bestLinePlies)}
            disabled={generatingBestLine}
            style={{
              fontSize: 12,
              padding: '5px 10px',
              borderRadius: 6,
              background: 'var(--accent, #b87333)',
              color: '#fff',
              border: 'none',
              cursor: generatingBestLine ? 'wait' : 'pointer',
              fontWeight: 700,
            }}
          >
            {generatingBestLine
              ? 'Generating...'
              : hasBestLine
                ? 'Generate next best line'
                : 'Generate best line'}
          </button>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--text-soft)',
              fontSize: 12,
            }}
          >
            <span style={{ minWidth: 72 }}>Line {bestLinePlies} ply{bestLinePlies === 1 ? '' : 's'}</span>
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={bestLinePlies}
              onChange={(event) => setBestLinePlies(Number(event.currentTarget.value))}
              style={{ width: 150 }}
            />
          </label>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {alternatives.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 12, padding: '0 2px' }}>
            No variations yet.
          </div>
        ) : alternatives.map((alt) => {
          const diffInfo = getDiffText(alt);
          const canRefute = alt.moves.some(
            (move) => !!move.bestMoveUci && move.bestMoveUci !== move.uci && (move.cpLoss ?? 0) > 50,
          );
          return (
            <div
              key={alt.id}
              onMouseEnter={() => onHoverAlternative?.(alt)}
              onMouseLeave={() => onHoverAlternative?.(null)}
              style={{
                border: '1px solid var(--border, #444)',
                borderRadius: '8px',
                background: 'var(--card2, #1f1f1f)',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
              className="csvAltCard"
            >
              {/* Header / Info Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      background: 'rgba(212, 149, 106, 0.12)',
                      color: 'var(--accent-light, #d4956a)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      marginRight: 4,
                      fontFamily: 'var(--mono)',
                      userSelect: 'none',
                    }}
                  >
                    ply {getPlyFromFen(alt.rootFen)}
                  </span>
                  {alt.moves.map((m, idx) => (
                    <span
                      key={idx}
                      style={{
                        fontFamily: 'var(--mono)',
                        fontSize: '14px',
                        fontWeight: 700,
                        color: 'var(--accent-light, #d4956a)',
                        background: 'rgba(255,255,255,0.04)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      {getPlayerMoveLabel(alt.rootFen, idx) ? `${getPlayerMoveLabel(alt.rootFen, idx)} ` : ''}{m.san}
                      {alt.revealed && (m.scoreCp !== undefined || m.mate !== undefined) && (
                        <span
                          title={moveScoreTitle(m)}
                          style={{ fontSize: '11px', color: evalColor(m) ?? 'var(--warn, #e8923b)', marginLeft: 2 }}
                        >
                          {formatMoveScore(m)}
                        </span>
                      )}
                      <span style={{ fontSize: '9px', fontWeight: 400, color: 'var(--text-soft)', opacity: 0.7 }}>
                        ({moveOriginLabel(alt, m)})
                      </span>
                      {onDeleteMove && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteMove(alt.id, idx);
                          }}
                          title={`Delete this move and subsequent moves`}
                          style={{
                            border: 'none',
                            background: 'none',
                            color: 'var(--muted, #888)',
                            cursor: 'pointer',
                            fontSize: '13px',
                            padding: '0 2px',
                            marginLeft: '2px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'color 0.15s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bad, #e0635e)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--muted, #888)'; }}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>

                {alt.isAnalyzing && (
                  <span
                    style={{
                      fontSize: '12px',
                      color: 'var(--warn, #e8923b)',
                      fontFamily: 'var(--mono)',
                      animation: 'csvBlink 1s infinite',
                      marginRight: 8,
                    }}
                  >
                    Analyzing...
                  </span>
                )}

                {/* Card Management Controls */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    onClick={() => onPinToggle(alt.id)}
                    style={{
                      fontSize: '12px',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      background: alt.pinned ? 'var(--accent, #b87333)' : 'var(--card, #2a2a2a)',
                      color: alt.pinned ? '#fff' : 'var(--text)',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                    }}
                  >
                    {alt.pinned ? 'Pinned' : 'Pin'}
                  </button>

                  {onEnterVariation && (
                    <button
                      onClick={() => onEnterVariation(alt)}
                      disabled={alt.isAnalyzing}
                      style={{
                        fontSize: '12px',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        background: 'var(--accent-light, #d4956a)',
                        color: '#fff',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      Preview
                    </button>
                  )}

                  {onRefuteLine && (
                    <button
                      onClick={() => onRefuteLine(alt.id)}
                      disabled={alt.isAnalyzing || !canRefute}
                      title={
                        canRefute
                          ? 'Branch at the first move Stockfish improves on.'
                          : 'No refutation found; the line is best or close to best so far.'
                      }
                      style={{
                        fontSize: '12px',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        background: canRefute ? 'var(--card, #2a2a2a)' : 'transparent',
                        color: canRefute ? 'var(--text)' : 'var(--muted)',
                        border: '1px solid var(--border)',
                        cursor: alt.isAnalyzing || !canRefute ? 'default' : 'pointer',
                        opacity: alt.isAnalyzing || !canRefute ? 0.65 : 1,
                      }}
                    >
                      Refute line
                    </button>
                  )}

                  <button
                    onClick={() => onDelete(alt.id)}
                    style={{
                      fontSize: '12px',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      background: 'none',
                      color: 'var(--bad, #e0635e)',
                      border: '1px solid var(--bad, #e0635e)',
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Spoiler / Analysis Section */}
              {alt.revealed ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    borderTop: '1px dashed var(--border, #444)',
                    paddingTop: 8,
                    marginTop: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--text)',
                        fontFamily: 'var(--mono)',
                      }}
                    >
                      Engine Score: {formatScore(alt.scoreCp, alt.mate)}
                    </span>
                    {diffInfo && (
                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: diffInfo.color,
                          fontFamily: 'var(--mono)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: 'rgba(255,255,255,0.05)',
                        }}
                      >
                        {diffInfo.text}
                      </span>
                    )}

                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => onDeepen(alt.id)}
                        disabled={alt.isAnalyzing || alt.depth >= 20}
                        style={{
                          fontSize: '11px',
                          padding: '3px 6px',
                          borderRadius: '4px',
                          background: 'var(--card, #2a2a2a)',
                          color: 'var(--text)',
                          border: '1px solid var(--border)',
                          cursor: alt.isAnalyzing ? 'wait' : 'pointer',
                        }}
                      >
                        {alt.depth >= 20 ? 'Max Depth' : 'Deepen'}
                      </button>

                      {onToggleReveal && (
                        <button
                          onClick={() => onToggleReveal(alt.id)}
                          style={{
                            fontSize: '11px',
                            padding: '3px 6px',
                            borderRadius: '4px',
                            background: 'var(--card, #2a2a2a)',
                            color: 'var(--text-soft)',
                            border: '1px solid var(--border)',
                            cursor: 'pointer',
                          }}
                        >
                          Hide Analysis
                        </button>
                      )}
                    </div>
                  </div>

                  {alt.pv && alt.pv.length > 0 && (() => {
                    const endFen = alt.moves.length > 0 ? alt.moves[alt.moves.length - 1].fenAfter : alt.rootFen;
                    const pvLines = formatPv(endFen, alt.pv);
                    return (
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--text-soft)',
                          fontFamily: 'var(--mono)',
                          padding: '8px 10px',
                          background: 'rgba(0,0,0,0.15)',
                          borderRadius: '4px',
                          whiteSpace: 'pre-line',
                          lineHeight: '1.4',
                        }}
                      >
                        <div style={{ color: 'var(--muted)', marginBottom: '4px', fontWeight: 'bold' }}>Engine PV:</div>
                        {pvLines.join('\n')}
                      </div>
                    );
                  })()}

                  {alt.teachingNodes && alt.teachingNodes.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        marginTop: 4,
                      }}
                    >
                      {alt.teachingNodes.map((node) => (
                        <TeachingNodeCard key={node.id} node={node} focused={false} />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0, 0, 0, 0.25)',
                    borderRadius: '6px',
                    padding: '10px',
                    marginTop: 4,
                    border: '1px dashed rgba(255, 255, 255, 0.05)',
                  }}
                >
                  <button
                    onClick={() => onToggleReveal?.(alt.id)}
                    disabled={alt.isAnalyzing}
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      padding: '6px 14px',
                      borderRadius: '6px',
                      background: 'var(--card, #2a2a2a)',
                      color: 'var(--accent-light, #d4956a)',
                      border: '1px solid var(--border)',
                      cursor: alt.isAnalyzing ? 'not-allowed' : 'pointer',
                      boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                    }}
                  >
                    Reveal Engine Analysis
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
