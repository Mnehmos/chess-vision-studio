// 2D board — renders the FEN with the active mode's LedMap as a scoped overlay.
// Click-to-select is always on (onSelect). Optional drag-and-drop (draggable +
// onPieceDrop) and board orientation are opt-in; the analysis view passes neither
// and is unaffected.
import { parseFen } from '../engine/board';
import type { LedMap, Square } from '../engine/types';
import { LED_CSS } from './modes';
import { BoardArrows, type Arrow } from './BoardArrows';
import { useState } from 'react';

const GLYPH: Record<string, string> = {
  wP: '♙',
  wN: '♘',
  wB: '♗',
  wR: '♖',
  wQ: '♕',
  wK: '♔',
  bP: '♟',
  bN: '♞',
  bB: '♝',
  bR: '♜',
  bQ: '♛',
  bK: '♚',
};

const LIGHT = '#ebe6d6';
const DARK = '#9b8b6b';

export function Board2D({
  legalDots,
  fen,
  ledMap,
  selected,
  onSelect,
  arrows = [],
  orientation = 'white',
  draggable = false,
  onPieceDrop,
  onArrowDrawn,
  onArrowRightClick,
  squareSizeCss,
}: {
  legalDots?: Square[];
  fen: string;
  ledMap: LedMap;
  selected?: Square;
  onSelect: (sq: Square) => void;
  arrows?: Arrow[];
  orientation?: 'white' | 'black';
  draggable?: boolean;
  onPieceDrop?: (from: Square, to: Square) => void;
  onArrowDrawn?: (from: Square, to: Square, promotion?: string) => void;
  onArrowRightClick?: (from: Square, to: Square, promotion?: string) => void;
  squareSizeCss?: string;
}) {
  const board = parseFen(fen);
  // rank 8 at top for white; flipped for black.
  const ranks = orientation === 'white' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const files = orientation === 'white' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const leftFile = files[0];
  const bottomRank = ranks[ranks.length - 1];
  const dragOn = draggable && !!onPieceDrop;

  const [gesture, setGesture] = useState<{ from: Square; to: Square } | null>(null);
  const [promotionPending, setPromotionPending] = useState<{ from: Square; to: Square } | null>(null);

  const isPromotion = (from: Square, to: Square) => {
    const fromF = from.charCodeAt(0) - 97;
    const fromR = from.charCodeAt(1) - 49;
    const piece = board.grid[fromF]?.[fromR];
    if (!piece || piece.type.toLowerCase() !== 'p') return false;
    const targetRank = to.charCodeAt(1) - 49;
    return (piece.color === 'w' && targetRank === 7) || (piece.color === 'b' && targetRank === 0);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 2) {
      // Right click drag
      e.preventDefault();
      const sqEl = (e.target as HTMLElement).closest('[data-square]');
      const fromSq = sqEl?.getAttribute('data-square') as Square | null;
      if (fromSq) {
        setGesture({ from: fromSq, to: fromSq });
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch (err) {
          // ignore JSDOM / pointer capture unsupported errors gracefully
        }
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gesture) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const toSq = el?.closest('[data-square]')?.getAttribute('data-square') as Square | null;
      if (toSq && toSq !== gesture.to) {
        setGesture({ ...gesture, to: toSq });
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gesture) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {
        // ignore JSDOM / pointer capture unsupported errors gracefully
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const toSq = el?.closest('[data-square]')?.getAttribute('data-square') as Square | null;
      const finalTo = toSq || gesture.to;
      if (finalTo && finalTo !== gesture.from) {
        if (isPromotion(gesture.from, finalTo)) {
          setPromotionPending({ from: gesture.from, to: finalTo });
        } else {
          onArrowDrawn?.(gesture.from, finalTo);
        }
      }
      setGesture(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleSelect = (sq: Square) => {
    if (promotionPending) {
      setPromotionPending(null);
      return;
    }
    onSelect(sq);
  };

  const mergedArrows = [...arrows];
  if (gesture && gesture.from !== gesture.to) {
    mergedArrows.push({
      from: gesture.from,
      to: gesture.to,
      color: '#dd6b20', // tactical orange for gestured arrow
      dashed: true,
    });
  }

  let promoCol = 0;
  let promoRow = 0;
  let promoColor = 'w';
  if (promotionPending) {
    const toSq = promotionPending.to;
    const f = toSq.charCodeAt(0) - 97;
    const r = toSq.charCodeAt(1) - 49;
    promoCol = orientation === 'white' ? f : 7 - f;
    promoRow = orientation === 'white' ? 7 - r : r;

    const fromSq = promotionPending.from;
    const fromF = fromSq.charCodeAt(0) - 97;
    const fromR = fromSq.charCodeAt(1) - 49;
    promoColor = board.grid[fromF]?.[fromR]?.color ?? 'w';
  }

  const promoStyle: React.CSSProperties = {
    position: 'absolute',
    left: `calc(var(--cvs-sq) * ${promoCol})`,
    width: 'var(--cvs-sq)',
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--card, #2a2a2a)',
    border: '1px solid var(--border, #444)',
    borderRadius: '4px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    overflow: 'hidden',
  };
  if (promoRow > 4) {
    promoStyle.bottom = `calc(var(--cvs-sq) * ${7 - promoRow})`;
  } else {
    promoStyle.top = `calc(var(--cvs-sq) * ${promoRow})`;
  }

  return (
    <div
      style={{
        position: 'relative',
        // Responsive square size: caps at 56px on desktop, shrinks to fit
        // narrow/phone viewports (single-column layout below 820px). All
        // square-relative sizing reads from this one variable.
        ['--cvs-sq' as string]:
          squareSizeCss ?? 'clamp(34px, calc((100vw - 40px) / 8), 56px)',
        width: 'calc(var(--cvs-sq) * 8)',
        maxWidth: '100%',
      }}
    >
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleContextMenu}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, var(--cvs-sq))',
          gridTemplateRows: 'repeat(8, var(--cvs-sq))',
          border: '2px solid #333',
          width: 'calc(var(--cvs-sq) * 8)',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
      {ranks.map((r) =>
        files.map((f) => {
          const sq = (String.fromCharCode(97 + f) + String.fromCharCode(49 + r)) as Square;
          const piece = board.grid[f][r];
          const base = (f + r) % 2 === 0 ? DARK : LIGHT;
          const led = ledMap.squares[sq] ?? 'off';
          const isSel = selected === sq;
          return (
            <div
              key={sq}
              data-square={sq}
              data-led={led}
              data-piece={piece ? piece.color + piece.type.toUpperCase() : ''}
              onClick={() => handleSelect(sq)}
              onDragOver={dragOn ? (e) => e.preventDefault() : undefined}
              onDrop={
                dragOn
                  ? (e) => {
                      e.preventDefault();
                      const from = e.dataTransfer.getData('text/plain') as Square;
                      if (from && from !== sq) onPieceDrop!(from, sq);
                    }
                  : undefined
              }
              style={{
                position: 'relative',
                background: base,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'calc(var(--cvs-sq) * 0.68)',
                cursor: 'pointer',
                color: piece?.color === 'w' ? '#fff' : '#111',
                textShadow: piece?.color === 'w' ? '0 0 2px #000' : 'none',
                boxShadow: isSel ? 'inset 0 0 0 3px #16a' : undefined,
              }}
            >
              {legalDots?.includes(sq) && (
                <span
                  style={{
                    position: 'absolute',
                    width: piece ? '92%' : '42%',
                    height: piece ? '92%' : '42%',
                    borderRadius: '50%',
                    border: piece ? '4px solid rgba(216,138,63,0.95)' : 'none',
                    background: piece ? 'transparent' : 'rgba(216,138,63,0.85)',
                    boxShadow: '0 0 7px 1px rgba(216,138,63,0.7)',
                    pointerEvents: 'none',
                  }}
                />
              )}
              {led !== 'off' && (
                <span
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: LED_CSS[led],
                    opacity: 0.42,
                    animation: led === 'red_blink' ? 'csvBlink 0.8s steps(2, start) infinite' : undefined,
                    pointerEvents: 'none',
                  }}
                />
              )}
              {f === leftFile && (
                <span style={{ position: 'absolute', left: 2, top: 1, fontSize: 10, color: '#333' }}>
                  {r + 1}
                </span>
              )}
              {r === bottomRank && (
                <span style={{ position: 'absolute', right: 2, bottom: 0, fontSize: 10, color: '#333' }}>
                  {String.fromCharCode(97 + f)}
                </span>
              )}
              {piece && (
                <span
                  draggable={dragOn || undefined}
                  onDragStart={
                    dragOn
                      ? (e) => {
                          e.dataTransfer.setData('text/plain', sq);
                          e.dataTransfer.effectAllowed = 'move';
                          onSelect(sq);
                        }
                      : undefined
                  }
                  style={{ position: 'relative', cursor: dragOn ? 'grab' : 'pointer' }}
                >
                  {GLYPH[piece.color + piece.type.toUpperCase()]}
                </span>
              )}
            </div>
          );
        }),
      )}
      </div>
      {promotionPending && (
        <div style={promoStyle}>
          {['q', 'r', 'b', 'n'].map((piece) => {
            const pieceCode = promoColor + piece.toUpperCase();
            return (
              <button
                key={piece}
                onClick={() => {
                  onArrowDrawn?.(promotionPending.from, promotionPending.to, piece);
                  setPromotionPending(null);
                }}
                style={{
                  width: '100%',
                  height: 'calc(var(--cvs-sq) * 0.8)',
                  background: 'none',
                  border: 'none',
                  color: promoColor === 'w' ? '#fff' : '#111',
                  textShadow: promoColor === 'w' ? '0 0 2px #000' : 'none',
                  fontSize: 'calc(var(--cvs-sq) * 0.55)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {GLYPH[pieceCode]}
              </button>
            );
          })}
        </div>
      )}
      <BoardArrows arrows={mergedArrows} orientation={orientation} onArrowRightClick={onArrowRightClick} />
    </div>
  );
}
