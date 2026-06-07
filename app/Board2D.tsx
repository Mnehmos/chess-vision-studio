// 2D board — renders the FEN with the active mode's LedMap as a scoped overlay.
// Click-to-select is always on (onSelect). Optional drag-and-drop (draggable +
// onPieceDrop) and board orientation are opt-in; the analysis view passes neither
// and is unaffected.
import { parseFen } from '../engine/board';
import type { LedMap, Square } from '../engine/types';
import { LED_CSS } from './modes';
import { BoardArrows, type Arrow } from './BoardArrows';

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
  fen,
  ledMap,
  selected,
  onSelect,
  arrows = [],
  orientation = 'white',
  draggable = false,
  onPieceDrop,
}: {
  fen: string;
  ledMap: LedMap;
  selected?: Square;
  onSelect: (sq: Square) => void;
  arrows?: Arrow[];
  orientation?: 'white' | 'black';
  draggable?: boolean;
  onPieceDrop?: (from: Square, to: Square) => void;
}) {
  const board = parseFen(fen);
  // rank 8 at top for white; flipped for black.
  const ranks = orientation === 'white' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const files = orientation === 'white' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const leftFile = files[0];
  const bottomRank = ranks[ranks.length - 1];
  const dragOn = draggable && !!onPieceDrop;

  return (
    <div style={{ position: 'relative', width: 'max-content' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 56px)',
          gridTemplateRows: 'repeat(8, 56px)',
          border: '2px solid #333',
          width: 'max-content',
          userSelect: 'none',
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
              onClick={() => onSelect(sq)}
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
                fontSize: 38,
                cursor: 'pointer',
                color: piece?.color === 'w' ? '#fff' : '#111',
                textShadow: piece?.color === 'w' ? '0 0 2px #000' : 'none',
                boxShadow: isSel ? 'inset 0 0 0 3px #16a' : undefined,
              }}
            >
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
      <BoardArrows arrows={arrows} orientation={orientation} />
    </div>
  );
}
