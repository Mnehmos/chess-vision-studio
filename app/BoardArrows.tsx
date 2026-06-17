// SVG arrow annotator overlaid on the board. Visualizes two things:
//   • a selected piece's DEFENDERS (friendly) and ATTACKERS (adversary)
//   • a call-and-response THREAT LINE (numbered, colored by the moving side)
import type { Square } from '../engine/types';

export interface Arrow {
  from: Square;
  to: Square;
  color: string;
  label?: string; // sequence number for threat lines
  dashed?: boolean;
  move?: boolean; // the played move — subtle slate, thin, small arrowhead
  dim?: boolean; // de-emphasized (focus mode)
  pulse?: boolean;
  promotion?: string;
  deletable?: boolean;
}

// The app's visual grammar (consistent everywhere):
//   red    = attacks / threats / captures (incoming AND the selected piece's own)
//   green  = defenders / protection
//   orange = tactical candidate / threat line (numbered for call-and-response)
//   slate  = the move that was just PLAYED (so "moved here" never reads as "attacks here")
export const ARROW = {
  defend: '#2f855a', // green
  attack: '#c53030', // red
  tactical: '#dd6b20', // orange
  move: '#4a5568', // slate — the played move
};

const CELL = 56;
const SIZE = CELL * 8;

function center(sq: Square, orientation: 'white' | 'black'): { x: number; y: number } {
  const f = sq.charCodeAt(0) - 97;
  const r = sq.charCodeAt(1) - 49;
  const col = orientation === 'white' ? f : 7 - f;
  const row = orientation === 'white' ? 7 - r : r;
  return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
}

export function BoardArrows({
  arrows,
  orientation = 'white',
  onArrowRightClick,
}: {
  arrows: Arrow[];
  orientation?: 'white' | 'black';
  onArrowRightClick?: (from: Square, to: Square, promotion?: string) => void;
}) {
  const colors = Array.from(new Set(arrows.map((a) => a.color)));
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      preserveAspectRatio="xMidYMid meet"
      className="board-arrows"
    >
      <defs>
        {colors.map((c) => (
          <marker
            key={c}
            id={`ah-${c.replace('#', '')}`}
            markerWidth="6"
            markerHeight="6"
            refX="4.5"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill={c} />
          </marker>
        ))}
        {colors.map((c) => (
          <marker
            key={`s-${c}`}
            id={`ahs-${c.replace('#', '')}`}
            markerWidth="4"
            markerHeight="4"
            refX="3"
            refY="2"
            orient="auto"
          >
            <path d="M0,0 L4,2 L0,4 Z" fill={c} />
          </marker>
        ))}
      </defs>
      {arrows.map((a, i) => {
        const A = center(a.from, orientation);
        const B = center(a.to, orientation);
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        // start a bit off the source center; stop short of the target center
        const x1 = A.x + ux * 16;
        const y1 = A.y + uy * 16;
        const x2 = B.x - ux * 20;
        const y2 = B.y - uy * 20;
        const outlineColor =
          a.color === '#1a1a1a' || a.color === 'black'
            ? 'rgba(255, 255, 255, 0.7)'
            : 'rgba(16, 24, 40, 0.35)';
        return (
          <g key={i}>
            {/* Outline line to ensure high contrast against any light/dark board square */}
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={outlineColor}
              strokeWidth={(a.move ? 3 : 4) + 1.5}
              strokeOpacity={a.dim ? 0.18 : a.move ? 0.5 : 0.85}
              strokeLinecap="round"
              strokeDasharray={a.dashed ? '6 5' : undefined}
            />
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={a.color}
              strokeWidth={a.move ? 3 : 4}
              strokeOpacity={a.dim ? 0.18 : a.move ? 0.5 : 0.85}
              strokeLinecap="round"
              strokeDasharray={a.dashed ? '6 5' : undefined}
              markerEnd={`url(#ah${a.move ? 's' : ''}-${a.color.replace('#', '')})`}
            />
            {a.deletable && onArrowRightClick && (
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="transparent"
                strokeWidth={14}
                className="board-arrows__delete-target"
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onArrowRightClick(a.from, a.to, a.promotion);
                }}
              />
            )}
            {a.pulse && (
              <circle
                cx={x2}
                cy={y2}
                r={8}
                fill="none"
                stroke={a.color}
                strokeWidth={2}
                className="board-arrows__pulse"
                style={{
                  transformOrigin: `${x2}px ${y2}px`,
                }}
              />
            )}
            {a.label && (() => {
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2;
              const textLen = a.label.length;
              const pillW = Math.max(18, textLen * 7 + 6);
              const pillH = 14;
              return (
                <>
                  <rect
                    x={mx - pillW / 2}
                    y={my - pillH / 2}
                    width={pillW}
                    height={pillH}
                    rx={4}
                    fill="rgba(0,0,0,0.72)"
                    stroke={a.color}
                    strokeWidth={1}
                  />
                  <text
                    x={mx}
                    y={my + 3.5}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="700"
                    fill="#fff"
                    className="board-arrows__label"
                  >
                    {a.label}
                  </text>
                </>
              );
            })()}
          </g>
        );
      })}
    </svg>
  );
}
